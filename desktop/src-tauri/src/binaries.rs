//! Resolution of the native editor executables (Zora Studio / LightCraft).
//!
//! Lookup order:
//! 1. `ZORA_STUDIO_BIN` / `ZORA_LIGHTCRAFT_BIN` environment variables (when the file exists).
//! 2. Next to the current executable (also inside a `binaries/` subdirectory). This is
//!    where the single installer puts the bundled `externalBin` sidecars
//!    (`zora-studio[.exe]`, `zora-lightcraft[.exe]`); triple-suffixed staged names
//!    (`zora-studio-<triple>[.exe]`) are accepted too.
//! 3. Sibling development repos (`../zora-vector`, `../zora-lightcraft`), walking up
//!    from the executable directory and the current working directory.

use std::path::{Path, PathBuf};

use crate::editors::EditorKind;

/// Resolve the native binary for `kind` using the real environment.
pub fn resolve(kind: EditorKind) -> Option<PathBuf> {
    let env_var = match kind {
        EditorKind::Studio => "ZORA_STUDIO_BIN",
        EditorKind::Lightcraft => "ZORA_LIGHTCRAFT_BIN",
    };
    let env_value = std::env::var(env_var).ok();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let cwd = std::env::current_dir().ok();
    resolve_with(kind, env_value.as_deref(), exe_dir.as_deref(), cwd.as_deref())
}

/// Pure resolution logic, injectable for unit tests.
pub fn resolve_with(
    kind: EditorKind,
    env_value: Option<&str>,
    exe_dir: Option<&Path>,
    cwd: Option<&Path>,
) -> Option<PathBuf> {
    // 1. Explicit environment override.
    if let Some(value) = env_value {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Some(path);
        }
    }

    let names = binary_names(kind);

    // 2. Same directory as the current executable (or a `binaries/` subdirectory).
    if let Some(dir) = exe_dir {
        for name in &names {
            for candidate in [dir.join(name), dir.join("binaries").join(name)] {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    // 3. Sibling dev repo builds, walking up from the exe dir and the CWD.
    let repo = match kind {
        EditorKind::Studio => "zora-vector",
        EditorKind::Lightcraft => "zora-lightcraft",
    };
    for base in [exe_dir, cwd].into_iter().flatten() {
        for ancestor in base.ancestors() {
            let Some(parent) = ancestor.parent() else {
                continue;
            };
            for profile in ["release", "debug"] {
                for name in &names {
                    let candidate = parent.join(repo).join("target").join(profile).join(name);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
        }
    }

    None
}

/// Target triple this crate was compiled for (set by `build.rs`).
const TARGET_TRIPLE: &str = env!("ZORA_TARGET_TRIPLE");

/// Candidate file names for a kind, in preference order.
fn binary_names(kind: EditorKind) -> Vec<String> {
    binary_names_for(kind, TARGET_TRIPLE)
}

/// Candidate file names for a kind and target triple, in preference order:
/// the installed sidecar name (Tauri strips the triple when bundling
/// `externalBin`), the dev binary name, then the triple-suffixed staged name
/// (`zora-studio-<triple>[.exe]`, as in `desktop/src-tauri/binaries/`).
fn binary_names_for(kind: EditorKind, triple: &str) -> Vec<String> {
    let (sidecar, dev) = match kind {
        EditorKind::Studio => ("zora-studio", "vectorcraft"),
        EditorKind::Lightcraft => ("zora-lightcraft", "lightcraft"),
    };
    let mut names = vec![exe_name(sidecar), exe_name(dev)];
    if !triple.is_empty() {
        names.push(exe_name(&format!("{sidecar}-{triple}")));
    }
    names
}

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let mut bytes = [0u8; 8];
        getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
        let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let dir = std::env::temp_dir().join(format!("zora-desktop-binaries-{tag}-{suffix}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().expect("parent dir")).expect("create parent");
        std::fs::write(path, b"stub").expect("write stub binary");
    }

    #[test]
    fn env_override_wins_over_other_candidates() {
        let root = temp_root("env-wins");
        let exe_dir = root.join("app");
        let explicit = root.join("custom").join(exe_name("vectorcraft"));
        touch(&exe_dir.join(exe_name("zora-studio")));
        touch(&explicit);

        let resolved = resolve_with(
            EditorKind::Studio,
            Some(explicit.to_str().expect("utf-8 path")),
            Some(&exe_dir),
            None,
        );
        assert_eq!(resolved.as_deref(), Some(explicit.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn env_override_pointing_to_missing_file_is_ignored() {
        let root = temp_root("env-missing");
        let exe_dir = root.join("app");
        let fallback = exe_dir.join(exe_name("vectorcraft"));
        touch(&fallback);

        let resolved = resolve_with(
            EditorKind::Studio,
            Some(root.join("does-not-exist.exe").to_str().expect("utf-8 path")),
            Some(&exe_dir),
            None,
        );
        assert_eq!(resolved.as_deref(), Some(fallback.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_next_to_current_exe() {
        let root = temp_root("exe-dir");
        let exe_dir = root.join("app");
        let bin = exe_dir.join(exe_name("zora-lightcraft"));
        touch(&bin);

        let resolved = resolve_with(EditorKind::Lightcraft, None, Some(&exe_dir), None);
        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_inside_binaries_subdirectory() {
        let root = temp_root("binaries-subdir");
        let exe_dir = root.join("app");
        let bin = exe_dir.join("binaries").join(exe_name("lightcraft"));
        touch(&bin);

        let resolved = resolve_with(EditorKind::Lightcraft, None, Some(&exe_dir), None);
        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_sibling_dev_repo_release_build() {
        let root = temp_root("sibling-release");
        // Layout: <root>/zora/desktop is the exe dir, <root>/zora-vector is the sibling repo.
        let exe_dir = root.join("zora").join("desktop");
        std::fs::create_dir_all(&exe_dir).expect("create exe dir");
        let bin = root
            .join("zora-vector")
            .join("target")
            .join("release")
            .join(exe_name("vectorcraft"));
        touch(&bin);

        let resolved = resolve_with(EditorKind::Studio, None, Some(&exe_dir), None);
        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_sibling_dev_repo_debug_build_from_cwd() {
        let root = temp_root("sibling-debug");
        let cwd = root.join("zora").join("src");
        std::fs::create_dir_all(&cwd).expect("create cwd");
        let bin = root
            .join("zora-lightcraft")
            .join("target")
            .join("debug")
            .join(exe_name("lightcraft"));
        touch(&bin);

        let resolved = resolve_with(EditorKind::Lightcraft, None, None, Some(&cwd));
        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn release_build_preferred_over_debug() {
        let root = temp_root("release-first");
        let exe_dir = root.join("zora").join("desktop");
        std::fs::create_dir_all(&exe_dir).expect("create exe dir");
        let release = root
            .join("zora-vector")
            .join("target")
            .join("release")
            .join(exe_name("vectorcraft"));
        let debug = root
            .join("zora-vector")
            .join("target")
            .join("debug")
            .join(exe_name("vectorcraft"));
        touch(&debug);
        touch(&release);

        let resolved = resolve_with(EditorKind::Studio, None, Some(&exe_dir), None);
        assert_eq!(resolved.as_deref(), Some(release.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_installed_bundle_layout() {
        // NSIS/MSI install dir: Tauri installs `externalBin` sidecars next to
        // the main executable, without the target-triple suffix.
        let root = temp_root("installed");
        let install_dir = root.join("Zora");
        touch(&install_dir.join(exe_name("zora-desktop")));
        let studio = install_dir.join(exe_name("zora-studio"));
        let lightcraft = install_dir.join(exe_name("zora-lightcraft"));
        touch(&studio);
        touch(&lightcraft);

        let resolved_studio = resolve_with(EditorKind::Studio, None, Some(&install_dir), None);
        let resolved_lightcraft =
            resolve_with(EditorKind::Lightcraft, None, Some(&install_dir), None);
        assert_eq!(resolved_studio.as_deref(), Some(studio.as_path()));
        assert_eq!(resolved_lightcraft.as_deref(), Some(lightcraft.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolves_triple_suffixed_sidecar_in_binaries_subdirectory() {
        let root = temp_root("triple-suffixed");
        let exe_dir = root.join("app");
        let bin = exe_dir
            .join("binaries")
            .join(exe_name(&format!("zora-studio-{TARGET_TRIPLE}")));
        touch(&bin);

        let resolved = resolve_with(EditorKind::Studio, None, Some(&exe_dir), None);
        assert_eq!(resolved.as_deref(), Some(bin.as_path()));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn binary_names_include_triple_suffixed_sidecar_last() {
        let names = binary_names_for(EditorKind::Lightcraft, "x86_64-pc-windows-msvc");
        assert_eq!(
            names,
            vec![
                exe_name("zora-lightcraft"),
                exe_name("lightcraft"),
                exe_name("zora-lightcraft-x86_64-pc-windows-msvc"),
            ]
        );
        assert_eq!(binary_names_for(EditorKind::Studio, "").len(), 2);
        assert!(!TARGET_TRIPLE.is_empty());
    }

    #[test]
    fn returns_none_when_nothing_exists() {
        let root = temp_root("none");
        let exe_dir = root.join("app");
        std::fs::create_dir_all(&exe_dir).expect("create exe dir");

        let resolved = resolve_with(EditorKind::Studio, None, Some(&exe_dir), Some(&exe_dir));
        assert!(resolved.is_none());
        std::fs::remove_dir_all(&root).ok();
    }
}
