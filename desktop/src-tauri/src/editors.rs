//! Native editor lifecycle: spawning, tracking, focusing and closing
//! Zora Studio (`vectorcraft`) and LightCraft (`lightcraft`) child processes.

use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::binaries;

/// Event name used for every editor lifecycle notification sent to the webview.
pub const EDITOR_EVENT: &str = "zora-desktop:editor-event";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorKind {
    Studio,
    Lightcraft,
}

impl EditorKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "studio" => Some(Self::Studio),
            "lightcraft" => Some(Self::Lightcraft),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Studio => "studio",
            Self::Lightcraft => "lightcraft",
        }
    }

    fn id_flag(self) -> &'static str {
        match self {
            Self::Studio => "--zora-design",
            Self::Lightcraft => "--zora-photo",
        }
    }
}

/// Identity of an open editor: kind + design/edit id.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct EditorKey(pub EditorKind, pub String);

/// Serializable snapshot of an open editor, returned by `list_open_editors`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenEditorInfo {
    pub editor: EditorKind,
    pub id: String,
    pub item_id: String,
    pub name: String,
    pub dirty: bool,
}

/// Result of an open request.
#[derive(Clone, Debug, Serialize)]
pub struct OpenOutcome {
    pub status: &'static str,
    pub pid: Option<u32>,
}

struct OpenEditor {
    child: Arc<Mutex<Child>>,
    pid: u32,
    item_id: String,
    name: String,
    dirty: bool,
}

/// Shared registry of open editors, cheap to clone.
#[derive(Clone, Default)]
pub struct EditorRegistry {
    inner: Arc<Mutex<HashMap<EditorKey, OpenEditor>>>,
}

/// Lock helper that tolerates a poisoned mutex instead of panicking.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl EditorRegistry {
    pub fn pid_of(&self, kind: EditorKind, id: &str) -> Option<u32> {
        lock(&self.inner)
            .get(&EditorKey(kind, id.to_string()))
            .map(|entry| entry.pid)
    }

    pub fn set_dirty(&self, kind: EditorKind, id: &str, dirty: bool) {
        if let Some(entry) = lock(&self.inner).get_mut(&EditorKey(kind, id.to_string())) {
            entry.dirty = dirty;
        }
    }

    pub fn list(&self) -> Vec<OpenEditorInfo> {
        let map = lock(&self.inner);
        let mut infos: Vec<OpenEditorInfo> = map
            .iter()
            .map(|(key, entry)| OpenEditorInfo {
                editor: key.0,
                id: key.1.clone(),
                item_id: entry.item_id.clone(),
                name: entry.name.clone(),
                dirty: entry.dirty,
            })
            .collect();
        infos.sort_by(|a, b| (a.editor.as_str(), &a.id).cmp(&(b.editor.as_str(), &b.id)));
        infos
    }
}

/// Validate an editor id: ASCII alphanumeric plus `-` and `_`, 1..=128 chars.
pub fn validate_id(id: &str) -> Result<(), String> {
    let valid = !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if valid {
        Ok(())
    } else {
        Err("Identificador inválido.".to_string())
    }
}

/// Validate the theme passed to a native editor.
pub fn validate_theme(theme: &str) -> Result<(), String> {
    if theme == "dark" || theme == "light" {
        Ok(())
    } else {
        Err("Tema inválido: use \"dark\" ou \"light\".".to_string())
    }
}

/// Parameters for opening a native editor.
pub struct OpenRequest<'a> {
    pub kind: EditorKind,
    pub id: &'a str,
    pub item_id: &'a str,
    pub name: &'a str,
    pub theme: &'a str,
    pub bridge_url: &'a str,
    pub bridge_token: &'a str,
}

/// Open (or report as already open) the native editor for `request.id`.
pub fn open(
    app: &AppHandle,
    registry: &EditorRegistry,
    request: OpenRequest<'_>,
) -> Result<OpenOutcome, String> {
    let OpenRequest {
        kind,
        id,
        item_id,
        name,
        theme,
        bridge_url,
        bridge_token,
    } = request;
    validate_id(id)?;
    validate_theme(theme)?;

    let key = EditorKey(kind, id.to_string());
    let child = {
        // Hold the registry lock across check + spawn + insert so two concurrent
        // open requests cannot spawn duplicate processes for the same key.
        let mut map = lock(&registry.inner);
        if let Some(entry) = map.get(&key) {
            let running = lock(&entry.child)
                .try_wait()
                .map(|status| status.is_none())
                .unwrap_or(false);
            if running {
                return Ok(OpenOutcome {
                    status: "already-open",
                    pid: Some(entry.pid),
                });
            }
        }

        let bin = binaries::resolve(kind).ok_or_else(|| {
            "Editor nativo não encontrado. Configure ZORA_STUDIO_BIN / ZORA_LIGHTCRAFT_BIN ou instale o editor ao lado do Zora Desktop.".to_string()
        })?;
        let mut command = Command::new(bin);
        command
            .arg(kind.id_flag())
            .arg(id)
            .arg("--zora-theme")
            .arg(theme)
            .env("ZORA_BRIDGE_URL", bridge_url)
            .env("ZORA_BRIDGE_TOKEN", bridge_token);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command
            .spawn()
            .map_err(|e| format!("Não foi possível iniciar o editor: {e}"))?;
        let pid = child.id();
        let child = Arc::new(Mutex::new(child));
        map.insert(
            key.clone(),
            OpenEditor {
                child: Arc::clone(&child),
                pid,
                item_id: item_id.to_string(),
                name: name.to_string(),
                dirty: false,
            },
        );
        child
    };

    let pid = lock(&child).id();
    spawn_monitor(app.clone(), registry.clone(), key, child, pid);
    Ok(OpenOutcome {
        status: "opened",
        pid: Some(pid),
    })
}

/// Watch the child process; when it exits, drop the registry entry and notify the webview.
fn spawn_monitor(
    app: AppHandle,
    registry: EditorRegistry,
    key: EditorKey,
    child: Arc<Mutex<Child>>,
    pid: u32,
) {
    std::thread::spawn(move || {
        // Poll `try_wait` so the child mutex is never held while blocking,
        // keeping `close_editor` responsive.
        let exit_code: Option<i32> = loop {
            match lock(&child).try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => std::thread::sleep(Duration::from_millis(200)),
                Err(_) => break None,
            }
        };

        {
            let mut map = lock(&registry.inner);
            if let Some(entry) = map.get(&key) {
                if entry.pid == pid {
                    map.remove(&key);
                }
            }
        }

        let _ = app.emit(
            EDITOR_EVENT,
            serde_json::json!({
                "editor": key.0.as_str(),
                "id": key.1,
                "payload": { "type": "zora-desktop:closed", "exitCode": exit_code },
            }),
        );
    });
}

/// Bring the editor window for `id` to the front. Returns whether a window was focused.
pub fn focus(registry: &EditorRegistry, kind: EditorKind, id: &str) -> bool {
    match registry.pid_of(kind, id) {
        Some(pid) => focus_pid(pid),
        None => false,
    }
}

/// Terminate the editor for `id`. Returns whether an entry was found and killed.
/// The monitor thread emits the `zora-desktop:closed` event once the exit is observed.
pub fn close(registry: &EditorRegistry, kind: EditorKind, id: &str) -> bool {
    let entry = lock(&registry.inner).remove(&EditorKey(kind, id.to_string()));
    let Some(entry) = entry else {
        return false;
    };
    let mut child = lock(&entry.child);
    let _ = child.kill();
    let _ = child.wait();
    true
}

#[cfg(windows)]
fn focus_pid(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    struct Search {
        pid: u32,
        hwnd: HWND,
    }

    unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam as *mut Search);
        let mut window_pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut window_pid);
        if window_pid == search.pid && IsWindowVisible(hwnd) != 0 {
            search.hwnd = hwnd;
            return 0; // Stop enumerating: first visible top-level window wins.
        }
        1
    }

    let mut search = Search {
        pid,
        hwnd: std::ptr::null_mut(),
    };
    unsafe {
        EnumWindows(Some(enum_window), &mut search as *mut Search as LPARAM);
        if search.hwnd.is_null() {
            return false;
        }
        ShowWindow(search.hwnd, SW_RESTORE);
        SetForegroundWindow(search.hwnd) != 0
    }
}

#[cfg(not(windows))]
fn focus_pid(_pid: u32) -> bool {
    // Window activation for macOS/Linux is not implemented yet.
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_ids() {
        for id in ["a", "abc123", "design-42", "edit_7", "A-b_9", &"x".repeat(128)] {
            assert!(validate_id(id).is_ok(), "expected valid: {id}");
        }
    }

    #[test]
    fn rejects_invalid_ids() {
        for id in [
            "",
            &"x".repeat(129),
            "has space",
            "dot.dot",
            "sla/sh",
            "back\\slash",
            "acentuação",
            "semi;colon",
            "..",
        ] {
            assert!(validate_id(id).is_err(), "expected invalid: {id}");
        }
    }

    #[test]
    fn validates_theme() {
        assert!(validate_theme("dark").is_ok());
        assert!(validate_theme("light").is_ok());
        assert!(validate_theme("Dark").is_err());
        assert!(validate_theme("").is_err());
        assert!(validate_theme("system").is_err());
    }

    #[test]
    fn editor_kind_parse_roundtrip() {
        for kind in [EditorKind::Studio, EditorKind::Lightcraft] {
            assert_eq!(EditorKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(EditorKind::parse("unknown"), None);
    }

    #[test]
    fn registry_tracks_dirty_and_list() {
        let registry = EditorRegistry::default();
        assert!(registry.list().is_empty());
        assert!(registry.pid_of(EditorKind::Studio, "missing").is_none());
        // set_dirty on a missing entry must be a no-op, not a panic.
        registry.set_dirty(EditorKind::Studio, "missing", true);
        assert!(registry.list().is_empty());
    }
}
