//! Loopback HTTP/1.1 bridge between the native editors and the Zora server.
//!
//! The bridge listens on `127.0.0.1:0` (ephemeral port) and is protected by a
//! random 64-char hex token (`X-Zora-Bridge-Token`). It only forwards an
//! explicit allowlist of Zora API routes, attaching the live session cookies
//! read from the main webview, so the native editors never handle credentials.
//! Responses always carry an exact `Content-Length` and `Connection: close`
//! so simple `std::net::TcpStream` clients in the editors parse them reliably.

use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::editors::{self, EditorKind, EditorRegistry, EDITOR_EVENT};

/// 160 MiB: comfortably above 100 MB RAW uploads plus previews.
const MAX_BODY_BYTES: u64 = 160 * 1024 * 1024;
const MAX_HEAD_BYTES: usize = 64 * 1024;
const TOKEN_HEADER: &str = "x-zora-bridge-token";
const EVENT_PATH: &str = "/__zora_desktop/event";

/// Handle to the running bridge. Keeping the runtime alive is intentional:
/// it is stored in `DesktopState` for the whole app lifetime.
pub struct Bridge {
    pub url: String,
    pub token: String,
    _runtime: tokio::runtime::Runtime,
}

struct Context {
    app: AppHandle,
    registry: EditorRegistry,
    server_url: String,
    token: String,
    client: reqwest::Client,
}

/// Start the bridge server. Returns the loopback URL and the shared token.
pub fn start(
    app: AppHandle,
    registry: EditorRegistry,
    server_url: String,
) -> std::io::Result<Bridge> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let listener = runtime.block_on(TcpListener::bind("127.0.0.1:0"))?;
    let addr = listener.local_addr()?;
    let token = random_token();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(std::io::Error::other)?;
    let ctx = Arc::new(Context {
        app,
        registry,
        server_url,
        token: token.clone(),
        client,
    });

    runtime.spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, _peer)) => {
                    let ctx = Arc::clone(&ctx);
                    tokio::spawn(async move {
                        let _ = handle_connection(socket, ctx).await;
                    });
                }
                Err(_) => {
                    // Avoid a hot spin if accepting keeps failing.
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });

    Ok(Bridge {
        url: format!("http://{addr}"),
        token,
        _runtime: runtime,
    })
}

/// Random 64-char hex token from the OS RNG.
fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Constant-time equality for fixed-length secrets. The length check is fine:
/// the token length is public (always 64 hex chars).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Route allowlist. `target` is the full request target (path + optional query).
pub fn is_allowed_proxy_path(method: &str, target: &str) -> bool {
    if !target.starts_with('/') {
        return false;
    }
    if target.contains("..") || target.contains('\\') {
        return false;
    }
    if target.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return false;
    }
    let path = target.split('?').next().unwrap_or("");
    // `path` starts with '/', so stripping the first byte is safe; empty
    // segments (double slashes, trailing slash) are rejected below.
    let segments: Vec<&str> = path[1..].split('/').collect();
    if segments.iter().any(|segment| segment.is_empty()) {
        return false;
    }
    let valid_id = |id: &str| editors::validate_id(id).is_ok();
    match segments.as_slice() {
        ["studio-fonts", rest @ ..] if !rest.is_empty() => method == "GET",
        ["api", "designs", id] => method == "GET" && valid_id(id),
        ["api", "designs", id, "source" | "preview"] => method == "GET" && valid_id(id),
        ["api", "designs", id, "versions"] => method == "POST" && valid_id(id),
        ["api", "photo-edits", id] => method == "GET" && valid_id(id),
        ["api", "photo-edits", id, "original" | "settings" | "preview"] => {
            method == "GET" && valid_id(id)
        }
        ["api", "photo-edits", id, "versions"] => method == "POST" && valid_id(id),
        _ => false,
    }
}

/// Parsed HTTP/1.1 request head.
pub struct HttpRequest {
    pub method: String,
    pub target: String,
    /// Header names are lowercased.
    pub headers: Vec<(String, String)>,
}

impl HttpRequest {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, value)| value.as_str())
    }
}

/// Parse the request head (request line + headers, without the final blank line).
pub fn parse_request(head: &str) -> Option<HttpRequest> {
    let mut lines = head.lines();
    let request_line = lines.next()?;
    let mut parts = request_line.split(' ');
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let version = parts.next()?;
    if parts.next().is_some() || method.is_empty() || target.is_empty() {
        return None;
    }
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return None;
    }
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':')?;
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty() {
            return None;
        }
        headers.push((name, value.trim().to_string()));
    }
    Some(HttpRequest {
        method,
        target,
        headers,
    })
}

/// Read the request head, capped at `MAX_HEAD_BYTES`.
/// `Ok(None)` means the peer closed before sending anything.
async fn read_head(reader: &mut BufReader<TcpStream>) -> Result<Option<String>, ()> {
    let mut head = String::new();
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).await.map_err(|_| ())?;
        if read == 0 {
            return if head.is_empty() { Ok(None) } else { Err(()) };
        }
        head.push_str(&line);
        if head.len() > MAX_HEAD_BYTES {
            return Err(());
        }
        if line == "\r\n" || line == "\n" {
            return Ok(Some(head));
        }
    }
}

/// Read the request body according to `Content-Length`, enforcing the size cap.
async fn read_body(
    reader: &mut BufReader<TcpStream>,
    request: &HttpRequest,
) -> Result<Vec<u8>, (u16, &'static str)> {
    if request.header("transfer-encoding").is_some() {
        return Err((501, "Transfer-Encoding não é suportado pelo bridge."));
    }
    let Some(raw_len) = request.header("content-length") else {
        return Ok(Vec::new());
    };
    let len: u64 = raw_len
        .parse()
        .map_err(|_| (400u16, "Content-Length inválido."))?;
    if len > MAX_BODY_BYTES {
        return Err((413, "Corpo da requisição excede o limite de 160 MiB."));
    }
    let mut body = Vec::with_capacity(len.min(1024 * 1024) as usize);
    reader
        .take(len)
        .read_to_end(&mut body)
        .await
        .map_err(|_| (400u16, "Falha ao ler o corpo da requisição."))?;
    if body.len() as u64 != len {
        return Err((400, "Corpo da requisição incompleto."));
    }
    Ok(body)
}

async fn handle_connection(socket: TcpStream, ctx: Arc<Context>) -> std::io::Result<()> {
    let _ = socket.set_nodelay(true);
    let mut reader = BufReader::new(socket);

    let head = match read_head(&mut reader).await {
        Ok(Some(head)) => head,
        Ok(None) => return Ok(()),
        Err(()) => {
            return write_simple(reader.get_mut(), 400, "Requisição inválida.").await;
        }
    };
    let Some(request) = parse_request(&head) else {
        return write_simple(reader.get_mut(), 400, "Requisição inválida.").await;
    };

    let token_ok = request
        .header(TOKEN_HEADER)
        .map(|value| constant_time_eq(value.as_bytes(), ctx.token.as_bytes()))
        .unwrap_or(false);
    if !token_ok {
        return write_simple(reader.get_mut(), 403, "Token do bridge inválido.").await;
    }

    let body = match read_body(&mut reader, &request).await {
        Ok(body) => body,
        Err((status, message)) => {
            return write_simple(reader.get_mut(), status, message).await;
        }
    };

    let path = request.target.split('?').next().unwrap_or("");
    if request.method == "POST" && path == EVENT_PATH {
        return handle_event(&ctx, &body, reader.get_mut()).await;
    }
    if !is_allowed_proxy_path(&request.method, &request.target) {
        return write_simple(reader.get_mut(), 403, "Rota não permitida pelo bridge.").await;
    }
    forward(&ctx, &request, body, reader.get_mut()).await
}

/// Payload posted by the native editors to `/__zora_desktop/event`.
#[derive(Deserialize)]
struct EditorEvent {
    editor: String,
    id: String,
    payload: serde_json::Value,
}

async fn handle_event(
    ctx: &Context,
    body: &[u8],
    socket: &mut TcpStream,
) -> std::io::Result<()> {
    let event: EditorEvent = match serde_json::from_slice(body) {
        Ok(event) => event,
        Err(_) => {
            return write_simple(socket, 400, "Evento inválido: JSON malformado.").await;
        }
    };
    let Some(kind) = EditorKind::parse(&event.editor) else {
        return write_simple(socket, 400, "Editor desconhecido.").await;
    };
    if editors::validate_id(&event.id).is_err() {
        return write_simple(socket, 400, "Identificador inválido.").await;
    }

    let payload_type = event
        .payload
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    match payload_type {
        "zora-studio:dirty" | "zora-lightcraft:dirty" => {
            if let Some(dirty) = event.payload.get("dirty").and_then(|value| value.as_bool()) {
                ctx.registry.set_dirty(kind, &event.id, dirty);
            }
        }
        "zora-studio:ready"
        | "zora-lightcraft:ready"
        | "zora-studio:saved"
        | "zora-lightcraft:saved" => {
            ctx.registry.set_dirty(kind, &event.id, false);
        }
        "zora-studio:back" | "zora-lightcraft:back" => {
            if let Some(window) = ctx.app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        _ => {}
    }

    let _ = ctx.app.emit(
        EDITOR_EVENT,
        serde_json::json!({
            "editor": event.editor,
            "id": event.id,
            "payload": event.payload,
        }),
    );
    write_response(socket, 200, "application/json", &[], br#"{"ok":true}"#).await
}

/// Forward an allowlisted request to the Zora server with the webview's cookies.
async fn forward(
    ctx: &Context,
    request: &HttpRequest,
    body: Vec<u8>,
    socket: &mut TcpStream,
) -> std::io::Result<()> {
    let target = format!("{}{}", ctx.server_url, request.target);
    let method = match reqwest::Method::from_bytes(request.method.as_bytes()) {
        Ok(method) => method,
        Err(_) => return write_simple(socket, 400, "Método HTTP inválido.").await,
    };
    let mut outgoing = ctx.client.request(method, target.as_str());
    if let Some(content_type) = request.header("content-type") {
        outgoing = outgoing.header(reqwest::header::CONTENT_TYPE, content_type);
    }
    if let Ok(url) = url::Url::parse(&target) {
        if let Some(window) = ctx.app.get_webview_window("main") {
            if let Ok(cookies) = window.cookies_for_url(url) {
                let cookie_header = cookies
                    .iter()
                    .map(|cookie| format!("{}={}", cookie.name(), cookie.value()))
                    .collect::<Vec<_>>()
                    .join("; ");
                if !cookie_header.is_empty() {
                    outgoing = outgoing.header(reqwest::header::COOKIE, cookie_header);
                }
            }
        }
    }
    if !body.is_empty() {
        outgoing = outgoing.body(body);
    }

    let response = match outgoing.send().await {
        Ok(response) => response,
        Err(_) => {
            return write_simple(socket, 502, "Não foi possível contatar o servidor Zora.").await;
        }
    };
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut extra: Vec<(&str, String)> = Vec::new();
    for name in ["x-design-version", "x-photo-edit-version"] {
        if let Some(value) = response.headers().get(name).and_then(|v| v.to_str().ok()) {
            extra.push((name, value.to_string()));
        }
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(_) => {
            return write_simple(socket, 502, "Falha ao ler a resposta do servidor Zora.").await;
        }
    };
    write_response(socket, status, &content_type, &extra, &bytes).await
}

/// Write a complete HTTP/1.1 response with exact `Content-Length` and `Connection: close`.
async fn write_response(
    socket: &mut TcpStream,
    status: u16,
    content_type: &str,
    extra: &[(&str, String)],
    body: &[u8],
) -> std::io::Result<()> {
    let reason = reqwest::StatusCode::from_u16(status)
        .ok()
        .and_then(|code| code.canonical_reason())
        .unwrap_or("");
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        sanitize_header_value(content_type),
        body.len()
    );
    for (name, value) in extra {
        head.push_str(&format!("{name}: {}\r\n", sanitize_header_value(value)));
    }
    head.push_str("\r\n");
    socket.write_all(head.as_bytes()).await?;
    socket.write_all(body).await?;
    socket.flush().await?;
    let _ = socket.shutdown().await;
    Ok(())
}

/// Strip CR/LF (and other control chars) so upstream values cannot inject headers.
fn sanitize_header_value(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .collect()
}

async fn write_simple(
    socket: &mut TcpStream,
    status: u16,
    message: &str,
) -> std::io::Result<()> {
    write_response(
        socket,
        status,
        "text/plain; charset=utf-8",
        &[],
        message.as_bytes(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_design_read_routes() {
        for target in [
            "/api/designs/abc123",
            "/api/designs/abc123/source",
            "/api/designs/abc123/preview",
            "/api/designs/abc123?raw=1",
            "/api/designs/abc123/preview?size=512",
            "/api/designs/design-42_x/source?v=3",
        ] {
            assert!(is_allowed_proxy_path("GET", target), "expected allow: {target}");
        }
    }

    #[test]
    fn allows_design_version_post_only() {
        assert!(is_allowed_proxy_path("POST", "/api/designs/abc123/versions"));
        assert!(!is_allowed_proxy_path("GET", "/api/designs/abc123/versions"));
        assert!(!is_allowed_proxy_path("PUT", "/api/designs/abc123/versions"));
        assert!(!is_allowed_proxy_path("POST", "/api/designs/abc123"));
        assert!(!is_allowed_proxy_path("DELETE", "/api/designs/abc123"));
    }

    #[test]
    fn allows_photo_edit_routes() {
        for target in [
            "/api/photo-edits/edit_1",
            "/api/photo-edits/edit_1/original",
            "/api/photo-edits/edit_1/settings",
            "/api/photo-edits/edit_1/preview",
            "/api/photo-edits/edit_1/original?download=1",
        ] {
            assert!(is_allowed_proxy_path("GET", target), "expected allow: {target}");
        }
        assert!(is_allowed_proxy_path("POST", "/api/photo-edits/edit_1/versions"));
        assert!(!is_allowed_proxy_path("GET", "/api/photo-edits/edit_1/versions"));
        assert!(!is_allowed_proxy_path("POST", "/api/photo-edits/edit_1/settings"));
    }

    #[test]
    fn allows_studio_fonts_with_subpaths() {
        for target in [
            "/studio-fonts/index.json",
            "/studio-fonts/inter/Inter-Regular.woff2",
            "/studio-fonts/a/b/c.ttf",
        ] {
            assert!(is_allowed_proxy_path("GET", target), "expected allow: {target}");
        }
        assert!(!is_allowed_proxy_path("GET", "/studio-fonts"));
        assert!(!is_allowed_proxy_path("GET", "/studio-fonts/"));
        assert!(!is_allowed_proxy_path("POST", "/studio-fonts/index.json"));
    }

    #[test]
    fn rejects_traversal_and_control_characters() {
        for target in [
            "/api/designs/../secrets",
            "/api/designs/..%2fsecrets",
            "/studio-fonts/..\\windows\\win.ini",
            "/api/designs/a\\b",
            "/api/designs/a\r\nX-Injected: 1",
            "/api/designs/a\u{0}b",
            "/api/designs/a\u{7f}b",
            "api/designs/abc",
            "https://evil.example/api/designs/abc",
            "//api/designs/abc",
            "/api//designs/abc",
            "/api/designs/abc/",
            "/",
            "",
        ] {
            assert!(
                !is_allowed_proxy_path("GET", target),
                "expected reject: {target:?}"
            );
        }
    }

    #[test]
    fn rejects_unknown_routes_and_bad_ids() {
        for target in [
            "/api/admin/users",
            "/api/designs",
            "/api/designs/abc/other",
            "/api/designs/bad.id",
            "/api/designs/bad id",
            "/api/photo-edits",
            "/api/photo-edits/abc/unknown",
            "/__zora_desktop/event",
            "/api/designs/abc/versions/extra",
        ] {
            assert!(
                !is_allowed_proxy_path("GET", target),
                "expected reject: {target}"
            );
            assert!(
                !is_allowed_proxy_path("POST", target),
                "expected reject: {target}"
            );
        }
    }

    #[test]
    fn constant_time_compare_basics() {
        assert!(constant_time_eq(b"", b""));
        assert!(constant_time_eq(b"secret-token", b"secret-token"));
        assert!(!constant_time_eq(b"secret-token", b"secret-tokem"));
        assert!(!constant_time_eq(b"short", b"longer-value"));
        assert!(!constant_time_eq(b"", b"x"));
        // Every single-byte difference must be detected.
        let base = b"0123456789abcdef";
        for index in 0..base.len() {
            let mut mutated = *base;
            mutated[index] ^= 0x01;
            assert!(!constant_time_eq(base, &mutated));
        }
    }

    #[test]
    fn parses_valid_request_head() {
        let head = "POST /api/designs/abc/versions HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Zora-Bridge-Token: tok\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n";
        let request = parse_request(head).expect("valid head");
        assert_eq!(request.method, "POST");
        assert_eq!(request.target, "/api/designs/abc/versions");
        assert_eq!(request.header("x-zora-bridge-token"), Some("tok"));
        assert_eq!(request.header("content-type"), Some("application/json"));
        assert_eq!(request.header("content-length"), Some("2"));
        assert_eq!(request.header("missing"), None);
    }

    #[test]
    fn parses_get_without_headers() {
        let request = parse_request("GET /api/designs/abc HTTP/1.1\r\n\r\n").expect("valid head");
        assert_eq!(request.method, "GET");
        assert!(request.headers.is_empty());
    }

    #[test]
    fn rejects_malformed_request_heads() {
        for head in [
            "",
            "GET\r\n\r\n",
            "GET /path\r\n\r\n",
            "GET /path HTTP/2.0\r\n\r\n",
            "GET /path HTTP/1.1 extra\r\n\r\n",
            "GET  HTTP/1.1\r\n\r\n",
            "GET /path HTTP/1.1\r\nBadHeaderNoColon\r\n\r\n",
            "GET /path HTTP/1.1\r\n: value\r\n\r\n",
        ] {
            assert!(parse_request(head).is_none(), "expected reject: {head:?}");
        }
    }

    #[test]
    fn header_lookup_is_case_insensitive_via_normalization() {
        let request =
            parse_request("GET / HTTP/1.1\r\nCoNtEnT-TyPe: text/plain\r\n\r\n").expect("valid");
        assert_eq!(request.header("content-type"), Some("text/plain"));
    }

    #[test]
    fn sanitize_header_value_strips_control_chars() {
        assert_eq!(
            sanitize_header_value("application/json\r\nX-Evil: 1"),
            "application/jsonX-Evil: 1"
        );
        assert_eq!(sanitize_header_value("text/plain"), "text/plain");
    }
}
