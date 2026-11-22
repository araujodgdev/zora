# Zora Studio plan: designs, embedded editor, agent-driven design engine

Status as of 2026-11-18: **Z1, Z2, Z3 and Z4 done (Z4 against the contract, engine mocked); the other tasks planned**. Every task below has a
status line; whoever finishes a task updates it (what was done, how it was checked,
anything left), so another agent can pick up the next one from this file alone.

## Goal

A person asks their agent (through Zora's MCP server) for a piece of content, e.g. "make
an Instagram post for item X". The agent finds or generates the images, composes the post
as an editable **design** with Zora Studio's own engine running on the server, looks at
the rendered PNG, and iterates with the person ("which font?"). The person can open the
same design in Zora Studio, inside Zora, to polish it; the agent's next edit starts from
that polished version. The approved design's PNG becomes the item's media.

People are expected to talk to the agent more than they use Studio; Studio is for
polishing.

## The two repositories

| Repo | Path | Notes |
| --- | --- | --- |
| Zora | `C:\Users\douglas.araujo\Documents\dgstack\zora` | git, `main`. Read `AGENTS.md` first: its rules apply (docs-first, pt-BR UI, workspace scoping, D1 without transactions, tests). |
| Zora Studio | `C:\Users\douglas.araujo\Documents\dgstack\zora-vector` | a VectorCraft fork, **not a git repo**. Read its `AGENTS.md` (Rust only, never panic, never break wasm). |

## Decisions

| Topic | Decision |
| --- | --- |
| Design storage | A design belongs to a content item. Each save is an immutable **version**: the editable source (Studio's native `.vectorcraft`, JSON or gzip) plus a PNG preview, both in R2. |
| Concurrency | Every save names the version it started from (`baseVersionId`). A save whose base is not the current version is refused with 409 and the saver reloads; nobody overwrites anyone silently (same idea as `patchContentItem`). |
| Safety | Design sources are never served as something a browser renders: `application/octet-stream`, `attachment`, `nosniff`. Only PNG previews are shown inline. SVG uploads stay forbidden. The embedded Studio runs with the user's Zora session (same origin), so plug-ins and scripts are disabled in it. |
| Studio hosting | Studio's web build (`dist/web`, ~73 MB wasm) is too big for Workers static assets (25 MiB a file), so it lives in R2 under `studio/` and a Worker route serves it at `/studio/` (same origin as Zora, for the iframe and the session). |
| Editing in the browser | Zora page `/content/$itemId/designs/$designId` shows a thin Zora header and Studio in a full-height iframe. |
| Agent editing (option "B") | Studio's engine runs headless on the server in a **Cloudflare Container** (Workers Paid plan), as a stateless HTTP service: source in, commands run, source and PNG out. Zora's MCP tools call it and save the result as a new version. (Option "A", agents writing SVG, was dropped.) |
| Fonts | A curated library of OFL fonts (Google Fonts) lives in R2 (`studio-fonts/`) with a manifest. The browser Studio loads them at runtime; the same files are baked into the engine container. Styled lettering is done with Studio's own tools (warp, effects, 3D, outlines); Studio cannot make new font files. |
| Images for designs | MCP tools: stock photos from **Unsplash** and generated images from **fal**, keys held as Worker secrets. Both store the image as a content asset of the item; the agent places it in the design. |
| Out of scope for agents | Deploying, `pnpm db:migrate:remote`, publishing to remote R2, git commits and pushes, setting production secrets, upgrading the Cloudflare plan. Those are the owner's steps (see "Launch checklist"). |

## Contracts (all lanes build against these)

### Data (Zora, D1)

`content_design`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text uuid | PK |
| `content_item_id` | text | FK `content_item.id`, cascade |
| `name` | text | e.g. "Post do Instagram" |
| `width_px`, `height_px` | integer | the first artboard's size for a new design, 1..16384 |
| `preset` | text, nullable | Studio preset name, e.g. `Instagram Post 1080×1080` |
| `current_version_id` | text, nullable | null until the first save |
| `created_by_id` | text | FK user, restrict |
| `created_at`, `updated_at` | timestamp_ms | `updated_at` moves strictly forward on every write |

`content_design_version`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text uuid | PK |
| `design_id` | text | FK `content_design.id`, cascade |
| `number` | integer | 1, 2, 3 … per design (unique with `design_id`) |
| `author_kind` | text enum `user` \| `agent` | CHECK |
| `created_by_id` | text | FK user (the agent acts as its user) |
| `source_size`, `preview_size` | integer | bytes |
| `created_at` | timestamp_ms | |

R2 objects: `designs/<designId>/<versionId>/source.vectorcraft` and
`designs/<designId>/<versionId>/preview.png`. Deleting a design or its item deletes them.
Scoping: a design is visible only through its item's workspace.

### HTTP (Zora, same origin, session required, workspace-scoped)

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/designs/<designId>` | | `200` JSON `{id, itemId, name, width, height, preset, currentVersionId, currentVersionNumber, updatedAt}` |
| `GET /api/designs/<designId>/source[?version=<versionId>]` | | `200` bytes, `Content-Type: application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, header `X-Design-Version: <versionId>`; `404` when the design has no version yet |
| `GET /api/designs/<designId>/preview[?version=<versionId>]` | | `200` `image/png`, inline, `private`; `404` without a version |
| `POST /api/designs/<designId>/versions` | `multipart/form-data`: `source` (file, ≤ 50 MB, gzip magic or starts with `{`), `preview` (file, PNG magic, ≤ 20 MB), `baseVersionId` (empty for the first save) | `201` `{versionId, number}`; `409` `{error, currentVersionId, currentVersionNumber}` when `baseVersionId` is not current; `413`/`422` for bad files |

Server functions (Zora, `authMiddleware`): `listContentDesigns({itemId})`,
`createContentDesign({itemId, name, preset?} | {itemId, name, width, height})`,
`renameContentDesign`, `deleteContentDesign`, `listDesignVersions({designId})`,
`restoreDesignVersion({designId, versionId})` (copies that version's objects into a new
version), `publishDesignPreview({designId})` (copies the current PNG into the item's media
as a `content_asset`, filename `<name>.png`).

### Studio in Zora (iframe)

- Zora page: `/content/$itemId/designs/$designId` → iframe `src="/studio/?design=<designId>&theme=<dark|light>"`.
- Studio → parent `postMessage` (same origin, check `event.origin`):
  `{type: "zora-studio:saved", designId, versionId, number}`,
  `{type: "zora-studio:dirty", designId, dirty: boolean}`,
  `{type: "zora-studio:ready", designId}`,
  `{type: "zora-studio:back", designId}` (the person pressed "Voltar ao item" in Studio; added 2026-11-19, tasks Z5/R4).
- Studio with `?design=`: fetch the metadata; with a current version, fetch and open the
  source; without one, start a new RGB document of `width`×`height` px named after the
  design. Save to Zora = serialize the native file + render the first artboard as PNG at
  1× (longest side capped at 4096) + `POST …/versions` with the base version. On 409, ask:
  reload the latest version, or keep editing (a later save then bases on the current one
  only after the person confirms overwriting).

### Font library

- `GET /studio-fonts/manifest.json` (Zora, session) → `{version, families: [{family, category, license: "OFL-1.1", files: [{style, weight, italic, url, sha256, size}]}]}`; files under `GET /studio-fonts/<family>/<file>` from R2 `studio-fonts/…`, `Cache-Control: public, max-age=31536000, immutable` (file names carry a hash).
- Curated list (~40 families): Inter, Figtree, Fraunces, Poppins, Montserrat, Roboto, Open Sans, Lato, Oswald, Bebas Neue, Anton, Archivo Black, Playfair Display, DM Sans, DM Serif Display, Space Grotesk, Sora, Outfit, Manrope, Syne, Work Sans, Rubik, Nunito, Raleway, Merriweather, Lora, Abril Fatface, Lobster, Pacifico, Caveat, Permanent Marker, Dancing Script, Satisfy, Righteous, Bangers, Shrikhand, Bricolage Grotesque, Instrument Serif, Unbounded, Big Shoulders Display. OFL only, from `github.com/google/fonts` at a pinned commit, licence files kept.

### Engine service (Studio repo → container)

New Rust binary `apps/zora-studio-server` in `zora-vector` (HTTP, stateless; loads fonts
from `ZORA_FONTS_DIR` at start):

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /health` | | `200 ok` |
| `GET /commands[?q=]` | | engine command catalogue `[{id, label, params}]`, filtered by `q` |
| `POST /run` | JSON `{source?: base64, new?: {width, height, name}, images?: {<name>: base64}, commands: [{command, params}], render?: {scale?, maxSize?}, inspect?: bool}`; a string param `"zora-image:<name>"` is replaced by the path of that image | `200` `{source: base64, preview: base64 PNG, results: [...], inspect?: {...}}`; `422` `{error, index}` for the first failing command (nothing saved); limits: ≤ 200 commands, ≤ 60 s, ≤ 50 MB source, ≤ 20 images |

Details settled after Z4 (Zora's client already expects these; R3 implements them):

1. The server listens on `0.0.0.0:$PORT` (default 8080); `GET /health` answers `200` as soon as it can serve. Fonts are baked into the image and read from `ZORA_FONTS_DIR` (default `/fonts`); Zora does not pass it.
2. The Dockerfile's build context is the `zora-vector` repository root; the image is `linux/amd64`. The font files come from a build argument or a folder copied into the context (the library is produced by Zora's `pnpm fonts:sync`, cached under Zora's `.cache/`); document the exact build command.
3. `render` omitted means render with the defaults (`scale: 1`, `maxSize: 4096`); scale applies first, then the longest side is capped at `maxSize`. Only the first artboard is rendered.
4. A run with `inspect: true` and no commands may omit `source` and `preview` (Zora tolerates it); every other run returns both.
5. `results` is an array with one entry per command, in order: that command's JSON result (`null` when it has none).
6. `GET /commands` returns a bare JSON array `[{id, label, params}]`, `params` being the engine's own parameter doc string; `q` is a case-insensitive substring match on id and label.
7. `"zora-image:<name>"` is replaced when it is the whole value of a string at any depth of `params` (objects and arrays). Images may be PNG, JPEG, WebP, GIF or AVIF; a type the engine can't decode fails that command with `422`.
8. `source` comes back as the gzip-compressed native file (Zora accepts gzip or plain JSON, by magic bytes).
9. Errors other than `422` have the body `{error}`; `index` is 0-based. Limits answer `413`: source ≤ 50 MB, ≤ 20 images, ≤ 25 MB an image, ≤ 120 MB request body, ≤ 200 commands; a run over 60 s answers `504`.
10. The wire format stays JSON with base64 for now; a binary or multipart body is a later optimisation.

Zora MCP tools on top of it (B): `list_design_commands`, `list_design_fonts`,
`create_design`, `edit_design` (runs commands on the current version, saves a new
`agent` version, returns the PNG as image content), `render_design`, `inspect_design`,
`list_design_versions`, `restore_design_version`, `publish_design`; image tools
`search_stock_images`, `add_stock_image`, `generate_image`.

## Working rules for every agent

- Zora: follow `AGENTS.md`. UI text in pt-BR; code, comments, docs and MCP tool
  descriptions in English. Check with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
  Never commit, push, deploy, run remote migrations or touch remote R2.
- Zora Studio: follow its `AGENTS.md`. Before editing a file, copy it to
  `C:\Users\douglas.araujo\Documents\dgstack\zora-studio-backups\<task id>\<relative path>`
  (the repo has no git). Rust only; no panics; keep wasm building.
- **Only one Rust build on the machine at a time** (15 GB RAM: parallel builds and fat LTO
  run out of memory). The web release build is `trunk build --release` in
  `apps/vectorcraft-web` (~25 min, output `dist/web`); quick checks:
  `cargo check -p vectorcraft-ui-egui --no-default-features --features bundled-fonts,interface-fonts`
  and `cargo check -p vectorcraft-web --target wasm32-unknown-unknown`. Don't run `wasm-opt`.
- Docker Desktop is installed but may be stopped; start it when a task needs it.
- Update this file's task status when you finish, and say what you could not verify.

## Tasks

Two lanes run in parallel: **Z** (Zora, TypeScript) and **R** (Studio, Rust). Within a lane
tasks run in order. The final check (I) needs both lanes.

### Done before this plan (2026-11-17/18)

- Studio web build slimmed: `web-release` profile, only en + pt-BR catalogs (140 MB → 73 MB wasm, 25 MB gzipped).
- Studio rebranded and simplified for non-specialists: Zora mark, no Discord/ArtCraft links (licence notice kept in About and `/licenses/`), one Menu button, short toolbar, lean dock, channel-size presets on Home, pt-BR by default. Its test suite was **not** updated (task R1).

### Z1. Designs in Zora (step 1)

Status: **done 2026-11-18.** Migration `20261118034355_flaky_millenium_guard` (two
tables, CHECKs, unique `(design_id, number)`; applied locally). Code:
`src/lib/content-designs{.ts,.server.ts,.http.server.ts,.functions.ts,.queries.ts}`,
routes `src/routes/api/designs/$designId/{index,source,preview,versions}.ts`, UI
`src/components/content/content-designs.tsx`, placeholder editor page
`src/routes/_app/content/$itemId_.designs.$designId.tsx` (Z2 replaces its body), six MCP
tools, `AGENT_INSTRUCTIONS`, AGENTS.md "Designs". Checked: `pnpm typecheck && pnpm lint
&& pnpm test && pnpm build` pass; tests cover scoping, the 409 rule (stale base and two
racing first saves), signatures and sizes, safety headers, restore, publish, deletion of
R2 objects (design and item), the migration on existing data, and the MCP tools; `pnpm
dev` smoke test: the API answers 401 without a session and the editor page redirects to
sign-in. Contract notes: `createContentDesign` also accepts no name (preset label) and
neither preset nor size (the item's channel); non-multipart POSTs get 415 and a missing
`Content-Length` 411 (in addition to the contract's 413/422). Not verified: the item page
UI in a signed-in browser (no local credentials), at 390 px / iPad / desktop widths.

- Schema + migration for `content_design` and `content_design_version` (with a migration test).
- `content-designs.server.ts` (service functions taking `db`, `organizationId`), `content-designs.functions.ts`, query options and hooks, shared client-safe module `content-designs.ts` (limits, URLs, types, the channel → preset mapping: instagram → `Instagram Post 1080×1080`, x → `X Post 1600×900`, linkedin → `LinkedIn Post 1200×627`, blog → `Blog Cover 1200×630`).
- The HTTP routes above, with tests for scoping, the 409 rule and the safety headers.
- Item deletion removes design objects too.
- Item page (`/content/$itemId`): a "Designs" section (pt-BR): cards with the latest PNG, "Novo design" (size from the item's channel, other sizes selectable), open (link to the editor page, works once Z2 lands), versions list with restore, publish to media, rename, delete.
- MCP tools that need no engine: `create_design`, `list_designs`, `get_design` (returns the PNG as image content when small enough), `list_design_versions`, `restore_design_version`, `publish_design`. Update `AGENT_INSTRUCTIONS`.
- `AGENTS.md`: document the designs module, routes and rules.

### Z2. Studio hosted and embedded in Zora (step 2, Zora side)

Status: **done 2026-11-18.** Code: `src/lib/studio-hosting{.ts,.server.ts}` (bundles,
path safety, content types, cache rules, `postMessage` parsing, `serveBundleFile`),
routes `src/routes/studio/$.ts` and `src/routes/studio-fonts/$.ts` (GET/HEAD, session
or 401, ETag/304, `/studio` → 308 `/studio/`), `src/lib/studio-fonts.ts` (curated
list, pinned google/fonts commit `7af0d90b4d532ffa4b041937b560c6df4e7b1e95`,
`METADATA.pb` parser, manifest builder), scripts `scripts/studio-publish.ts`,
`scripts/fonts-sync.ts`, `scripts/lib/r2-store.ts` (`pnpm studio:publish`, `pnpm
fonts:sync`, both with a documented `--remote` that was not run), the editor page
`src/routes/_app/content/$itemId_.designs.$designId.tsx`, AGENTS.md "Zora Studio
hosting". Checked: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass
(new tests: path safety, types, cache rules, messages, 304/HEAD/404 with a fake
bucket, the text-proto parser and the manifest builder); `pnpm studio:publish` put the
current `dist/web` (10 files, 70.1 MiB) into local R2 and a second run deleted a stale
object; `pnpm fonts:sync` put 38 families (126 font/licence files + manifest, 37.6
MiB) — Permanent Marker and Satisfy are Apache-2.0 in google/fonts and were skipped;
`serveBundleFile` against the real local R2 (through `getPlatformProxy`) served
index.html (`text/html`, `no-cache`), the .js and the 73 MB .wasm (`application/wasm`,
immutable, full length), licences as text, the manifest and a font; `pnpm dev` + curl:
`/studio` 308, `/studio/`, the wasm and the manifest 401 without a session. Contract
notes: the manifest adds `source`, `licenseUrl`, `axes` and per-file `variable` (most
families are variable TTFs: one file per upright/italic, weight 400, range in `axes`);
font URLs are `/studio-fonts/<folder>/<name>-<sha16>.<ext>`. Not verified: the signed-in
path through `pnpm dev` (no local credentials; the handler was exercised against the same
R2 data instead), the editor page in a browser (iframe, messages, blocker, phone/iPad
layouts), and Studio actually starting under `/studio/` (needs R2's build with the
`?design=` mode). Whether Cloudflare compresses `application/wasm` on the way out is
unchecked (25 MB gzipped vs 73 MB).

- Worker route `/studio/*` serving Studio's files from R2 `studio/…` (session required; `application/wasm` for `.wasm`; immutable caching for hashed files, `no-cache` for `index.html`); script `pnpm studio:publish` that uploads `../zora-vector/dist/web` to the local R2 (`--remote` documented, not run).
- Editor page `/content/$itemId/designs/$designId`: Zora header (back to the item, design name, saved/unsaved state from `postMessage`), Studio iframe with the theme from `zora_theme`; refresh the design queries on `saved`; warn before leaving with unsaved changes.
- Font library: `pnpm fonts:sync` (download the curated OFL families at a pinned commit, write manifest, upload to local R2) and the `/studio-fonts/*` routes.

### R1. Studio test suite after the rebrand

Status: done (2026-11-18). About 75 tests in ui-egui and 5 in engine now test the new UI: app bar (Home/Menu/Undo/Redo, search gives way before Export), Home (Zora size cards, Other size…, no Learn/Community), Basic toolbar, dock (Properties+Layers main column, trimmed icon rows), Document/Appearance Properties, Zora preset category, Mac menus, Safe Mode label. Product fixes: the Menu button lost #516 (Edit/Select All acting on the focused text field), now shared with the old menu bar; links/commands that open a panel with no icon (Control bar Opacity, Properties Appearance/Transparency/Paragraph, double-clicking Gradient, Shift+F6 and others) did nothing and now float the panel; pt-BR "Essentials" row removed (workspace names stay in English); `file.newPresets` and `window.learn` docs updated for agents. Results: ui-egui lib 5242 passed / 3 failed, integration tests all pass; engine 7279+693 passed / 1 failed. The 4 failures are Windows-only (8.3 temp paths, CRLF text export) and unrelated to the rebrand. `cargo clippy -p vectorcraft-ui-egui -p vectorcraft-engine --all-targets --no-deps -D warnings` is clean (without `--no-deps` an old lint in vectorcraft-trace fails); `cargo fmt` applied; `xtask ui-commands --check` passes; `xtask assets` needs git (checked by hand: every `assets/zora` file has an ASSETS.md row). Not done: vectorcraft-mcp tests not run; wasm build not rerun; the Mac app menu still says "Quit/Hide VectorCraft"; the All Tools drawer puts tools missing from the short toolbar under "More".

- Run `cargo test -p vectorcraft-ui-egui` (and `-p vectorcraft-engine` for the new Zora preset category) and update the tests that encoded the old UI (Discord, Learn, workspace switcher in the bar, "Welcome to VectorCraft", Home sections, toolbar contents, dock icon groups, document Properties sections, About tabs). Change product code only for real bugs. Make `cargo clippy` clean for the touched crates.

### R2. Studio embedded mode (step 2, Studio side)

Status: **code done 2026-11-19; release web build + `pnpm studio:publish` pending, run by the orchestrator.** Code (zora-vector, backups under `zora-studio-backups\R2`): `crates/ui-egui/src/zora.rs` (embedded mode: `attach`, `Embed`, `Link` for requests and page messages, commands `zora.save {overwrite?}` and `zora.reloadLatest {confirmed?}`, the `zoraConflict` dialog, dirty/ready/saved messages), `zora/wire.rs` (pure: metadata parsing, multipart upload with a boundary absent from the data, save replies, the save state machine with the 409 rule, font manifest parsing + SRI, preview scale), `zora/tests.rs`; `apps/vectorcraft-web/src/zora.rs` (same-origin `fetch` with credentials, `X-Design-Version`, `postMessage` to the parent with the page's origin) and `fonts.rs` (Zora font library); engine `Session::embedded` + `EMBEDDED_REFUSES` (`plugin.install/reload/run`, `script.run`) refused in `execute` and shown off in `info`; app bar Save (primary, "Salvando…" while in flight) + Export (secondary) inside Zora; File › Save / Ctrl+S of the design → `zora.save`; `ui.installPlugin`, `ui.runScript`, `ui.runInstalledScript`, `plugin.dialog` refused and dimmed; Mac app menu now "Zora Studio" (Quit/Hide); pt-BR catalog rows; `crates/mcp/src/ui_catalog.rs` regenerated. Behaviour: `?design=` loads metadata + current source before the app starts (401/403/404/network/invalid id → pt-BR text on the loading screen), opens the source (or a new RGB document of width×height px, from `preset` when Studio knows it, size always the design's) named after the design, sends `ready`; save = `document.serialize` vectorcraft gzip + first artboard PNG at 1× capped at 4096 px, multipart `source`/`preview`/`baseVersionId`, ignored while in flight; 201 → document saved as of the snapshot (edits during upload stay dirty), status "Salvo (versão N)", `saved` message; 409 → dialog "Abrir a versão mais recente" (asks before discarding) / "Continuar editando", next save asks to replace version N then bases on it; other errors → status + message dialog. Fonts: manifest fetched; the families the source uses and no loaded font has (`missing_fonts`) load before the document opens (8 s per file, 15 s overall), the rest in the background; variable fonts load as one face whose `fvar` named instances the font DB lists as styles (weights show in menus and resolve by name). Checked: `cargo check -p vectorcraft-web --target wasm32-unknown-unknown` clean; `cargo test -p vectorcraft-engine --test embedded_mode` 2/2; ui-egui lib `zora` tests 17/17 (multipart body and base version, boundary collision, 409 state machine, overwrite confirm, reload, gating, manifest parsing, new/existing design open, dirty/ready/saved messages); full ui-egui lib suite 5256 pass / 4 fail: 3 are R1's known Windows-only failures, 1 (`language_command_sets_the_preference`, looked up the app menu as "VectorCraft") was fixed in the test afterwards but not re-run (24 min rebuild). Not done/verified: the release build (two attempts here failed in the final link: `rust-lld` 0xc0000142, then LLVM out of memory with ~3.5 GB free; close other apps before running it), publish to local R2, any browser run of `/studio/?design=…` (signed-in or not), clippy, the design document being closed by the person (save then answers "reload the page"), Safe Mode not turned on (on the web no plug-in survives a reload, and installing is refused). Standalone `/studio/` without `?design=` runs on Zora's origin too with plug-ins and scripts on; consider locking it as well.

- `?design=<id>` mode in the web app: load per the contract, save to Zora (app bar: "Salvar" as the primary button when embedded, Ctrl/Cmd+S saves to Zora), dirty tracking, `postMessage` events, the 409 flow, the status line.
- Plug-ins and scripts disabled in embedded mode (commands refuse with a clear message; menus hide or dim them).
- Runtime fonts from `/studio-fonts/manifest.json`: the families the opened document uses load before it is shown, the rest in the background; they appear in the font menus.
- Build with `--public-url /studio/` (Trunk.toml or the publish script) so the app works under `/studio/`.
- Tests for the save request (multipart body, base version) and the 409 handling where possible without a browser.

### R3. Engine service (option B, Studio side)

Status: **done 2026-11-19 (code, tests, local run with the debug binary); Docker image not built.** Code (zora-vector, backups under `zora-studio-backups\R3`): new workspace crate `apps/zora-studio-server` (lib + bin, `[lints] workspace = true`, crate-level no-panic denies; `src/{lib,run,http,catalog,fonts,tempdir,main}.rs`, `tests/server.rs`, `Dockerfile`, `Dockerfile.dockerignore`, `README.md` with the build/run/push commands). One new dependency: `tiny_http` 0.12 (MIT OR Apache-2.0; pulls `ascii`, `chunked_transfer`, `httpdate`, all MIT/Apache-2.0). Contract as settled: `0.0.0.0:$PORT` (8080), `/health` only after the fonts are loaded; `/commands` bare `[{id,label,params}]`, `q` case-insensitive on id/label, plug-in/script commands left out; `/run` JSON+base64, `zora-image:<name>` replaced at any depth by the image's path in a per-run temp folder (images placed with `file.place` get `link: false` unless the caller sets it, because `file.place` otherwise links a raster given by path; `link: true` with a run image → 422), one result per command, gzip native source, first artboard PNG (scale, then maxSize cap; defaults 1/4096), 422 `{error,index}` from 0, inspect-only runs return `{results: [], inspect}`, 413 for limits (body 120 MB, source 50 MB in and out, preview 20 MB, 20 images, 25 MB each, 200 commands), 504 after 60 s, 400 for a body that isn't a run or a source that won't open, 503 when both run slots stay busy 30 s. Safety: fresh `Session` per run on its own thread (64 MB stack), `Session::embedded` on, file access confined to the run folder through the engine's automation roots (reading or saving elsewhere fails), cancel token + deadline checked between commands, panics caught per command and per request, folder removed after the run (stale ones >15 min removed at start), at most 2 runs at a time (`ZORA_RUNS`) and 4 bodies in memory. Fonts: every `.ttf/.otf/.ttc/.otc` under `ZORA_FONTS_DIR` (default `/fonts`, any depth) goes to `FontDb::global().add_font` at start (bundled fonts too). Also from R2: the web app now sets `Session::embedded` at start always (plain `/studio/` too), and the app-level refusals (`ui.installPlugin`, `ui.runScript`, scripts menu, `plugin.dialog`) follow `session.embedded` instead of `?design=`. Checked: `cargo test -p zora-studio-server` 13/13 (with `ZORA_TEST_FONTS_DIR` set to the font cache: new document + commands + render with PNG signature and size, scale/maxSize, image placement + embedded + folder removed, nested replacement, inspect-only, 422 indexes, refused plug-ins/scripts, paths outside the run folder refused, every limit, 504, catalogue filter, round trip on gzip and plain JSON sources, Bebas Neue resolving by name, HTTP routes over a socket); clippy `--all-targets --no-deps -D warnings` clean, fmt applied; ui-egui `language_command_sets_the_preference` and the `zora::` tests pass (with the new `the_web_app_without_a_design_refuses_plug_ins_and_scripts_too`); `cargo check -p vectorcraft-web --target wasm32-unknown-unknown` clean. Local run (debug binary; the thin-LTO release link was killed for lack of memory): from zora-vector, `PORT=8080 ZORA_FONTS_DIR=<folder with library families, e.g. ../zora/.cache/fonts/7af0d90b4d532ffa4b041937b560c6df4e7b1e95> ./target/debug/zora-studio-server.exe`, then `curl http://127.0.0.1:8080/health` (ok), `curl "http://127.0.0.1:8080/commands?q=text.create"` (2 of 1033), `curl -X POST http://127.0.0.1:8080/run -H "Content-Type: application/json" --data-binary @run.json` with a 1080×1080 design, rectangles, text in Bebas Neue and Poppins Bold and a placed 512 px PNG: 200 in 0.6 s, no font warnings, a 1080×1080 PNG showing both fonts and the image; the returned source ran again (1 image, 2 type objects, 0.25 scale → 270×270); unknown command → 422 `{index: 0}`. Server stopped. Not done/verified: the Docker image (Docker Desktop not running, <3 GB free; the Dockerfile is unbuilt, including the `rust:1.99-slim-bookworm` tag and the Linux build), a release binary, Zora's MCP tools against this server (task I: set `STUDIO_ENGINE_URL=http://127.0.0.1:8080`), AVIF/HEIC placement (the engine decides; unknown types fail with 422). Process-wide engine state (font DB, hyphenation exceptions) is shared between runs; commands that change it can affect later runs. The font staging folder `apps/zora-studio-server/fonts` (see the crate README) must not be kept in the repo (`cargo xtask assets`). Zora's README build command matches the Dockerfile (context `../zora-vector`, `-f …/Dockerfile`), but the font staging step (crate README, step 1) has to run first.

- `apps/zora-studio-server` per the contract (pick a small, permissively licensed HTTP crate), tests for `/run` (new document, commands, render, image placement, failing command → 422, limits), Dockerfile (multi-stage, Linux, fonts copied from the font library into `ZORA_FONTS_DIR`).

### Z3. Images for designs

Status: **done 2026-11-18.** Code: `src/lib/image-providers.server.ts` (Unsplash and
fal over plain `fetch`: timeouts, status checks, https-only provider hosts with
redirects re-checked, 30 MB cap while reading, image type sniffed from the bytes),
three MCP tools in `src/lib/mcp.server.ts` (`search_stock_images`, `add_stock_image`,
`generate_image`), optional env `UNSPLASH_ACCESS_KEY` / `FAL_KEY` (`getServerEnv`,
`.env.example`, README), migration `20261118042243_salty_sasquatch` (nullable JSON
`content_asset.attribution`, applied locally) shown in the media tile and viewer
("Foto: Nome / Unsplash" with links, "Imagem gerada por IA"), `AGENT_INSTRUCTIONS`,
AGENTS.md. fal endpoint: `fal-ai/nano-banana-2` (`FAL_IMAGE_MODEL`; aspect ratio from
the design's size, 1K, or 2K for designs over 1200 px, JPEG out, 1-4 images, polled
every 2.5 s up to 90 s then cancelled: at most ~43 subrequests). Not in WebMCP (paid
calls to outside services with server keys). Checked: `pnpm typecheck && pnpm lint &&
pnpm test && pnpm build` pass; tests (`mcp.image-tools.test.ts`,
`image-providers.server.test.ts`, `asset-attribution-migration.test.ts`) mock `fetch`
and cover success paths and request shapes (headers, query, UTM links, `ixid` kept,
tracking after storing), missing keys, provider errors, wrong-type / fake /
oversized (declared and streamed) downloads, foreign hosts and redirects, fal
failure, timeout + cancel, partial failures, and workspace scoping. Not verified: the
live APIs (no keys; request shapes checked against the docs only), the UI credit in
a browser. Unsplash's hotlinking rule is not met for stored copies (a design embeds
the photo, so Zora keeps a copy, reports it with the download-tracking call and keeps
the credit with it); if the Unsplash application review objects, the fallback is to
place photos into designs only at render time.

- `search_stock_images` (Unsplash search; read and follow the Unsplash API guidelines: attribution, download tracking, hotlinking rules), `add_stock_image` (stores it as a content asset, attribution kept), `generate_image` (fal; pick a current text-to-image endpoint from fal's docs; aspect from the design size). Secrets `UNSPLASH_ACCESS_KEY`, `FAL_KEY` read with `getServerEnv`; clear tool errors when unset. Tests with mocked HTTP.

### Z4. Agent-driven design editing (option B, Zora side)

Status: **done 2026-11-18, against the contract (R3 does not exist yet; the engine is
mocked in tests).** Code: `src/lib/studio-engine.server.ts` (typed client: `runEngine`,
`listEngineCommands`, `engineHealth`; limits checked before sending and while reading;
100 s / 45 s timeouts; 422 -> `StudioEngineCommandError`), `src/lib/studio-engine-container.server.ts`
(`StudioEngine` Durable Object with the Durable Object Container API, `durable_object`
scheduling policy, image `images.engine`, `standard-1`, no Internet, `PORT=8080`, `/health`
readiness, sleeps after 5 min, 2 instances; `getStudioEngine()`: `STUDIO_ENGINE_URL` wins,
else the binding, else null), `src/server.ts` (new Worker entry exporting the class;
`wrangler.jsonc` `main` changed), `wrangler.jsonc` (DO binding `STUDIO_ENGINE`, `exports`
SQLite entry, **`containers` entry commented out = the switch**, `dev.enable_containers:
false`), `STUDIO_ENGINE_URL` in `getServerEnv`/`.env.example`/README, five MCP tools
(`list_design_commands`, `list_design_fonts`, `edit_design`, `render_design`,
`inspect_design`), `AGENT_INSTRUCTIONS` (the design workflow), AGENTS.md "Design engine",
README "Design engine". No new dependency (`@cloudflare/containers` not needed: the docs
now use `ctx.container` directly). Checked: `pnpm typecheck && pnpm lint && pnpm test &&
pnpm build` pass (new: `studio-engine.server.test.ts`, `mcp.engine-tools.test.ts`: new
design and existing version, 422 mapping, stale base and a Studio save during the run
(409), images passed by name and other workspaces' images/designs refused, missing
configuration (null and 503), size limits, timeout, oversized answers, compact command
list, fonts manifest); `pnpm dev` starts and serves with the container both off and
switched on (fake digest; no Docker needed), the `StudioEngine` namespace is registered,
`/mcp` answers 401; `pnpm build` output exports `StudioEngine` and carries the
containers entry when on. Not verified: the real engine (R3), a deployed container (no
Paid plan, no image), the Durable Object path end to end in `pnpm dev` (needs an MCP
token; the 503 `not-configured` mapping is unit-tested), `wrangler deploy --dry-run` with
the entry on, and a local end-to-end run with Docker (Wrangler refuses containers on
Windows; WSL would be needed). Open questions for R3 are in the Z4 report: port and
env vars, build context, `render` defaults, inspect-only runs, `results`/`params` shapes,
the error body for non-422 failures.

- Cloudflare Container for the engine service (`@cloudflare/containers`, wrangler `containers` config, image from R3's Dockerfile), a typed client for `/run` and `/commands`.
- MCP tools `list_design_commands`, `list_design_fonts`, `edit_design`, `render_design`, `inspect_design` (the rest exist from Z1); `edit_design` takes image asset ids and passes their bytes as `images`. `AGENT_INSTRUCTIONS`: the design workflow (create at the channel size, get images, compose, render and look, ask the person, publish when approved; keep text as text unless a headline needs outlines).
- Tests with the engine client mocked; a local end-to-end run with `wrangler dev` and Docker if it works on this machine.

### Z5. Full-bleed editor page (owner request, 2026-11-19)

Status: **done 2026-11-19.** Code: `src/components/app-shell.tsx` (routes with
`staticData: { fullBleed: true }` get no page padding and `--page-h` = the full height
right of the sidebar: `100svh` from `lg`, `100svh - top bar` below; `PAGE_PADDING`
exported for fallback states; `StaticDataRouteOption.fullBleed` declared there), the
editor route (no header, iframe fills `h-(--page-h)` with no border/radius; `back`
navigates to the item keeping `from`, through the existing blocker; 404/401/network
states, phone and not-found states keep a small back link and padding),
`parseStudioMessage` + tests (`zora-studio:back`), AGENTS.md. Checked: `pnpm typecheck
&& pnpm lint && pnpm test && pnpm build` pass. Not verified in a browser (the layout at
390/820/1180 px, the message round trip with R4's Studio build).

- The editor page `/content/$itemId/designs/$designId` drops its Zora header: Studio's iframe fills the whole area right of the sidebar (no page padding, full `--page-h` height, no border). The design name, size and save state now live in Studio.
- Handle `zora-studio:back`: navigate to the item page (keep `from`); the existing unsaved-changes blocker still asks first when Studio reported dirty.
- Keep the 404/401 "Studio not published" states and the phone message; update tests (`parseStudioMessage`) and AGENTS.md.

### R4. "Voltar ao item" inside Studio (owner request, 2026-11-19)

Status: **done 2026-11-22.** Tested and built on Google Colab (`araujodgdev/zora-studio@a6dcde9`, thin LTO `web-release`, `vectorcraft-web-89a0ffa1f7d090f5_bg.wasm` 73.13 MB / 25.3 MB zip): all 4 R4 tests, all 5,300 `vectorcraft-ui-egui` tests, doctests, `ui-commands --check` and `wasm-check` passed (`clippy::type_complexity` at `zora.rs:244` and `fmt-check` left for a small follow-up cleanup). `generated.patch` (`zora.back` in `crates/mcp/src/ui_catalog.rs`) applied to `zora-vector`; `dist/web` extracted and published to local and remote R2.

- In embedded mode (`?design=`), Studio's app bar shows a "Voltar ao item" button beside "Salvar" (secondary style, left of it, with a back arrow), which posts `{type: "zora-studio:back", designId}` to the parent with the page's own origin. It does not discard anything itself: Zora asks about unsaved changes.
- In embedded mode hide the Home button (Studio's Home screen means nothing inside Zora) and keep everything else.
- Tests for the message and the button's presence only in embedded mode; pt-BR string. The release web build and `pnpm studio:publish` are run by the orchestrator.

### I. End-to-end check

Status: **local browser check passed 2026-11-22 (owner).** Published Studio (R4 Colab LTO build) and fonts to local and remote R2; ready for production deploy (engine container deferred until Workers Paid + Docker image push).

- Local: publish Studio and fonts to local R2, `pnpm dev`, create an item, create a design, edit and save it in the embedded Studio, have the MCP tools edit it (engine container), see the new version in Studio, publish the PNG. Record what was verified and what was not.

## Launch checklist (owner)

- Workers Paid plan (Containers need it).
- Design engine (after R3): build the image from `../zora-vector/apps/zora-studio-server/Dockerfile`
  (linux/amd64), `pnpm exec wrangler containers push zora-studio-engine:<tag>`, get its
  digest, uncomment the `containers` entry in `wrangler.jsonc` with
  `images.engine.image = registry.cloudflare.com/<account>/zora-studio-engine@sha256:<digest>`
  (README, "Design engine"); repeat for every engine update. Wait a few minutes after the
  first deploy before trying the tools.
- Secrets: `UNSPLASH_ACCESS_KEY`, `FAL_KEY` (`wrangler secret put`).
- Unsplash app: apply for production access (demo keys allow 50 requests/hour; the review checks the API guidelines, see Z3 on hotlinking). fal: credits on the account behind `FAL_KEY`.
- `pnpm db:migrate:remote`, `pnpm studio:publish --remote`, `pnpm fonts:sync --remote`.
- Push to `main` (Workers Builds deploys).
