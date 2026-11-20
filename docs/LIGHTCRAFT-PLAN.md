# Zora LightCraft plan: photo edits, embedded editor, agent-driven photo engine

Status as of 2026-11-19: **analysis done; every task below is planned, none started.** The decisions
(D1–D5) are proposed with a recommendation each; the owner confirms them before the first task.
Reviewed 2026-11-20 against the LightCraft and Zora code and the Cloudflare limits docs; the
corrections (asynchronous open, page-side dirty polling, `app.export` params, the 100 MB request
body cap, binary transport to the engine, originals always copied) are folded in below.
Whoever finishes a task updates its status line (what was done, how it was checked, anything left),
so another agent can pick up the next one from this file alone.

This plan mirrors [STUDIO-PLAN.md](STUDIO-PLAN.md) (Zora Studio / VectorCraft). Read that file first:
its "Contracts" style, its working rules and its launch checklist apply here too, and much of its
Zora-side machinery is reused, not rebuilt. Where the two plans share code (`studio-hosting`,
`r2-store`, the designs service pattern, the engine client and Durable Object container), a change
for LightCraft must keep Studio working; Studio's tests are the guard.

## Goal

A person asks their agent (through Zora's MCP server) to prepare a photo for a content item, e.g.
"reveal the product photo for item X and make it brighter". The agent develops the photo with
LightCraft's own engine running on the server (exposure, colour, crop, denoise), looks at the
rendered preview, and iterates with the person. The person can open the same photo in LightCraft,
inside Zora, to polish it; the agent's next edit starts from that polished version. The approved
render becomes the item's media.

LightCraft is a **photo library + non-destructive raw developer** (an Adobe Lightroom clean-room
sibling of VectorCraft). Unlike a Studio design, there is no single editable document file: an edit
is a set of **develop settings** applied to an **original photo**, and every export is a flattened
render. The version model below keeps the settings, not a flattened file, as the editable source.

## The two repositories

| Repo | Path | Notes |
| --- | --- | --- |
| Zora | `C:\Users\douglas.araujo\Documents\dgstack\zora` | git, `main`. Read `AGENTS.md` first: its rules apply (docs-first, pt-BR UI, workspace scoping, D1 without transactions, tests). |
| LightCraft | `C:\Users\douglas.araujo\Documents\dgstack\zora-lightcraft` | a clean copy of upstream LightCraft **v0.21.1**, **not a git repo**, no Zora adaptation yet (a grep for "zora" finds nothing). Read its `AGENTS.md` (clean-room, never panic, pure Rust, `cargo xtask ci`, asset attribution, layering). |

A third folder, `C:\Users\douglas.araujo\Documents\dgstack\zora-studio-backups`, holds Studio's
per-task source snapshots (R1–R4). LightCraft tasks that edit Rust files use the same discipline
under a new `zora-lightcraft-backups` folder (see "Working rules").

## What exists today (analysis, 2026-11-19)

### LightCraft upstream (no adaptation needed for the MVP)

- **Web build**: `cargo xtask web` → `target/web-site/` (`index.html`, `worker.js`,
  `lightcraft_web.js`, `lightcraft_web_bg.wasm`, plus `.gz`/`.br` precompressed copies). Measured
  sizes (`docs/web.md`): wasm **13,533,126 B raw / 4,583,465 gzip / 3,093,780 brotli**. File names
  are **fixed across versions** (no content hash) → everything must be `no-cache`. The optional
  Chinese face (`lightcraft_zh_hans.otf`, ~16 MB) ships beside the wasm only when built with
  `CRAFT_FONTS_DIR`; without it the build works, CJK text lacks glyphs. Build prerequisites are
  already on this machine: `wasm32-unknown-unknown` target and `wasm-bindgen` CLI **0.2.129**,
  which matches `Cargo.lock` exactly (xtask enforces the match).
- **Embedding bridge, already implemented and tested upstream**:
  `apps/lightcraft-web/src/host.rs`, enabled by `?host=parent` (same-origin iframe) or
  `data-host="page"` (CustomEvents on the canvas, same document). Protocol:
  - LightCraft → parent: `lightcraft:ready {version}`, `lightcraft:failed {error}`,
    `lightcraft:dirty {dirty}` (on change), `lightcraft:save {name, bytes}` (a transferred
    ArrayBuffer, for **everything that would be downloaded**: exports and the library backup),
    `lightcraft:response {ok, value}` (the JSON result of a `cmd`).
  - Parent → LightCraft: `lightcraft:open {name, bytes}` (add a photo; refused above the library
    backup cap, ~4 GiB − 64 MiB, `backup::MAX_BYTES`), `lightcraft:cmd {id, params}` (run any
    engine/UI command by id). **`params` is a JSON *string*** (`JSON.stringify({...})`): the bridge
    reads it with `as_string()` (`host.rs`), so an object is silently taken as `{}`. The response's
    `value` is likewise JSON text (or the error text when `ok` is false).
  - `lightcraft:open` gets **no answer** and is **asynchronous**: the bytes are stored
    (`spawn_local(store_file…)`, `web.rs` `run_host`), queued (`Originals::added`, `store.rs`) and
    imported with `library.import` on a later frame. A `cmd` sent right after an `open` runs before
    the photo exists. The import selects the new photo (`import.rs`, `Selection::single`), but
    identical bytes are deduplicated by content hash: re-sending the same original to the same
    iframe adds nothing and changes no selection.
  - Responses carry **no request id**: they come back in the order the commands were sent, one per
    `cmd`. The page keeps exactly one command in flight at a time (one queue for the open flow, the
    dirty poll and the save flow).
  - Only the same-origin parent is heard or answered; an opaque or cross-origin parent gets no
    bridge. This is the **parent-driven** model: the page does the HTTP, the wasm only receives
    and hands back bytes. Studio's model is the opposite (the wasm fetches/saves with the session
    cookie); see D3.
- **URL options** (`docs/web.md`): `?store=idb|memory` (default OPFS, fallback IndexedDB),
  `?workers=N` (render workers, default cores − 1, max 4), `?reset`, `?bench`. **There is no
  `?theme=` parameter**; the UI language follows `navigator.languages` automatically (a pt-BR
  browser gets the pt-BR catalog, 85% translated upstream).
- **Commands the integration needs** (engine ids confirmed in `crates/engine/src/cmd/`;
  `app.export` is a UI command, see below):
  - `develop.get {id?}` → the photo's develop settings JSON + `process` version
    (`cmd/query.rs`; without `id`, the active photo).
  - `develop.merge {settings, label?}` → applies a **partial** DevelopSettings JSON (one undo step)
    to the **active photo only** (no `id` param, `cmd/develop.rs`). Keys absent from `settings`
    keep their current values, so a saved version is restored only onto a **freshly imported**
    original (default settings), never onto a photo that already has edits.
  - `develop.set {control, value}` / `develop.controls` → slider edits / the control catalogue.
  - `app.export {…}` → a **UI command** (`crates/ui-egui/src/control.rs`, `export_active`), not an
    engine command; it calls the shared `lightcraft_engine::export::export_batch`. On the web each
    file goes to `services.write`, which posts `lightcraft:save` **synchronously, before** the
    command's `lightcraft:response`. It needs `path` (exact file name, one photo) or `dir`: the web
    has no home folder, so without either it fails with "Choose an export folder first." It also
    stores the params as `last_export` in prefs (harmless with `?store=memory`). Options come from
    `ExportOptions::from_params` (`crates/engine/src/export/params.rs`; default JPEG, quality 90,
    no resize, metadata `All`).
  - `photo.saveMetadataToFile` / `photo.readMetadataFromFile` → XMP sidecars **inside the library
    storage** (OPFS on the web), not to the parent; useful only with a persistent library (D4).
  - `file.backupLibrary` / `file.restoreLibrary` (web-only) → the whole library as a zip through
    `lightcraft:save`; too heavy for per-photo versions, kept as an escape hatch.
- **Headless already exists**: `lightcraft-cli` (`render in.jpg -o out.jpg --set light.exposure=1`,
  `commands`, `snapshot --demo --script …`, `mcp`). The engine export path is shared by app, CLI,
  MCP and web (`lightcraft_engine::export`). A server container needs only a thin HTTP wrapper
  (task L4), not a new engine.
- **Known web limitations** (`docs/web.md`, "Not yet"): exports and auto-adjustments run on the
  main thread and can answer "still loading" right after a reload until the original is in memory;
  durability is "a frame later"; wasm is built `panic = "abort"` (a decoder panic replaces the page
  with a message, the stored library is kept); JPEG XL export is native-only; AVIF export untested
  on wasm; HEIC import is the optional `heif` feature (HEVC patents, distributor's choice). Raw
  coverage in the browser is the desktop's: CR3 decodes on 26 verified Canon bodies (rarer variants
  fall back to the embedded preview), Nikon HE NEF and compressed ORF open as previews.

### Zora machinery to reuse (from the Studio integration)

- `src/lib/studio-hosting{.ts,.server.ts}`: `serveBundleFile` (R2 → Response, session, GET/HEAD,
  ETag/304, streaming), `resolveBundlePath` (path safety), `bundleContentType`, the hash-based
  immutable / `no-cache` rules, `parseStudioMessage`. Generalise the bundle map to a second entry
  (`lightcraft/`) instead of copying it (task Z1).
- `scripts/studio-publish.ts` + `scripts/lib/r2-store.ts`: upload a sibling build to local R2
  through `getPlatformProxy`, index last, stale-object cleanup, documented `--remote` (owner only).
  Mirror it as `pnpm lightcraft:publish` (task Z1).
- The designs pattern: `content-designs{.ts,.server.ts,.http.server.ts,.functions.ts,.queries.ts}`,
  the `/api/designs/*` routes, the immutable-version + `baseVersionId`/409 concurrency without
  transactions (`db.batch` guarded UPDATE + `INSERT … SELECT`), the safety headers, the item-page
  cards UI, the MCP tools. Photo edits copy this shape (task Z2).
- The editor route pattern: `_app/content/$itemId_.designs.$designId.tsx` (fullBleed, iframe,
  origin+source message checks, dirty router blocker + `beforeunload`, query invalidation on save,
  404/401/phone states). Photo edits get an analogous route (task Z3).
- The engine pattern: `studio-engine.server.ts` (typed client, limits, timeouts),
  `studio-engine-container.server.ts` (Durable Object Container, `ctx.container`, digest-pinned
  image, `/health` readiness, sleep after 5 min), the commented `containers` switch in
  `wrangler.jsonc`, `STUDIO_ENGINE_URL` for local dev. A second engine (LightCraft) copies it
  (task Z6).

### Studio integration status (context, not this plan's work)

Z1–Z5 and R1–R3 are code-done and tested locally; still pending there: the release web build +
`pnpm studio:publish`, the Docker image (never built), the container switch (off, needs Workers
Paid), the owner's end-to-end check and launch checklist. The LightCraft plan assumes that
machinery exists as code, not that it runs in production.

## Decisions (proposed — the owner confirms before Z1)

| # | Topic | Recommendation | Alternative |
| --- | --- | --- | --- |
| D1 | Hosting | **R2 + a `/lightcraft/*` Worker route**, reusing `studio-hosting` generalised to a bundle map, published by `pnpm lightcraft:publish`. | Workers Static Assets: **ruled out**, the real release wasm is 34 MB (L1), over the 25 MiB limit with `run_worker_first` scoped to `/lightcraft/*` for the session gate. |
| D2 | Data model | **New tables** `content_photo_edit` + `content_photo_edit_version`, mirroring designs; the original is **always copied** once per edit into `photo-edits/<editId>/original.<ext>` (also when it comes from an image `content_asset`, which is then only recorded as provenance), so deleting or replacing media never breaks an edit; each version = develop settings JSON + a rendered preview. | Reuse `content_design` with a `kind` column (its `width_px`/`height_px`/`preset` are artboard concepts and fit photos poorly). |
| D3 | Bridge | **Parent-driven** (`?host=parent`, upstream, zero Rust for the MVP): the Zora page fetches the original, posts `lightcraft:open`, restores settings with `develop.merge`, and saves by running `develop.get` + `app.export` and uploading the results. | An embedded fetch mode (`?photo=<id>`, a `zora.rs`-style module in LightCraft) only if the owner wants Save/Ctrl+S/back **inside** the app with the 409 dialog there (task L3, phase 2). |
| D4 | Browser library | **`?store=memory`** per editing session: nothing persists in the browser; the editable state lives in Zora's versions. Predictable storage, no OPFS growth under Zora's origin, no one-tab lock surprises. | A persistent OPFS library per user ("your photos in Zora"): storage quota/eviction notices, the Web Locks one-tab guard, originals kept after removal (`docs/web.md` data-safety gaps). |
| D5 | Editor chrome | **A thin Zora header** (Voltar ao item, photo edit name, save state, Salvar button) above the iframe for the MVP: upstream LightCraft has no `back` message and no Zora save button, so full-bleed would strand the user. | Full-bleed like Studio's Z5, only after L3 puts Salvar/Voltar inside the app. |

Why D1 recommends R2 although the wasm fits static assets: Workers Builds clones **only the Zora
repo**, so the bundle must be committed as a ~13.5 MB binary per release (git bloat) or fetched
from an artifact store at build time; the `@cloudflare/vite-plugin` owns the Worker's static-asset
configuration, so a second bundle directory needs care; and the R2 route's session gate, path
safety, cache rules and publish script are already built and tested for Studio. Static assets
remain a valid later optimisation (edge cache, atomic deploy with the Worker, automatic brotli);
if chosen, upload only the raw files (the edge compresses; the `.gz`/`.br` copies are for hosts
that serve precompressed files themselves) and scope `run_worker_first` to `/lightcraft/*` so the
public sign-in pages keep loading their own assets without a session.

## Contracts (proposed; binding once the owner confirms D1–D5)

### Data (Zora, D1)

`content_photo_edit`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text uuid | PK |
| `content_item_id` | text | FK `content_item.id`, cascade |
| `name` | text | e.g. "Foto do produto" |
| `source_asset_id` | text, nullable | FK `content_asset.id`, **`on delete set null`**: provenance only, the image media the original was copied from; null when the original was uploaded for this edit or the media was deleted since |
| `original_key` | text | R2 key of the edit's own copy of the original (always set) |
| `original_name` | text | file name with extension (gives the format to LightCraft) |
| `original_size` | integer | bytes |
| `current_version_id` | text, nullable | null until the first save |
| `created_by_id` | text | FK user, restrict |
| `created_at`, `updated_at` | timestamp_ms | `updated_at` moves strictly forward on every write |

`content_photo_edit_version`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text uuid | PK |
| `edit_id` | text | FK `content_photo_edit.id`, cascade |
| `number` | integer | 1, 2, 3 … per edit (unique with `edit_id`) |
| `author_kind` | text enum `user` \| `agent` | CHECK |
| `created_by_id` | text | FK user (the agent acts as its user) |
| `settings_size`, `preview_size` | integer | bytes |
| `created_at` | timestamp_ms | |

R2 objects: the original once at `photo-edits/<editId>/original.<ext>` (copied R2-to-R2 when it
comes from an asset, uploaded otherwise), and per version
`photo-edits/<editId>/<versionId>/settings.json` + `preview.jpg`. Deleting an edit or its item
deletes them. Scoping: an edit is visible only through its item's workspace. Limits: original
≤ 100 MB (= `MAX_ASSET_BYTES`: the Workers request body cap is 100 MB on the Free and Pro plans,
200 MB on Business, and Workers Paid does not raise it; a few raws from high-resolution bodies
exceed it and are refused with a pt-BR message), settings ≤ 1 MB, preview ≤ 20 MB.

Accepted originals: the image types of `MEDIA_TYPES` (JPEG, PNG, WebP, AVIF; GIF is refused) plus
raw and TIFF files, **checked by extension** against an allowlist in the shared module (browsers
send an empty or vendor MIME type for CR2/CR3/NEF/ARW/RAF/ORF/RW2/DNG), with a signature check where
the format has one (TIFF-based raws: `II*\0`/`MM\0*`; ORF `IIRO`/`IIRS`/`MMOR`; RW2/RWL `IIU\0`;
RAF `FUJIFILMCCD-RAW`; MRW `\0MRM`; X3F `FOVb`; CRW `II`+`HEAPCCDR`; CR3: ISO BMFF `ftypcrx`, as
LightCraft's `crates/codecs/src/sniff.rs`). The allowlist (`PHOTO_ORIGINAL_EXTENSIONS`) is every
raw LightCraft imports (`crates/engine/src/import/files.rs`) that has one of those signatures:
tif, tiff, dng, cr2, cr3, crw, nef, nrw, arw, srf, sr2, raf, orf, rw2, rwl, pef, srw, mrw, x3f,
3fr, fff, iiq, erf, kdc, mef, mos (`.raw`, PSD, HEIC, JXL, BMP are not offered). Raws never become
item media (`MEDIA_TYPES` is unchanged); only an edit's preview does, through
`publishPhotoEditPreview`.

The settings JSON is what `develop.get` returns (including `process`); it is applied back with
`develop.merge`. It is **not** an XMP sidecar: XMP stays an import/export interchange format
(`photo.saveMetadataToFile`), the version store keeps the engine's own JSON.

### HTTP (Zora, same origin, session required, workspace-scoped)

| Method and path | Request | Response |
| --- | --- | --- |
| `GET /api/photo-edits/<editId>` | | `200` JSON `{id, itemId, name, originalName, currentVersionId, currentVersionNumber, updatedAt}` |
| `GET /api/photo-edits/<editId>/original` | | `200` bytes of the edit's own copy, `application/octet-stream`, `attachment`, `nosniff`, `private, no-store` |
| `GET /api/photo-edits/<editId>/settings[?version=<versionId>]` | | `200` bytes, same safety headers as the original; `404` without a version |
| `GET /api/photo-edits/<editId>/preview[?version=<versionId>]` | | `200` `image/jpeg` (or `image/png` when a PNG was saved: the R2 object keeps the type its signature showed; the key is still `preview.jpg`), inline, `private`; `404` without a version |
| `POST /api/photo-edits/<editId>/versions` | `multipart/form-data`: `settings` (file, ≤ 1 MB, starts with `{`), `preview` (file, JPEG or PNG magic, ≤ 20 MB), `baseVersionId` (empty for the first save) | `201` `{versionId, number}`; `409` `{error, currentVersionId, currentVersionNumber}` when the base is not current; `413`/`422` for bad files; `415` non-multipart, `411` missing length (as designs) |

Uploading an original for a new edit is a raw-body `POST` like media uploads (streams into R2,
`Content-Length` required, ≤ 100 MB): `POST /api/content/<itemId>/photo-edits?filename=<name.ext>[&name=<edit name>]`
→ `201 {edit}`; `411` without a length, `413` too large, `422` for a refused extension or
signature (the object is stored, its first bytes read back, and deleted when they do not match).
Every file response (`original`, `settings`, `preview`) carries `nosniff`, a `sandbox` CSP and
`X-Photo-Edit-Version` (for `original`, the current version, when there is one). Server functions mirror designs: `listContentPhotoEdits`,
`createContentPhotoEdit` (from an image asset of the item, copied, or an uploaded original), `renameContentPhotoEdit`, `deleteContentPhotoEdit`,
`listPhotoEditVersions`, `restorePhotoEditVersion` (copies the old objects into a new version),
`publishPhotoEditPreview` (copies the current preview into the item's media). Concurrency without
transactions exactly as `saveDesignVersion`; every write moves `updated_at` strictly forward.

### Editor page (iframe, parent-driven)

- Zora page `/content/$itemId/photos/$editId` (file `$itemId_.photos.$editId.tsx`), session guard,
  thin header per D5, iframe `src="/lightcraft/?host=parent&store=memory"` (plus `&workers=` if a
  cap is wanted). The page first sends `HEAD /lightcraft/`; 404/401/network show the pt-BR
  "not published" state with a back link, like Studio's.
- Messages are accepted only when `event.origin` is Zora's and `event.source` is the frame
  (a `parseLightcraftMessage` beside `parseStudioMessage`, with tests).
- **Commands go through one page-side queue**: send a `lightcraft:cmd`, wait for its
  `lightcraft:response`, then send the next (responses carry no request id). The open flow, the
  dirty poll and the save flow all use it; the poll skips a tick while anything else is queued.
- **Open flow** (one fresh iframe per open; the library is `?store=memory`, so it starts empty):
  1. Page fetches the original bytes (session) and, if there is a current version, its settings.
  2. On `lightcraft:ready`, posts `lightcraft:open {name, bytes}`. There is no answer and the
     import happens on a later frame.
  3. Polls `develop.get` (no `id`: the active photo) every ~200 ms until its `value` is not
     `"null"` (`develop.get` always answers `ok: true`; with no active photo the value is JSON
     `null`; a non-null value means the import selected the photo), at most ~30 s for a large raw;
     then the error state
     ("Não foi possível abrir a foto"). `lightcraft:failed` (e.g. a refused open) ends it at once.
  4. If there is a current version: `develop.merge {settings, label: "Versão N"}` onto the freshly
     imported photo (defaults everywhere, so the partial merge restores the whole version).
  5. `develop.get` again → its `value` is the **clean baseline** for dirty tracking.
  `ok: false` at any step shows the error in the header state.
- **Save flow** (the header's Salvar button):
  1. `develop.get` → settings JSON (the response's `value`).
  2. `app.export` with `{path: "preview.jpg", format: "jpeg", quality: 85, longEdge: 2048,
     dontEnlarge: true, metadata: "none"}` (keys checked against `ExportOptions::validate_as`,
     `export/params.rs`: `longEdge` is a number, `quality` 1..100, `metadata` one of
     `all|allExceptCamera|copyright|none`, unknown keys are refused; `path` is mandatory on the
     web, see above; the saved name is `save_name(path)`, the file name). The render arrives as
     `lightcraft:save {name: "preview.jpg", bytes}` **before** the `lightcraft:response`; the page
     keeps the bytes of the save whose name matches and ignores any other `lightcraft:save`
     (e.g. a library backup the person started from the menu). Right after open an export can
     answer "still loading" (upstream limitation): retry once after ~1 s, then fail.
  3. `POST /api/photo-edits/<id>/versions` with `settings`, `preview`, `baseVersionId`.
  4. `201` → header "Salvo (versão N)", the settings from step 1 become the new baseline,
     invalidate the item's edits/versions queries. `409` → a Zora dialog: "Abrir a versão mais
     recente" (asks before discarding, then **reloads the iframe** and runs the open flow again:
     re-sending the same original to the same iframe would be deduplicated and the partial merge
     would keep stale keys) or "Continuar editando" (the next save asks to replace version N, then
     bases on the current one only after confirmation) — the same resolution Studio's
     `zoraConflict` dialog implements, here on the page because the bridge is parent-driven.
  A second Salvar while one is in flight is ignored (the button shows "Salvando…").
- **Dirty**: edits made in LightCraft's own UI send **nothing** to the page, and upstream
  `lightcraft:dirty` only means "a write to browser storage is pending or was refused"
  (`dirty_for_host` in `web.rs`), which with `?store=memory` is effectively never true. So the
  page polls `develop.get` (every ~1.5 s while the tab is visible, and right before a navigation
  it controls) and compares the JSON with the baseline; different = dirty. That flag drives the
  router blocker and `beforeunload` (which uses the last poll result, since it must answer
  synchronously). `lightcraft:dirty` is ignored.
- **Known UX gap (accepted for the MVP)**: Ctrl/Cmd+S inside the iframe runs LightCraft's own
  `photo.saveMetadataToFile` (an OPFS sidecar), **not** a Zora save; keyboard shortcuts belong to
  the iframe. The header's Salvar is the save path. Closing it is task L3's embedded mode, which
  wires Ctrl+S and an in-app Salvar/Voltar exactly as Studio did.
- Below `md` (phones): the "needs a larger screen" state, as Studio's.

### Engine service (LightCraft repo → container, phase 3)

A new Rust binary `apps/zora-lightcraft-server` in `zora-lightcraft`, mirroring
`apps/zora-studio-server` (tiny_http, stateless, no async runtime; reuse `lightcraft-engine` and
`lightcraft_engine::export`). Contract shaped like Studio's, with the photo model:

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /health` | | `200 ok` |
| `GET /commands[?q=]` | | bare array `[{id, label, params}]` from the engine catalogue, filtered by `q` (case-insensitive on id/label) |
| `POST /run` | `multipart/form-data` (**binary, not base64 JSON**): part `request` (JSON `{originalName, settings?, commands: [{command, params}], render?: {scale?, maxSize?, format?}, inspect?: bool}`), part `original` (the file bytes), optional parts `image:<name>` (watermark logo files); a string param `"zora-image:<name>"` is replaced by the path of that image in the run's temp folder | `200` `multipart/form-data`: part `result` (JSON `{settings, results: [...]}`) and part `preview` (JPEG bytes, absent with `inspect`); `422` `{error, index}` for the first failing command (nothing saved); `413` limits; `504` over 60 s; `503` when both run slots stay busy 30 s |

Why binary: the Worker has 128 MB of memory per isolate (JavaScript heap and wasm together). A
100 MB raw as base64 is ~133 MB of string before the JSON around it, so Studio's base64 JSON shape
cannot carry a photo original. The Worker streams the R2 object's body into the multipart request
to the container (a `ReadableStream` built from the parts, never the whole original in memory)
and reads the answer's preview the same way. The only engine input that names an image file is
the export watermark logo (`export/watermark.rs`, `watermark_logo(path)`), so `images` exists for
that and nothing else.

A run opens the original (`library.import` of the temp file, or the bytes directly through the
engine's `load_bytes` path), applies `settings` with `develop.merge` onto the fresh import, runs the
commands, returns `develop.get` as `settings` and the render as `preview`. `app.export` is a UI
command and does not exist headless: the server calls `lightcraft_engine::export::export_batch`
itself (scale first, then the longest-side cap; defaults to confirm in L4, proposed `scale: 1`,
`maxSize: 4096`, JPEG). `inspect: true` with no commands may use `photo.inspect` and omit the
preview. Limits: ≤ 200 commands, ≤ 60 s, original ≤ 100 MB (the Zora limit), ≤ 20 images × 25 MB
and 40 MB together (as Studio's), request ≤ 150 MB, concurrency 2 (`LIGHTCRAFT_RUNS`),
fresh session per run on its own thread, file access confined to the run folder, panics caught per
command and per request, temp folder removed after the run. No font library is needed (Inter is
embedded; CJK optional at build). Dockerfile: two-stage `rust:1.99-slim-bookworm` →
`debian:bookworm-slim`, linux/amd64, unprivileged user, `PORT=8080`; the image is digest-pinned in
Zora's `wrangler.jsonc` like Studio's.

Zora MCP tools on top (phase 3): `list_photo_commands`, `edit_photo` (runs on the current version's
original + settings, saves an `agent` version through the same 409 rule, returns the preview as
image content up to 4 MB), `render_photo` (never saves), `inspect_photo`, plus the phase-1 tools
`create_photo_edit`, `list_photo_edits`, `get_photo_edit`, `list_photo_edit_versions`,
`restore_photo_edit_version`, `publish_photo_edit`. Images (watermark logos only) come from the
item's image media assets, streamed as `image:<name>` parts and placed by `"zora-image:<name>"`,
the same naming `edit_design` uses.

### Fonts

None to host. LightCraft embeds Inter (OFL) and falls back to craft-fonts faces for other scripts
when built with `CRAFT_FONTS_DIR`; there is no runtime font library like Studio's `/studio-fonts/`.
`pnpm fonts:sync` is **not** reused. If CJK file names matter, build the web bundle with
`CRAFT_FONTS_DIR` (the ~16 MB face ships beside the wasm, still under 25 MiB).

## Working rules for every agent

- Zora: follow `AGENTS.md`. UI text in pt-BR; code, comments, docs and MCP tool descriptions in
  English. Check with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Never commit, push,
  deploy, run remote migrations or touch remote R2.
- LightCraft: follow its `AGENTS.md` (clean-room: never read/copy Adobe code or assets; never
  panic in non-test code; `cargo xtask ci` gates; every asset needs an `assets/ATTRIBUTION.md`
  entry; layering). **The repo has no git**: before editing a file, copy it to
  `C:\Users\douglas.araujo\Documents\dgstack\zora-lightcraft-backups\<task id>\<relative path>`
  (create the folder on first use). Keep every `Cargo.toml` valid; new crates inherit
  `[lints] workspace = true` and the no-panic deny attributes.
- **Only one Rust build on the machine at a time** (15 GB RAM; Studio's R4 `build.log` records a
  rustc OOM). The LightCraft web release build is `cargo xtask web` (profile `web`; expect several
  minutes, longer on a cold target); quick checks: `cargo check -p lightcraft-web --target
  wasm32-unknown-unknown`. `xtask web` runs `wasm-opt` only if it is on PATH. The `wasm-bindgen`
  CLI must match `Cargo.lock` (0.2.129 today); xtask prints the exact install command otherwise.
- Docker Desktop is installed but may be stopped; start it when a task needs it. Wrangler refuses
  containers on Windows: local engine work uses `LIGHTCRAFT_ENGINE_URL` with the native binary.
- Update this file's task status when you finish, and say what you could not verify.

## Tasks

Two lanes: **Z** (Zora, TypeScript) and **L** (LightCraft, Rust). Within a lane tasks run in order;
phases gate the lanes (phase 2 starts after phase 1's end-to-end, phase 3 after phase 2). The
final check (I) needs both.

### Phase 1 — MVP: embedded editor, save as a version

### Z1. LightCraft hosted in Zora

Status (2026-11-20): **code done and tested; the real-build local publish is pending** (it waits
for `cargo xtask web`, which the orchestrator runs). Done: `studio-hosting.ts` has a bundle map
(`HOSTED_BUNDLES`: `STUDIO_BUNDLE`, `STUDIO_FONTS_BUNDLE`, `LIGHTCRAFT_BUNDLE`; each with
`hashedNames` and `skipPrecompressed`), `bundleFileCacheControl` (always `no-cache` for LightCraft,
unchanged for Studio), `bundleUploadEntry` + `isPrecompressedCopy` (the publish filter);
`studio-hosting.server.ts` gained `handleBundleRequest` (308 bare prefix → 401 without session →
`serveBundleFile`), now used by `/studio/*`, `/studio-fonts/*` and the new
`src/routes/lightcraft/$.ts` (bucket via `getBundleBucket()`). `scripts/lib/r2-store.ts` gained
`collectBundleFiles` (walk + filter, shared with `studio-publish.ts`); `scripts/lightcraft-publish.ts`
+ `pnpm lightcraft:publish` (default `../zora-lightcraft/target/web-site`, `--dir`, `--remote`
owner only, `.gz`/`.br` skipped, `index.html` last, stale cleanup). AGENTS.md ("LightCraft
hosting", Layout, Commands). Checked: `pnpm lint`, `pnpm test` (29 files, 281 tests; Studio's
`studio-hosting.test.ts` unchanged and passing; new `lightcraft-hosting.test.ts`: bundle map,
path safety, types, no-cache, 304/HEAD/404, 308/401, the file filter on a temp build folder),
`pnpm build`; `pnpm typecheck` clean for these files (its only errors were in Z2's in-progress
`api/photo-edits` routes). Left: `pnpm lightcraft:publish` of a real build into local R2 and a
`/lightcraft/` fetch in `pnpm dev` (L1); COOP/COEP headers are not sent (optional upstream today).

- Generalise `studio-hosting{.ts,.server.ts}` to a bundle map (`studio/`, `lightcraft/`) without
  changing Studio's behaviour (its tests must pass untouched); add the `/lightcraft/*` route
  (`src/routes/lightcraft/$.ts`, GET/HEAD, session or 401, `/lightcraft` → 308 `/lightcraft/`,
  ETag/304, `nosniff`). LightCraft's file names are **not hashed**: everything is `no-cache`
  (the hash-immutable rule simply never matches).
- `pnpm lightcraft:publish` (`scripts/lightcraft-publish.ts`, mirroring `studio-publish.ts` and
  reusing `scripts/lib/r2-store.ts`): uploads `../zora-lightcraft/target/web-site` (or `--dir`),
  `index.html` last, stale-object cleanup; skip the `.gz`/`.br` copies (the Worker route streams
  the raw file and Cloudflare compresses on the way out: `application/wasm` is on its list of
  compressed content types, checked in the Speed docs on 2026-11-20). `--remote` documented, owner
  only.
- Tests: path safety, content types, cache rules, 304/HEAD/404 with a fake bucket; a local publish
  of a real build and `serveBundleFile` against the local R2.

### Z2. Photo edits in Zora (data + API + item UI)

Status: **done 2026-11-20** (code + tests, local only). Migration
`20261120172221_brave_hawkeye` (applied locally with `pnpm db:migrate`; test
`src/db/photo-edits-migration.test.ts`), `src/lib/content-photo-edits{.ts,.server.ts,.http.server.ts,.functions.ts,.queries.ts,.upload.ts}`,
routes `src/routes/api/photo-edits/$editId/{index,original,settings,preview,versions}.ts` and
`src/routes/api/content/$itemId/photo-edits.ts`, `deleteContentItemWithAssets` extended, the
"Fotos" section (`src/components/content/content-photo-edits.tsx`) on the item page, the six MCP
tools + `AGENT_INSTRUCTIONS`, AGENTS.md "Photo edits". Checked with `pnpm typecheck && pnpm lint &&
pnpm test && pnpm build` (32 files, 303 tests; new: `content-photo-edits.server.test.ts` 19,
`mcp.photo-edit-tools.test.ts` 2, the migration test 1). Not verified: the UI in a browser (no
`pnpm dev` session was run), the R2-to-R2 copy against real/simulated R2 (the
`FixedLengthStream` path runs only in workerd; tests use an in-memory bucket), a real raw upload.
Left for Z3: "Abrir no LightCraft" on the cards is disabled (with a TODO) until the route
`/content/$itemId/photos/$editId` exists; MCP results already link to that URL. Contract
deviations (folded into "Contracts" above): the extension allowlist is wider (every raw
LightCraft imports that has a signature), the preview may be PNG, the original upload path is
`POST /api/content/<itemId>/photo-edits`.

- Schema + migration for the two tables (with a migration test), the service functions, server
  functions, query options/hooks, the shared client-safe module (limits, URLs, types), the HTTP
  routes with the 409 rule, signatures, sizes and safety headers, cascade deletion of R2 objects.
- Originals: the raw-body upload route (≤ 100 MB, `Content-Length` required), the extension
  allowlist for raw/TIFF plus the image `MEDIA_TYPES`, signature checks where a format has one, and
  the R2-to-R2 copy when an edit starts from an image asset (`source_asset_id` set null when that
  asset is deleted later; the edit keeps working).
- Item page: a "Fotos" section beside "Designs" (cards with the latest preview, "Nova edição de
  foto" from an image media of the item or an upload, open, versions with restore, "Usar como
  mídia", rename, delete), pt-BR. Before the first save a card has no preview: show the file
  name and a placeholder (the browser cannot render a raw).
- MCP tools that need no engine: `create_photo_edit`, `list_photo_edits`, `get_photo_edit` (preview
  as image content ≤ 4 MB), `list_photo_edit_versions`, `restore_photo_edit_version`,
  `publish_photo_edit`. Update `AGENT_INSTRUCTIONS` and AGENTS.md.
- Tests mirror `content-designs`'s: scoping, stale base, racing first saves, signatures, sizes,
  headers, restore, publish, deletion, the MCP tools.

### Z3. Editor page + parent-driven bridge

Status: not started. Depends on Z1, Z2, D3, D4, D5.

- The route, the thin header (Voltar, name, save state, Salvar), the iframe, `parseLightcraftMessage`
  + tests, the single command queue, the open/save flows and the 409 dialog per the contract
  (iframe reload for "Abrir a versão mais recente"), the dirty blocker driven by the `develop.get`
  poll, the 404/401/phone states, query invalidation on save.
- Pin the exact `app.export` preview params in the contract above from `ExportOptions::from_params`
  (`crates/engine/src/export/params.rs`: the resize key and shape, the metadata policy that strips
  the most, `path` naming); confirm `develop.get`'s exact JSON shape and that `develop.merge` of a
  full `develop.get` result onto a fresh import reproduces it (a unit test against a recorded
  settings JSON, in LightCraft's test suite or as a headless check).
- Handle the open poll's timeout, the "still loading" retry, `lightcraft:failed`, a second Salvar
  while one is in flight, and `lightcraft:save` messages that are not the preview (ignored).
- Tests: message parsing, the command queue (one in flight, poll ticks skipped while busy), the
  open sequence (open → poll until `ok` → merge → baseline), the save state machine
  (201/409/overwrite confirmation), dirty from the poll; a `pnpm dev` smoke test with a published
  build.

### L1. Web build + local publish verification

Status: build + local publish done 2026-11-20. `cargo xtask web` built in 7m19s (wasm-opt -O2 on
PATH): `index.html` 2,329 B, `worker.js` 649 B, `lightcraft_web.js` 111,225 B,
`lightcraft_web_bg.wasm` **34,023,371 B** (12,158,880 gzip / 7,944,566 brotli), plus
`snippets/eframe-<hash>/inline0.js`. The wasm is 2.5× the 13.5 MB `docs/web.md` lists, so it is
**over the 25 MiB static-asset limit**: D1's alternative is out, R2 is the only option.
`pnpm lightcraft:publish` uploaded 5 files (32.6 MiB, `.gz`/`.br` skipped) to local R2. Left: the
app starting in a browser at `?host=parent&store=memory` (bridge protocol test running).

- `cargo xtask web` in `zora-lightcraft` (one Rust build at a time); record the bundle's actual
  sizes; `pnpm lightcraft:publish` into local R2; verify `/lightcraft/` serves index + wasm with
  the right types and that the app starts in a browser at `?host=parent&store=memory` (a headless
  check or the owner's eyes). If the build fails on this machine, report the error; do not "fix"
  upstream code to make it pass without a task of its own.
- Optional, owner's call: rebuild with `CRAFT_FONTS_DIR` for CJK glyphs.

### Phase 2 — polish and (optionally) the embedded mode

### Z4. Versions UX and conflicts in the browser

Status: not started. Depends on phase 1's end-to-end.

- The versions list/restore/publish flows exercised in a signed-in browser; the 409 dialog's two
  paths verified against a real second saver (an MCP save while the editor is open); the dirty
  blocker on route change and tab close; phone/iPad/desktop widths. Record what was verified.

### L2. Rebrand and theme (small, optional)

Status: not started. Depends on the owner's call.

- If the owner wants the Studio treatment: app name "Zora LightCraft" (or the chosen name), a
  `?theme=dark|light` URL parameter applied at startup (upstream has none; `web.rs` sets
  `system_theme: None`), pt-BR forced default (upstream follows the browser), the Zora mark on the
  loading screen (assets: original work or the Zora brand files with their licence, recorded in
  `assets/ATTRIBUTION.md` — the Zora brand is `LicenseRef-Zora-Brand`, not open source, use
  unmodified). Back up every touched file first. `cargo xtask ci --quick` while iterating, the
  full gate before handing back; keep the wasm building.

### L3. Embedded fetch mode (`?photo=`), only if the owner wants in-app Save/back

Status: not started. Depends on D3's alternative being chosen; the largest Rust task.

- Mirror Studio's R2/R3/R4: a browser-free `zora` module in `crates/ui-egui` (embed state machine,
  `wire` module for URLs/multipart/409, tests with a fake Link), a browser host in
  `apps/lightcraft-web` (same-origin fetch with credentials, postMessage to the parent), detection
  by `?photo=<editId>` loading metadata + original + settings before the app starts, Salvar
  (primary) + Voltar ao item in the app bar, Ctrl/S → the Zora save, the conflict dialog in-app,
  `zora-lightcraft:ready|dirty|saved|back` messages. The engine has no plug-in/script system, so
  there is nothing to refuse (unlike Studio's `EMBEDDED_REFUSES`); keep the web build's
  `panic = "abort"` behaviour in mind (never add a panic path).
- Zora side then drops the thin header (full-bleed, a Z5-analogue) and parses the new messages.
- This task is **not** required for the MVP or for phase 3; the parent-driven bridge already
  supports everything except the in-app buttons.

### Phase 3 — agent-driven photo editing

### L4. Engine service (`apps/zora-lightcraft-server`)

Status: not started. Depends on phase 2.

- The crate per the contract (tiny_http or another small permissive HTTP crate; check the licence
  against LightCraft's allowlist), reusing `lightcraft-engine` + `lightcraft_engine::export`;
  `/health`, `/commands`, `/run`; per-run tempdir confinement, fresh session, cancel + deadline,
  catch_panic per command/request, concurrency 2, the multipart request/response, the limits and
  error mapping above (the original part is written to the run folder as it streams in, never
  held whole in memory twice), the preview rendered with `export_batch` (not `app.export`, which
  is a UI command); tests for
  new-photo runs, settings round-trip, commands, render, image placement, a failing command → 422,
  limits; Dockerfile (linux/amd64) + README with the build/run/push commands (mirror
  `zora-studio-server`'s). No fonts to bake. Local run with the debug binary +
  `LIGHTCRAFT_ENGINE_URL` in Zora's `.env`; the image build/push is the owner's step.

### Z6. Engine client, container and MCP tools

Status: not started. Depends on L4's contract (can be built against it with a mocked engine, as
Studio's Z4 was).

- `lightcraft-engine.server.ts` (typed client, limits before sending and while reading, timeouts
  100 s / 45 s, 422 → a command error with index). Unlike Studio's client it **streams**: the
  original goes from the R2 object's body into the multipart request without being buffered or
  base64-encoded (the Worker has 128 MB per isolate), and the answer's preview part is checked
  against the 20 MB limit while it is read. A test proves a 100 MB original never sits whole in
  memory (a fake transport that counts buffered bytes). `lightcraft-engine-container.server.ts` (a
  `LightcraftEngine` Durable Object, `standard-1`, no Internet, `/health` readiness, sleep after
  5 min, 2 instances), exported from `src/server.ts`; the `containers` entry commented out = the
  switch; `LIGHTCRAFT_ENGINE_URL` wins for dev; `dev.enable_containers` stays false.
- MCP tools `list_photo_commands`, `edit_photo`, `render_photo`, `inspect_photo` per the contract,
  saving `agent` versions through the same 409 rule; `AGENT_INSTRUCTIONS` workflow (open the item's
  photo, develop, render and look, ask the person, publish when approved). Tests with a fake
  transport, mirroring `mcp.engine-tools.test.ts`.

### I. End-to-end check

Status: to be run manually by the owner after each phase.

- Phase 1: publish the build to local R2, `pnpm dev`, create an item with an image, create a photo
  edit, open it, develop, save a version, reopen (settings restored), publish the preview as media.
  Repeat with a real raw (CR2/NEF/ARW, 30–100 MB) uploaded as an original; check that moving a
  slider marks the page dirty and that leaving asks first; delete the source image media and
  reopen the edit.
- Phase 3: the MCP tools edit the same photo (engine via `LIGHTCRAFT_ENGINE_URL`), the new `agent`
  version appears in the editor, a concurrent editor save gets the 409 dialog. Record what was
  verified and what was not.

## Launch checklist (owner)

- Workers Paid plan (Containers need it) — shared with Studio's engine.
- Build the LightCraft engine image from `../zora-lightcraft/apps/zora-lightcraft-server/Dockerfile`
  (linux/amd64), `pnpm exec wrangler containers push zora-lightcraft-engine:<tag>`, paste the digest
  into the `containers` entry in `wrangler.jsonc` (one entry per engine class), uncomment. Repeat
  for every engine update.
- `pnpm db:migrate:remote`, `pnpm lightcraft:publish --remote` (and Studio's own pending publishes).
- Optional: `CRAFT_FONTS_DIR` for CJK glyphs in the web bundle; the `heif` feature decision for
  HEIC import (HEVC patents).
- Push to `main` (Workers Builds deploys).

## Open questions

- `application/wasm` compression (answered 2026-11-20): it is on Cloudflare's list of compressed
  content types, so the 13.5 MB wasm should travel as ~3–4.6 MB through the R2 route. Confirm
  once in production with `curl -sI -H 'Accept-Encoding: br, gzip' <url>/lightcraft/lightcraft_web_bg.wasm`
  (with a session cookie) and look for `Content-Encoding`. If it is missing, serve the
  precompressed `.br`/`.gz` from R2 with `Content-Encoding` in `serveBundleFile`, or move to
  static assets.
- The resize key, metadata policy and `develop.get` JSON shape for the preview (Z3 pins them).
- Theme sync: upstream has no `?theme=`; the iframe keeps LightCraft's own theme until L2.
- The original cap (100 MB, the request body limit) vs the browser's memory: originals are held
  in memory (≤ 768 MB cache) and each render worker runs its own wasm instance; a 100 MB raw on a
  low-RAM machine may be slow or fail. Test with a real raw early (L1). Raws over 100 MB (some
  high-resolution bodies) are refused unless the zone moves to Business (200 MB).
- Raw coverage expectations: CR3 variants and HE NEF open as previews (upstream gaps); decide
  whether the UI should warn when a photo opened as a preview only.
- The `develop.get` poll's cost on a large photo: it returns JSON only (no render), so ~1.5 s
  should be cheap; measure in Z3 and lengthen the interval if the UI stutters.
