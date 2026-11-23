# Zora Desktop — Architecture Plan

Zora Desktop is a thin **Tauri v2** shell (`desktop/`) that puts the Zora web app
in a native window and bridges it to the native editors: **Zora Studio**
(`vectorcraft`, vector design) and **LightCraft** (`lightcraft`, photo editing).

```
┌────────────────────────────── Zora Desktop (Tauri v2) ──────────────────────────────┐
│                                                                                      │
│  main WebviewWindow ──► https://zora.lume.software (or http://localhost:3000)        │
│        │  Tauri commands (invoke)              ▲  "zora-desktop:editor-event"        │
│        ▼                                       │                                     │
│  lib.rs commands ──► editors.rs (registry, spawn/focus/close)                        │
│                          │  spawn + env ZORA_BRIDGE_URL / ZORA_BRIDGE_TOKEN          │
│                          ▼                                                           │
│  proxy.rs loopback bridge (127.0.0.1:<ephemeral>, tokio TcpListener)                 │
│        │  allowlisted routes + live webview cookies                                  │
│        ▼                                                                             │
│  Zora server (/api/designs/*, /api/photo-edits/*, /studio-fonts/*)                   │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Window & server URL

- The `main` window is created programmatically in `setup()` (config has
  `app.windows: []`): title `Zora`, 1440×900, min 900×600, centered, resizable.
- Server URL resolution: `--url <url>` (or `--url=<url>`) → `ZORA_DESKTOP_URL`
  env → default `https://zora.lume.software`. Only
  `https://zora.lume.software` and `http://localhost:3000` /
  `http://127.0.0.1:3000` are accepted (trailing slash trimmed); anything else
  exits with an error. This keeps the remote capability surface tight.
- The window loads the server directly via `WebviewUrl::External(url)`.
- **Offline fallback**: a TCP probe at startup decides whether the server is
  reachable. If not, the window loads `desktop/offline/index.html`
  (`frontendDist: "../offline"`, pt-BR, `#0a0a0a` + `#a7f175`), which shows the
  server URL (injected as `window.__ZORA_SERVER_URL__` via an initialization
  script) and a "Tentar novamente" button (opaque `fetch` probe, then
  `location.replace`). A watcher thread re-probes every 3 s and navigates to the
  server automatically once it is back.

## Security model

- **Remote capabilities** (`capabilities/default.json`): only the `main` window,
  only the origins `https://zora.lume.software/*`, `http://localhost:3000/*`,
  `http://127.0.0.1:3000/*`, only `core:default`, `core:event:default`,
  `core:window:default`. `withGlobalTauri` is `false`.
- **Loopback bridge** (`proxy.rs`): HTTP/1.1 server on `127.0.0.1:0`
  (ephemeral port, never exposed to the network). Every request must carry
  `X-Zora-Bridge-Token` matching a random 64-char hex token (OS RNG,
  constant-time comparison); otherwise `403`.
- **Route allowlist** (`is_allowed_proxy_path`): rejects `..`, `\`, control
  chars, empty segments and anything not starting with `/`. Allowed:
  - `GET /api/designs/<id>[/source|/preview]`, `POST /api/designs/<id>/versions`
  - `GET /api/photo-edits/<id>[/original|/settings|/preview]`,
    `POST /api/photo-edits/<id>/versions`
  - `GET /studio-fonts/<rest>`
  - Ids must be ASCII alphanumeric + `-`/`_`, 1..=128 chars. Query strings allowed.
- **Cookie forwarding**: the bridge reads live cookies from the main webview
  (`cookies_for_url`) per request and forwards them as a `Cookie` header, so
  editors never see credentials. Only method, path+query, `Content-Type`,
  `Cookie` and body are forwarded; responses return the exact upstream status,
  `Content-Type`, `X-Design-Version`, `X-Photo-Edit-Version`, exact
  `Content-Length` and `Connection: close` (reliable for the editors' simple
  `std::net::TcpStream` HTTP clients). No redirects followed; 180 s timeout;
  160 MiB max body (100 MB RAW + previews).

## Tauri commands (JS names camelCase)

| Command | Args | Returns |
| --- | --- | --- |
| `desktop_info` | — | `{ version, platform, serverUrl, studioAvailable, lightcraftAvailable }` |
| `open_design_editor` | `designId, itemId, name, theme` | `{ status: "opened" \| "already-open", pid }` |
| `open_photo_editor` | `editId, itemId, name, theme` | `{ status: "opened" \| "already-open", pid }` |
| `focus_editor` | `editor ("studio"\|"lightcraft"), id` | `{ focused }` |
| `close_editor` | `editor, id` | `{ closed }` |
| `list_open_editors` | — | `[{ editor, id, itemId, name, dirty }]` |

Events emitted to the webview as **`zora-desktop:editor-event`** with
`{ editor, id, payload }`:

- From editors via `POST /__zora_desktop/event`: `zora-studio:*` /
  `zora-lightcraft:*` payloads (`dirty` updates the registry's dirty flag;
  `ready`/`saved` clear it; `back` unminimizes + focuses the main window).
- From the process monitor: `{ type: "zora-desktop:closed", exitCode }`.

## Native binary resolution (`binaries.rs`)

For `studio` (`zora-studio` / `vectorcraft`) and `lightcraft`
(`zora-lightcraft` / `lightcraft`), first existing file wins:

1. `ZORA_STUDIO_BIN` / `ZORA_LIGHTCRAFT_BIN` env var.
2. Same dir as the current exe, or its `binaries/` subdir. This is the
   installed layout of the single installer (`<installDir>/zora-desktop.exe`,
   `<installDir>/zora-studio.exe`, `<installDir>/zora-lightcraft.exe`; Tauri
   strips the triple from `externalBin` names). Triple-suffixed staged names
   (`zora-studio-<triple>[.exe]`, triple from `build.rs` → `ZORA_TARGET_TRIPLE`)
   are accepted too.
3. Sibling dev repos, walking up from exe dir / CWD:
   `../zora-vector/target/{release,debug}/vectorcraft(.exe)` and
   `../zora-lightcraft/target/{release,debug}/lightcraft(.exe)`.

## Native-first editors (web pages)

The web/WASM editors are no longer maintained. The design and photo editor
routes never embed `/studio/` or `/lightcraft/` iframes any more:

- **Web browser** (`isZoraDesktop()` is `false`): a pt-BR notice "Edição
  disponível no Zora Desktop" with "Voltar ao item"; previews, version history
  and "Usar como mídia" stay on the item page.
- **Zora Desktop**: the page auto-launches the native editor
  (`desktop_info` → `open_design_editor` / `open_photo_editor`), mirrors
  `ready`/`dirty`/`saved`/`back`/`zora-desktop:closed`, blocks navigation and
  `beforeunload` while dirty, and offers "Trazer janela para frente" /
  "Abrir novamente". When the bundled executable is missing
  (`studioAvailable`/`lightcraftAvailable` false) it explains that and offers
  "Tentar novamente" — no web fallback.

The `/studio/*`, `/studio-fonts/*` and `/lightcraft/*` hosting routes remain
(native Studio reads fonts through the bridge's `/studio-fonts/*`).

## Single installer (`externalBin` sidecars)

Zora Desktop ships as **one installer** containing `zora-desktop`,
`zora-studio` (`vectorcraft`) and `zora-lightcraft` (`lightcraft`).

- `desktop/src-tauri/tauri.bundle.conf.json` is a Tauri v2 config overlay that
  adds `bundle.externalBin: ["binaries/zora-studio", "binaries/zora-lightcraft"]`
  (plus NSIS languages `PortugueseBR`, `English`). Keeping `externalBin` out of
  `tauri.conf.json` means plain `cargo check` / `cargo test` never fail when
  `binaries/` is empty.
- `scripts/desktop-package.ts` (`pnpm desktop:package`):
  1. reads the host triple from `rustc -vV`;
  2. unless `--skip-editors`, runs `cargo build -p vectorcraft --bin vectorcraft
     --release` in `../zora-vector`, **then** the same for `lightcraft` in
     `../zora-lightcraft` — strictly one Rust build at a time, with
     `CARGO_INCREMENTAL=0` and `CARGO_BUILD_JOBS=2` (~15 GB RAM budget);
  3. copies them to `desktop/src-tauri/binaries/zora-studio-<triple>[.exe]` and
     `zora-lightcraft-<triple>[.exe]` (git-ignored), printing sizes in MiB;
  4. unless `--stage-only`, runs the local `@tauri-apps/cli`
     (`node node_modules/@tauri-apps/cli/tauri.js build --config
     src-tauri/tauri.bundle.conf.json [--debug] [--bundles <list>]`) in
     `desktop/`;
  5. lists the installers under `desktop/src-tauri/target/<profile>/bundle/`.
- Flags: `--debug`, `--skip-editors`, `--stage-only`, `--dry-run` (prints the
  triple, source binaries, staged paths and commands; changes nothing),
  `--studio-dir <path>`, `--lightcraft-dir <path>`, `--bundles <list>`.
- `pnpm desktop:package:debug` = `--debug --skip-editors`: packages the
  existing debug editor builds for a fast local installer test.

## Editor CLI contract

Spawned with the bridge credentials in the environment
(`ZORA_BRIDGE_URL`, `ZORA_BRIDGE_TOKEN`):

```
vectorcraft  --zora-design <designId> --zora-theme <dark|light>
lightcraft   --zora-photo  <editId>   --zora-theme <dark|light>
```

Editors talk to the bridge at `$ZORA_BRIDGE_URL` with header
`X-Zora-Bridge-Token: $ZORA_BRIDGE_TOKEN`, and post lifecycle events to
`POST /__zora_desktop/event` with JSON `{ editor, id, payload }`.

`focus_editor` on Windows uses `EnumWindows` + `GetWindowThreadProcessId` to
find the PID's visible top-level window, then `ShowWindow(SW_RESTORE)` +
`SetForegroundWindow`. `close_editor` kills the child and waits; the monitor
thread (polling `try_wait`) removes the registry entry and emits the closed
event. macOS/Linux window activation is not implemented yet (`focused: false`).

## Dev & build

Prerequisites: Rust stable, Tauri v2 system deps (WebView2 on Windows). The
Tauri CLI is a local devDependency (`@tauri-apps/cli`), so no global
`cargo-tauri` is needed.

```sh
# Dev against the local Zora dev server:
pnpm desktop:dev

# Shell only (no sidecars):
pnpm desktop:check
pnpm desktop:build

# Single installer (shell + both editors):
pnpm desktop:package                   # release editors + release installer
pnpm desktop:package:debug             # existing debug editor builds, debug installer
node scripts/desktop-package.ts --dry-run   # show the plan only

# Rust unit tests (binary resolution, allowlist, token compare, HTTP parsing):
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```

Environment knobs: `ZORA_DESKTOP_URL`, `ZORA_STUDIO_BIN`, `ZORA_LIGHTCRAFT_BIN`.

## Simple Mode (Modo Simples)

When launched inside Zora Desktop (or embedded Zora mode), both editors open in **Modo Simples** by default to lower the barrier for non-technical content creators and keep AI-assisted edits clean, with a discreet **Avançado** toggle in the top bar to reveal the full pro toolset at any time:

- **Zora Studio (`zora-vector/crates/ui-egui`):** simplified top bar (Undo/Redo, **Inserir imagem**, design name + save status, **Avançado**, **Exportar**, **Voltar ao item**, **Salvar**), 7 essential tools (`selection`, `type`, `rectangle`, `ellipse`, `lineSegment`, `hand`, `zoom`), and a clean right dock limited to **Propriedades** and **Camadas**.
- **Zora LightCraft (`zora-lightcraft/crates/ui-egui`):** simplified top bar (Undo/Redo, Before/After, **Avançado**, **Exportar**, **Voltar ao item**, **Salvar**), Edit & Crop tabs only, **Aprimorar automático** (`develop.auto`) + **Redefinir**, 6 one-click **Estilos rápidos** (`Natural`, `Vibrante`, `Quente`, `Frio`, `P&B`, `Alto contraste`), 3 essential adjustment groups (**Luz**, **Cor**, **Acabamento**), and social-media crop ratios (`1:1`, `4:5`, `9:16`, `16:9`).
