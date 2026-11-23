fn main() {
    // Expose the target triple so `binaries.rs` can also find triple-suffixed
    // sidecars (`zora-studio-<triple>.exe`, as staged in `binaries/`).
    println!(
        "cargo:rustc-env=ZORA_TARGET_TRIPLE={}",
        std::env::var("TARGET").unwrap_or_default()
    );
    tauri_build::build()
}
