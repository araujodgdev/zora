//! Zora Desktop shell: a Tauri v2 window onto the Zora web app, plus a
//! loopback bridge and lifecycle management for the native editors.

mod binaries;
mod editors;
mod proxy;

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use editors::{EditorKind, EditorRegistry, OpenEditorInfo, OpenOutcome, OpenRequest};

const DEFAULT_SERVER_URL: &str = "https://zora.lume.software";

/// App-wide state shared with every command.
pub struct DesktopState {
    server_url: String,
    registry: EditorRegistry,
    bridge: proxy::Bridge,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    version: String,
    platform: String,
    server_url: String,
    studio_available: bool,
    lightcraft_available: bool,
}

#[derive(Serialize)]
struct FocusResult {
    focused: bool,
}

#[derive(Serialize)]
struct CloseResult {
    closed: bool,
}

/// Resolve the server URL from `--url <url>` / `--url=<url>`, then
/// `ZORA_DESKTOP_URL`, then the production default. Exits on invalid input.
fn resolve_server_url() -> String {
    let mut args = std::env::args().skip(1);
    let mut candidate: Option<String> = None;
    while let Some(arg) = args.next() {
        if arg == "--url" {
            candidate = args.next();
            break;
        }
        if let Some(value) = arg.strip_prefix("--url=") {
            candidate = Some(value.to_string());
            break;
        }
    }
    let raw = candidate
        .or_else(|| std::env::var("ZORA_DESKTOP_URL").ok())
        .unwrap_or_else(|| DEFAULT_SERVER_URL.to_string());
    normalize_server_url(&raw).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(1);
    })
}

/// Accept only the production origin and the local dev origin, trimming a
/// trailing slash. Rejects paths, queries, credentials and unexpected ports.
fn normalize_server_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let invalid = || {
        format!(
            "URL do servidor Zora inválida: \"{raw}\". Use https://zora.lume.software ou http://localhost:3000."
        )
    };
    let parsed = Url::parse(trimmed).map_err(|_| invalid())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(invalid());
    }
    if (parsed.path() != "/" && !parsed.path().is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(invalid());
    }
    let host = parsed.host_str().ok_or_else(invalid)?;
    match (parsed.scheme(), host, parsed.port()) {
        ("https", "zora.lume.software", None | Some(443)) => {
            Ok("https://zora.lume.software".to_string())
        }
        ("http", "localhost" | "127.0.0.1", Some(3000)) => Ok(format!("http://{host}:3000")),
        _ => Err(invalid()),
    }
}

/// Cheap TCP reachability probe used to decide between the remote app and the
/// local offline fallback at startup (and while reconnecting).
fn server_reachable(server_url: &str) -> bool {
    let Ok(url) = Url::parse(server_url) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    let port = url.port_or_known_default().unwrap_or(443);
    let Ok(addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    addrs
        .into_iter()
        .any(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok())
}

/// While the offline fallback is shown, poll the server and navigate the main
/// window to it automatically as soon as it comes back.
fn spawn_reconnect_watcher(window: tauri::WebviewWindow, server_url: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        if server_reachable(&server_url) {
            let script = format!("location.replace({});", serde_json::json!(server_url));
            let _ = window.eval(&script);
            break;
        }
    });
}

#[tauri::command]
fn desktop_info(state: State<'_, DesktopState>) -> DesktopInfo {
    DesktopInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        server_url: state.server_url.clone(),
        studio_available: binaries::resolve(EditorKind::Studio).is_some(),
        lightcraft_available: binaries::resolve(EditorKind::Lightcraft).is_some(),
    }
}

#[tauri::command]
async fn open_design_editor(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    design_id: String,
    item_id: String,
    name: String,
    theme: String,
) -> Result<OpenOutcome, String> {
    editors::open(
        &app,
        &state.registry,
        OpenRequest {
            kind: EditorKind::Studio,
            id: &design_id,
            item_id: &item_id,
            name: &name,
            theme: &theme,
            bridge_url: &state.bridge.url,
            bridge_token: &state.bridge.token,
        },
    )
}

#[tauri::command]
async fn open_photo_editor(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    edit_id: String,
    item_id: String,
    name: String,
    theme: String,
) -> Result<OpenOutcome, String> {
    editors::open(
        &app,
        &state.registry,
        OpenRequest {
            kind: EditorKind::Lightcraft,
            id: &edit_id,
            item_id: &item_id,
            name: &name,
            theme: &theme,
            bridge_url: &state.bridge.url,
            bridge_token: &state.bridge.token,
        },
    )
}

#[tauri::command]
fn focus_editor(
    state: State<'_, DesktopState>,
    editor: String,
    id: String,
) -> Result<FocusResult, String> {
    let kind = EditorKind::parse(&editor)
        .ok_or_else(|| "Editor desconhecido: use \"studio\" ou \"lightcraft\".".to_string())?;
    Ok(FocusResult {
        focused: editors::focus(&state.registry, kind, &id),
    })
}

#[tauri::command]
fn close_editor(
    state: State<'_, DesktopState>,
    editor: String,
    id: String,
) -> Result<CloseResult, String> {
    let kind = EditorKind::parse(&editor)
        .ok_or_else(|| "Editor desconhecido: use \"studio\" ou \"lightcraft\".".to_string())?;
    Ok(CloseResult {
        closed: editors::close(&state.registry, kind, &id),
    })
}

#[tauri::command]
fn list_open_editors(state: State<'_, DesktopState>) -> Vec<OpenEditorInfo> {
    state.registry.list()
}

pub fn run() {
    let server_url = resolve_server_url();

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let registry = EditorRegistry::default();
            let bridge = proxy::start(handle.clone(), registry.clone(), server_url.clone())?;
            app.manage(DesktopState {
                server_url: server_url.clone(),
                registry,
                bridge,
            });

            let parsed = Url::parse(&server_url)?;
            let reachable = server_reachable(&server_url);
            let url = if reachable {
                WebviewUrl::External(parsed)
            } else {
                WebviewUrl::App("index.html".into())
            };
            let mut builder = WebviewWindowBuilder::new(app, "main", url)
                .title("Zora")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .resizable(true);
            if !reachable {
                // Expose the server URL to the offline fallback page.
                builder = builder.initialization_script(format!(
                    "window.__ZORA_SERVER_URL__ = {};",
                    serde_json::json!(server_url)
                ));
            }
            let window = builder.build()?;
            if !reachable {
                spawn_reconnect_watcher(window, server_url.clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            open_design_editor,
            open_photo_editor,
            focus_editor,
            close_editor,
            list_open_editors
        ])
        .run(tauri::generate_context!())
        .expect("Falha ao iniciar o Zora Desktop.");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_production_origin() {
        for raw in [
            "https://zora.lume.software",
            "https://zora.lume.software/",
            "https://zora.lume.software:443",
            "  https://zora.lume.software/  ",
        ] {
            assert_eq!(
                normalize_server_url(raw).as_deref(),
                Ok("https://zora.lume.software"),
                "expected accept: {raw}"
            );
        }
    }

    #[test]
    fn accepts_local_dev_origin() {
        assert_eq!(
            normalize_server_url("http://localhost:3000").as_deref(),
            Ok("http://localhost:3000")
        );
        assert_eq!(
            normalize_server_url("http://127.0.0.1:3000/").as_deref(),
            Ok("http://127.0.0.1:3000")
        );
    }

    #[test]
    fn rejects_everything_else() {
        for raw in [
            "",
            "not a url",
            "http://zora.lume.software",
            "https://evil.example",
            "https://zora.lume.software.evil.example",
            "https://zora.lume.software:8443",
            "http://localhost:3001",
            "http://localhost",
            "https://zora.lume.software/app",
            "https://zora.lume.software/?x=1",
            "https://zora.lume.software/#frag",
            "https://user:pass@zora.lume.software",
            "file:///etc/passwd",
        ] {
            assert!(
                normalize_server_url(raw).is_err(),
                "expected reject: {raw}"
            );
        }
    }
}
