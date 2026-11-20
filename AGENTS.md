# AGENTS.md

Guide for agents (and people) working on Zora: an internal TanStack Start app
for teams planning product launches. Content lives in **workspaces** (Better
Auth organizations, see "Workspaces"); every member of a workspace sees and
edits all of its content, and nothing of other workspaces.

## Rule: ground code in the current docs

These libraries change quickly. Before writing code in an area, read the
current official docs for it and follow them. Where the docs disagree with
what you remember, the docs win. Do not substitute stack choices.

| Area | Docs |
| --- | --- |
| TanStack Start (React) | https://tanstack.com/start/latest/docs/framework/react/overview (append `.md` to any page path for markdown, e.g. `.../guide/hosting.md`) |
| TanStack Router / Query / Form | https://tanstack.com (latest docs of each library) |
| Better Auth (+ TanStack Start integration, Drizzle adapter) | https://www.better-auth.com/docs (append `.md` to page paths; fetch large pages with `curl` and search them) |
| Drizzle ORM / drizzle-kit (SQLite, Cloudflare D1) | https://orm.drizzle.team/docs/overview (D1: `.../docs/connect-cloudflare-d1`) |
| Cloudflare Workers, Vite plugin, Wrangler | https://developers.cloudflare.com/workers/ |
| Cloudflare D1 and R2 | https://developers.cloudflare.com/d1/ and https://developers.cloudflare.com/r2/ |
| shadcn/ui (TanStack Start) | https://ui.shadcn.com/docs |

## Stack

- TanStack Start (React 19, TypeScript, Vite 8) with TanStack Router (file
  routes), TanStack Query (with `@tanstack/react-router-ssr-query`) and
  TanStack Form.
- Tailwind CSS v4 + shadcn/ui (style `radix-nova`, components in
  `src/components/ui`, added with `pnpm dlx shadcn@latest add <name>`).
  Design system in `src/styles/app.css` (see "Design system").
- Cloudflare D1 (SQLite) via Drizzle ORM **1.0 RC** (`drizzle-orm@rc`, as the
  current Drizzle docs install, driver `drizzle-orm/d1`), binding `DB`.
  drizzle-kit generates the migrations committed in `./drizzle`; Wrangler
  applies them. See "Database decision".
- Better Auth 1.7 (email + password), tables in the same database through
  `@better-auth/drizzle-adapter/relations-v2`.
- Cloudflare Workers via `@cloudflare/vite-plugin`; local dev runs server code
  in `workerd`. Uploaded media is stored in R2 (binding `MEDIA`, simulated
  locally under `.wrangler/state`). Worker entry `src/server.ts` (Start's
  handler plus the `StudioEngine` Durable Object; see "Design engine").
- Drag and drop: `@dnd-kit/react` (see "Drag and drop"). Date maths:
  `date-fns`. Toasts: `sonner` (through `src/components/ui/sonner.tsx`).
- Vitest, ESLint (typescript-eslint), pnpm.

The shared dependencies and shadcn components (dialog, select, textarea,
dropdown-menu, popover, tooltip, checkbox, separator, skeleton, sonner,
toggle-group + toggle, avatar) are already installed. Feature work should not
need to touch `package.json` or the lockfile.

## Commands

```sh
pnpm env:setup     # once: .env from .env.example with a generated secret
pnpm db:migrate    # apply migrations to the local D1 database (.wrangler/state)
pnpm dev           # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm deploy:check  # build + wrangler deploy --dry-run
pnpm deploy:ci     # remote D1 migrations + wrangler deploy (Workers Builds runs this on push to main)
pnpm db:generate   # new migration after editing src/db/*-schema.ts
pnpm db:migrate:remote  # apply migrations to the production D1 database
pnpm auth:generate # regenerate src/db/auth-schema.ts after changing auth config
pnpm studio:publish [--dir <build>]  # Zora Studio's web build -> local R2 studio/ (see "Zora Studio hosting")
pnpm fonts:sync    # Studio's font library -> local R2 studio-fonts/ (downloads once into .cache/)
pnpm lightcraft:publish [--dir <build>]  # LightCraft's web build -> local R2 lightcraft/ (see "LightCraft hosting")
# --remote on the last three writes the production bucket: owner's step only, agents never run it
```

No Docker and no Cloudflare account are needed locally: D1 and R2 are
simulated under `.wrangler/state` (delete it to start empty, then
`pnpm db:migrate`). The local D1 copy is keyed by the `database_id` in
`wrangler.jsonc`; changing that id starts an empty local database. `pnpm test` needs nothing running: each DB test file gets
its own in-memory D1 database (`test/db.ts`) with the committed migrations
applied.

## Layout

```
src/
  server.ts                  Worker entry (wrangler `main`): Start's handler + exported Durable Objects
  routes/                    file routes (routeTree.gen.ts is generated; committed)
    __root.tsx               document shell; loads `user` into route context
    index.tsx                / -> /calendar
    sign-in.tsx, sign-up.tsx public pages (?redirect= returns to the original URL)
    _app.tsx                 pathless layout: session guard + AppShell
    _app/calendar.tsx        /calendar: month/week grid, drag to reschedule (`ssr: false`, see "Dates")
    _app/pipeline.tsx        /pipeline: one column per status, drag to change status
    _app/content/index.tsx   /content: filtered list (filters in the URL)
    _app/content/new.tsx     /content/new: editor form, presets from the search
    _app/content/$itemId.tsx /content/$itemId: editor form (loader + not-found state)
    _app/content/$itemId_.designs.$designId.tsx  design editor: Zora header + Studio iframe (see "Zora Studio hosting")
    api/auth/$.ts            Better Auth HTTP handler
    mcp.ts                   POST /mcp: MCP server behind OAuth (see "Agents")
    consent.tsx              OAuth consent page for MCP clients
    connect.tsx              /connect: public docs, connect an agent to the MCP server
    [.]well-known/$.ts       OAuth discovery documents (served by Better Auth)
    api/content/$itemId/assets.ts  POST: upload a file of an item (raw body)
    api/assets/$assetId.ts   GET: serve an uploaded file (session required, range support)
    api/designs/$designId/   index (GET metadata), source + preview (GET files), versions (POST save); see "Designs"
    api/photo-edits/$editId/ index (GET metadata), original + settings + preview (GET files), versions (POST save); see "Photo edits"
    api/content/$itemId/photo-edits.ts  POST: upload an original, creating a photo edit (raw body)
    studio/$.ts              GET/HEAD /studio/*: Zora Studio's web build from R2 `studio/` (session required)
    studio-fonts/$.ts        GET/HEAD /studio-fonts/*: Studio's font library from R2 `studio-fonts/` (session required)
    lightcraft/$.ts          GET/HEAD /lightcraft/*: LightCraft's web build from R2 `lightcraft/` (session required)
  lib/
    content.ts               SHARED content module (enums, labels, schemas, rules, types)
    content.functions.ts     content server functions (RPC contract)
    team.functions.ts        listTeamMembers server function (members of the current workspace)
    agent-connect.ts         per-agent setup steps for /connect (+ .functions.ts: getMcpServerUrl)
    workspace.ts             SHARED workspace module (roles, types, canManageMembers, schemas)
    workspace.server.ts      workspace lookups (resolve, members, invitations; unit-tested)
    workspace.functions.ts   workspace server functions (lists, invite, invitation preview)
    workspace.queries.ts     query options + invite/cancel/remove hooks
    invitations.server.ts    inviteToWorkspace: Better Auth invitation + email
    invitation-email.ts      the invitation email (pt-BR) and its sender
    mailer.server.ts         getMailer(): the Email Sending binding `EMAIL`
    content.queries.ts       queryOptions factories, query keys, mutation hooks
    route-query.ts           loadQuery: cache-first loading for route loaders
    session.queries.ts       sessionStateQueryOptions (root beforeLoad)
    content-cache.ts         contentKeys + optimistic cache apply/rollback (no React; unit-tested)
    content-filters.ts       filter search-param schema + toContentListFilters
    content-assets.ts        SHARED media module (allowed types, size limit, URLs, ContentAsset)
    content-assets.functions.ts  listContentAssets, deleteContentAsset server functions
    content-assets.server.ts DB + R2 service functions (server-only, unit-tested)
    content-assets.upload.ts browser upload with progress (XMLHttpRequest)
    image-providers.server.ts  Unsplash + fal clients for the MCP image tools (plain fetch, checked downloads)
    content-designs.ts       SHARED designs module (presets, channel sizes, limits, schemas, URLs, R2 keys)
    content-designs.server.ts  design + version service functions (server-only, unit-tested)
    content-designs.http.server.ts  the /api/designs handlers (session-free, unit-tested)
    content-designs.functions.ts    design server functions
    content-designs.queries.ts      query options + mutation hooks for designs
    content-photo-edits.ts   SHARED photo edits module (accepted originals, signatures, limits, schemas, URLs, R2 keys)
    content-photo-edits.server.ts  photo edit + version service functions (server-only, unit-tested)
    content-photo-edits.http.server.ts  the /api/photo-edits handlers + original upload (session-free, unit-tested)
    content-photo-edits.functions.ts    photo edit server functions
    content-photo-edits.queries.ts      query options + mutation hooks for photo edits
    content-photo-edits.upload.ts       browser upload of an original with progress (XMLHttpRequest)
    studio-hosting.ts        SHARED hosting of Studio, its fonts and LightCraft: bundle map, path safety, types, cache rules, publish filter, postMessage parsing
    studio-hosting.server.ts serveBundleFile (R2 -> Response), handleBundleRequest (308 + session + serve; unit-tested)
    studio-fonts.ts          font library: curated families, pinned commit, METADATA.pb parser, manifest builder
    studio-engine.server.ts  design engine client: run/commands/health, limits, timeouts (unit-tested)
    studio-engine-container.server.ts  StudioEngine Durable Object (container) + getStudioEngine()
    media-bucket.server.ts   getMediaBucket(): the R2 binding `MEDIA`
    editor-search.ts         search schemas of the editor routes, `from` origins
    calendar.ts              calendar maths + search schema (local days; browser only; unit-tested)
    dnd.ts                   contentDragSensors for DragDropProvider
    content.server.ts        DB service functions (server-only, unit-tested)
    auth-middleware.ts       authMiddleware (session check for server functions)
    auth.functions.ts        getSessionUser (for route guards)
    auth.server.ts           createAuth(db, env): Better Auth config + allowlist hook
    auth-client.ts           Better Auth React client (sign-up/in/out)
    services.server.ts       getRequestServices(): per-request db + auth
    session.server.ts        findSessionUser / requireSessionUser
    env.server.ts            getServerEnv(): validated env, read per request
    allowlist.ts             sign-up allowlist parsing/matching
    dates.ts, redirect.ts, utils.ts
  db/
    auth-schema.ts           GENERATED by `pnpm auth:generate`; do not edit
    content-schema.ts        content_item, content_asset, content_design(_version) tables
    schema.ts                re-exports both (used by drizzle-kit)
    client.server.ts         createDb(binding): Drizzle over the D1 binding
  components/                app-shell, auth-layout, brand (logo, clay loops, loader),
                             connect-agent-link, copy-field, form-field,
                             local-date-time, ui/ (shadcn)
  assets/brand/              generated clay artwork (see scripts/brand/README.md)
    content/                 shared content UI kit: channel-badge, status-badge,
                             assignee-avatar, content-item-card, content-filters,
                             content-assets, content-designs, content-photo-edits
                             (the item page sections)
test/                        in-memory D1 for tests (db.ts, wrangler.jsonc)
drizzle/                     committed SQL migrations
better-auth.config.ts        entry point for the Better Auth CLI only
```

File suffixes follow the Start docs: `*.server.ts` is server-only (import
protection denies it in the client build), `*.functions.ts` holds
`createServerFn` wrappers that are safe to import anywhere, plain `.ts` is
client-safe.

## Language

The UI is in Brazilian Portuguese: every label, message and error a person
reads (including server rule errors, which surface in the UI and in MCP tool
results). `<html lang="pt-BR">`; dates use `Intl` with `pt-BR` (`@/lib/dates`)
and `date-fns` with the `ptBR` locale. Better Auth's English errors are mapped
in `@/lib/auth-errors`. Code, comments, docs and the MCP/WebMCP tool names and
descriptions (read by agents) stay in English. Enum values (`idea`, `x`, ...)
are stored in English; only `*_LABELS` are translated.

## Design system

A studio look after Affinity (affinity.studio), in a dark theme (default) and
a light one. Tokens live in `src/styles/app.css`; the header comment lists
both palettes.

- **Themes.** Light tokens are in `:root`, dark ones in `.dark`. The choice is
  the `zora_theme` cookie (`@/lib/theme`): the root route reads it in
  `beforeLoad` (`readTheme`, isomorphic) so the server renders the right
  `<html class>`; `setTheme` flips the class and the cookie, `useTheme` follows
  it (the toaster and the sidebar's "Tema claro/escuro" switch use it). No
  "system" option on purpose: it would flash on load. In components use
  tokens (or `foreground/<alpha>` for hairlines), never `white/`/`black/`.
- **Surfaces:** pages sit on the canvas (`bg-background`: black, or a
  neutral light grey in light; the light theme has no cream/warm tint); the sidebar, board columns, calendar cells and cards are one step
  up (`bg-card`); things on those (item cards, hover) are one more
  (`bg-muted`). Do not separate surfaces with borders and shadows where a
  step in tone works.
- **Colour roles:** lime (`primary`, `bg-lime`) is the only action colour:
  primary buttons, today, drop targets. Lime as text (the active nav item) is
  `text-brand`, deep green in light so it stays readable. `secondary` is bone
  on dark, ink on light. Violet is the focus ring. Coral is `destructive`.
  Channel and status hues are tokens (`bg-channel-*`, `bg-status-*`) used
  only by the two badge components.
- **Type:** Figtree (`font-sans`) for the UI and the heavy lowercase
  wordmark; Fraunces (`font-display`) for page titles (`PageHeader`),
  section titles and the calendar period.
- **Brand: claymation after clay.com** (`@/components/brand`). A lime
  plasticine Z with a cream clay cat asleep on it. The artwork is generated
  (fal.ai) and lives in `src/assets/brand`; how each file was made, and the
  rules for new ones, are in `scripts/brand/README.md`. Do not draw the
  brand in CSS or SVG.
  - `ZoraLogo` (the mark + "zora"; size it with a font size) in the sidebar
    and the auth pages (below `lg`). The mobile top bar shows only
    `ZoraWordmark`; the full logo is in the open menu. Hover squishes the
    clay once (`.zora-logo` in `app.css`).
  - `ClayLoop` plays a muted looping clip (WebM VP9, MP4 fallback, WebP
    poster) only while it is on screen and never under reduced motion.
  - `AlphaLoop` plays a clip with transparency: a "stacked alpha" MP4
    (colour on top, matte below) combined in a canvas, with a WebP still
    before playback and under reduced motion. Safari does not decode VP9
    alpha, so do not use a transparent WebM instead.
  - `CatLoader` (the cat batting a yarn ball, cut out, straight on the page
    background, no tile) is the router's `defaultPendingComponent`; it fades
    in after a delay so short waits never flash it.
- **Auth pages** (`sign-in`, `sign-up`, `consent`, invitations, first
  workspace) render inside `AuthLayout` (`@/components/auth-layout`): the
  logo in the top-left corner (the Z with "zora" beside it below `lg`; from
  `lg` the Z alone, with the `ZoraWordmark` large above the form), the
  slogan (`ZORA_SLOGAN`, the `tagline` prop; sign-in and sign-up only), and the
  clay diorama with no text on it (a banner above
  the form below `lg`, the right-hand column from `lg`). This is the one
  decorative moment; keep the app itself quiet.
- **App icon and PWA.** `scripts/app-icon.html` frames the clay icon master
  (`scripts/brand/app-icon.png`) per variant; `node scripts/generate-icons.mjs` (needs Chrome or Edge)
  writes `public/icons/*`, `public/apple-touch-icon.png` and
  `public/favicon.ico`. `public/manifest.webmanifest` makes Zora installable;
  `public/sw.js` (registered by `@/lib/pwa` in production builds only) only
  shows `public/offline.html` when a page load fails and caches nothing
  private. Installed on iOS the page runs under the status bar, so the
  mobile top bar adds `env(safe-area-inset-top)` and the mobile sidebar
  sheet pads by the top, bottom and left insets (`ui/sidebar.tsx`).
- Fonts come from `@fontsource-variable/figtree` and
  `@fontsource-variable/fraunces` (the `full` files carry the SOFT/WONK axes).

## The content data layer (use this, do not re-implement it)

### Shared module: `@/lib/content`

The only place that lists channels, formats and statuses. Import from here;
never restate the lists.

- `CHANNELS`, `CHANNEL_LABELS`, type `Channel` (`x`, `linkedin`, `instagram`, `blog`)
- `FORMATS`, `FORMAT_LABELS`, type `ContentFormat` (`post`, `thread`, `carousel`, `reel`, `story`, `article`)
- `STATUSES` (pipeline order), `STATUS_LABELS`, type `ContentStatus` (`idea`, `draft`, `ready`, `scheduled`, `published`)
- Types: `ContentItem` (dates are `Date`, UTC instants), `TeamMember`
- Schemas (zod 4): `createContentItemSchema`, `updateContentItemSchema`,
  `rescheduleContentItemSchema`, `changeContentItemStatusSchema`,
  `contentItemIdSchema`, `contentListFiltersSchema`, `httpUrlSchema`,
  `instantSchema`; input types `CreateContentItemInput`,
  `UpdateContentItemInput`, `RescheduleContentItemInput`,
  `ChangeContentItemStatusInput`, `ContentListFilters`.
- Rules: `normalizeScheduleState`, `scheduleStateError`,
  `SCHEDULED_REQUIRES_DATE_MESSAGE`, `isHttpUrl`.

Dates in inputs may be a `Date` or an ISO string with an offset
(`2026-03-01T09:00:00Z`). Strings without an offset are rejected, because their
time zone is ambiguous. From `<input type="datetime-local">` use
`fromDateTimeLocalValue` / `toDateTimeLocalValue` in `@/lib/dates`.

Server-enforced rules (checked against the merged item on every write):
`scheduled` requires `scheduledAt`; `published` requires `publishedAt` and gets
"now" if none is supplied; `publishedUrl` and `assetLinks` must be http(s);
`assigneeId` must be an existing user. Violations reject with HTTP 422 and a
readable `error.message`. The DB also has CHECK constraints as a backstop.
Note: clearing `scheduledAt` (reschedule to `null`) on a `scheduled` item is
rejected; change its status first.

### Server functions

All validate input with the schemas above and require a session
(`authMiddleware`; HTTP 401 without one).

| Import | Name | Method | Input (`data`) | Returns |
| --- | --- | --- | --- | --- |
| `@/lib/content.functions` | `listContentItems` | GET | `ContentListFilters` (optional) | `ContentItem[]` |
| | `getContentItem` | GET | `{ id }` | `ContentItem` (throws `notFound()`) |
| | `createContentItem` | POST | `CreateContentItemInput` | `ContentItem` |
| | `updateContentItem` | POST | `{ id, ...partial fields }` | `ContentItem` |
| | `rescheduleContentItem` | POST | `{ id, scheduledAt: Date \| string \| null }` | `ContentItem` |
| | `changeContentItemStatus` | POST | `{ id, status }` | `ContentItem` |
| | `deleteContentItem` | POST | `{ id }` | `{ id }` |
| `@/lib/team.functions` | `listTeamMembers` | GET | none | `TeamMember[]` |

Missing items throw `notFound()` (check with `isNotFound` from
`@tanstack/react-router`). List filters: `scheduledFrom`/`scheduledTo` form a
half-open range `[from, to)` and exclude unscheduled items; `channels`,
`statuses` (arrays) and `assigneeId` are ANDed. Lists are ordered by
`scheduledAt` (unscheduled last), then newest first.

### Query helpers: `@/lib/content.queries`

- Keys: `contentKeys.all | lists() | list(filters) | details() | detail(id)`,
  `teamKeys.all | members()`.
- Query options: `contentListQueryOptions(filters?)`,
  `contentItemQueryOptions(id)`, `teamMembersQueryOptions()`.
- Mutation hooks: `useCreateContentItem`, `useUpdateContentItem`,
  `useRescheduleContentItem`, `useChangeContentItemStatus`,
  `useDeleteContentItem`. Each refreshes `contentKeys.lists()` and the
  item's detail entry afterwards.
- `useRescheduleContentItem` and `useChangeContentItemStatus` (the drag
  mutations) are **optimistic**: `mutate()` updates the item at once in every
  cached list and in its detail entry (a change to `published` shows a
  `publishedAt` immediately). On failure the cache is restored and an error
  toast shows the server's message, so callers need no `onError`. Lists and
  the detail are refetched when the mutation settles. An optimistically
  changed item stays in its list position, even in a list whose filters it no
  longer matches, until that refetch. The logic is in `@/lib/content-cache`
  (`applyContentItemPatch`, `rollbackContentItemPatch`, `patchContentItem`).
- The other hooks are not optimistic and show no toast: forms display their
  own errors (`mutateAsync` + try/catch).

Typical route:

```tsx
export const Route = createFileRoute('/_app/calendar')({
  loader: ({ context }) =>
    loadQuery(context.queryClient, contentListQueryOptions({ scheduledFrom, scheduledTo })),
  component: CalendarPage,
})
function CalendarPage() {
  const { data } = useSuspenseQuery(contentListQueryOptions({ scheduledFrom, scheduledTo }))
  const reschedule = useRescheduleContentItem()
  // reschedule.mutate({ id, scheduledAt: newDate })
}
```

Use the same filters object in the loader and the component (put search-param
filters in `loaderDeps`).

**Loaders use `loadQuery(context.queryClient, options)`** (`@/lib/route-query`),
never a bare `queryClient.query`: `query` waits for the network whenever the
data is stale, which made every page change wait on a round trip to the
Worker and D1 (about 2 s), even for pages already visited. `loadQuery`
resolves at once from the cache and refreshes stale data in the background;
it waits only when nothing is cached or a mutation invalidated the entry.
(The Router docs mark `ensureQueryData`/`prefetchQuery` as deprecated.)

The same applies to the session: the root `beforeLoad` reads
`sessionStateQueryOptions()` (`@/lib/session.queries`) through `loadQuery`,
and Better Auth's `session.cookieCache` (5 minutes) spares server functions
a D1 read to open the session. Anything that changes who is signed in or
which workspace is open must call `queryClient.clear()` before
`router.invalidate()` (sign-in, sign-up, sign-out, switching or creating a
workspace, accepting an invitation all do). While a navigation does wait, a
thin lime bar (`NavigationProgress` in `app-shell.tsx`) shows at the top.

## Shared content UI (use this, do not re-implement it)

The colour and shape of a channel or status is decided only in
`channel-badge.tsx` and `status-badge.tsx`. Never style a channel or status
anywhere else.

| Import | Component | Props | Use for |
| --- | --- | --- | --- |
| `@/components/content/channel-badge` | `ChannelBadge` | `channel`, `compact?` (16px square with a 2-letter abbreviation), span props | any mention of a channel |
| `@/components/content/status-badge` | `StatusBadge` | `status`, span props | any mention of a status |
| `@/components/content/assignee-avatar` | `AssigneeAvatar` | `member: TeamMember \| null` (`null` = unassigned), `size?: 'sm' \| 'default'`, `className?` | assignee; full name in a tooltip |
| `@/components/content/content-item-card` | `ContentItemCard` | `item`, `from: EditorOrigin`, `variant?: 'card' \| 'compact'`, `assignee?: TeamMember \| null`, `ref`, anchor props | an item on the board (`card`) or in a calendar cell (`compact`) |
| `@/components/content/content-filters` | `ContentFilters` | `value: ContentFilterValues`, `onChange(value)`, `members: TeamMember[]`, `className?` | the filter bar of every content view |

- `ContentItemCard`'s root element is a `<Link>` to `/content/$itemId` with
  `search={{ from }}`. It forwards `ref` and extra props to that element. Look
  the assignee up from `teamMembersQueryOptions()` and pass it in.
- The tooltip provider and the toast container are mounted once in
  `src/routes/__root.tsx`. Show a toast anywhere with
  `import { toast } from 'sonner'`. Do not mount another `<Toaster>`.
- Times: `<LocalDateTime value={date} format="time" />` shows the time only.

### Filters in the URL: `@/lib/content-filters`

- `contentFilterSearchSchema`: zod schema for `channels`, `statuses`,
  `assigneeId` search params. Unknown or malformed values are dropped, never
  an error. Use it as `validateSearch`, or `.extend({...})` it when a page has
  more search params.
- `toContentListFilters(search)`: the `ContentListFilters` for the data layer
  (`{}` when nothing is set). Add a date range with a spread.
- `hasContentFilters(search)`, type `ContentFilterValues`.

```tsx
export const Route = createFileRoute('/_app/content/')({
  validateSearch: contentFilterSearchSchema,
  loaderDeps: ({ search }) => ({ filters: toContentListFilters(search) }),
  loader: ({ context, deps }) =>
    loadQuery(context.queryClient, contentListQueryOptions(deps.filters)),
})
// component:
const search = Route.useSearch()
const navigate = Route.useNavigate()
const { data } = useSuspenseQuery(contentListQueryOptions(toContentListFilters(search)))
<ContentFilters value={search} members={members}
  onChange={(next) => void navigate({ search: next, replace: true })} />
```

If the page has other search params, keep them:
`search: (prev) => ({ ...prev, channels: next.channels, statuses: next.statuses, assigneeId: next.assigneeId })`.

### Editor routes: `@/lib/editor-search`

| Route | Search (all optional) |
| --- | --- |
| `/content/new` | `from`, `scheduledAt` (ISO instant with offset, e.g. `date.toISOString()`), `status`, `channel` |
| `/content/$itemId` | `from` |

- `from` is `'calendar' \| 'pipeline' \| 'content'` (`EDITOR_ORIGINS`, type
  `EditorOrigin`): where the editor returns after saving or cancelling.
  `editorReturnPath(from)` gives the path (`/content` when absent).
- Schemas: `newItemSearchSchema`, `editItemSearchSchema`; malformed values are
  dropped. `scheduledAt` stays a string in the URL: `new Date(search.scheduledAt)`.
- Links are type-checked:
  `<Link to="/content/new" search={{ from: 'calendar', scheduledAt: day.toISOString() }} />`,
  `<Link to="/content/$itemId" params={{ itemId }} search={{ from: 'pipeline' }} />`.
- `/content/$itemId` loads the item with `contentItemQueryOptions(itemId)` and
  renders its `notFoundComponent` for a missing or malformed id.
- Both pages render `ContentItemForm` (`@/components/content/content-item-form`),
  which validates with `createContentItemSchema` (field errors next to the
  fields, server errors in an alert). Layout: the title is edited in place as
  the page heading; the main column holds copy, media (`media` prop, the
  `ContentAssets` of an existing item) and notes; a panel on the right
  (sticky on large screens, below on small ones) holds Save/Close, every
  property and Delete. Saving an existing item stays on the page and resets
  the "unsaved changes" state; creating one opens the new item's page (so
  media can be added). Ctrl/Cmd+S saves. The back link, Close/Cancel and
  Delete go to `editorReturnPath(from)`. The routes use `ssr: 'data-only'`:
  the form reads local times, so it renders in the browser.

### Item text by channel: `@/lib/post-text`

`body` is always stored as a string; what it holds depends on the channel.

- **Blog: Markdown.** Edited with Tiptap (`@tiptap/react`, StarterKit with
  h1-h3 (the toolbar offers h2/h3), no underline, `TableKit` from
  `@tiptap/extension-table`, plus `@tiptap/markdown`), which loads and writes
  Markdown (`contentType: 'markdown'`, `editor.getMarkdown()`). Every node
  Markdown can hold must be in the schema, or a save rewrites it as plain
  paragraphs. Formatted display uses the `.zora-prose` styles in `app.css`.
  Saved text opens formatted and read-only ("Editar", or a click in the
  text, edits it there; "Visualizar" goes back); a save returns to that view
  (the form passes the field's `isDirty` as `dirty`).
- **X, LinkedIn, Instagram: plain text.** They do not render Markdown, so
  `**` would be posted literally. The editor shows a character count against
  `CHANNEL_TEXT_LIMITS` (280 / 3000 / 2200; graphemes via `countCharacters`),
  warns when `hasMarkdownFormatting`, offers "Remover formatação"
  (`stripMarkdown`) and "Copiar texto".
- Both live in `ContentBodyEditor` (`@/components/content/content-body-editor`),
  chosen by `isMarkdownChannel(channel)`. Changing an item's channel keeps the
  text. Limits are guidance, not validation: the server accepts any length.
- Agents are told the same rule in the `body` description and
  `AGENT_INSTRUCTIONS` (`@/lib/agent-tools`).

### Media: `@/lib/content-assets`

An item can have uploaded files (images, videos, PDFs), shown and managed in
`ContentAssets` (`@/components/content/content-assets`) on `/content/$itemId`.
The `assetLinks` field still holds external URLs; uploads are separate.

- `@/lib/content-assets` is the one place that lists the allowed types
  (`MEDIA_TYPES`), the 100 MB limit (`MAX_ASSET_BYTES`, the Workers request
  body limit) and the URLs (`assetFileUrl`, `assetUploadUrl`). SVG is not
  allowed on purpose.
- Bytes are in R2 under `content/<itemId>/<assetId>`; the `content_asset` table
  holds name, type and size and cascades with the item. Deleting an item goes
  through `deleteContentItemWithAssets`, which also removes the objects.
- Upload is `POST /api/content/<itemId>/assets?filename=...` with the file as
  the raw body (not multipart), so it streams into R2 without being buffered.
  R2 needs the length up front: the browser sends `Content-Length` for a
  `File`. Use `useUploadContentAsset(itemId)` (progress callback).
- Files are served by `GET /api/assets/<assetId>` for `<img>`/`<video>`, with
  range requests (video seeking). Reads need a session; responses are
  `private`, `nosniff`, and `inline`.
- List and delete are server functions: `contentAssetsQueryOptions(itemId)`,
  `useDeleteContentAsset(itemId)`.
- `content_asset.attribution` (JSON, nullable; type `AssetAttribution`) records
  where a file fetched by the MCP image tools came from: an Unsplash photo
  (photographer, profile and photo links with UTM parameters) or a fal
  generation (model, prompt). Uploads have `null`. The media tile shows
  `assetCreditText` ("Foto: Nome / Unsplash", "Imagem gerada por IA"); the
  viewer links the photographer and Unsplash.

### Designs: `@/lib/content-designs`

A design is a Zora Studio document belonging to a content item (the plan is
`docs/STUDIO-PLAN.md`; its "Contracts" section is binding for Studio too).
Each save is an immutable **version**: the editable source (`.vectorcraft`,
JSON or gzip) and a PNG preview, both in R2 under
`designs/<designId>/<versionId>/source.vectorcraft` and `.../preview.png`
(`designSourceKey`, `designPreviewKey`). Tables: `content_design` (name,
`width_px`/`height_px` 1..16384, `preset`, `current_version_id`, null until the
first save) and `content_design_version` (`number` 1, 2, 3 per design, unique;
`author_kind` `user` | `agent`; sizes). Both cascade with the item.

- `@/lib/content-designs` lists the presets (`DESIGN_PRESETS`: Studio's preset
  `name`, a pt-BR `label`, the size) and the default per channel
  (`CHANNEL_DESIGN_PRESETS`: instagram 1080×1080, x 1600×900, linkedin
  1200×627, blog 1200×630). Limits: source 50 MB, preview 20 MB. Never restate
  them.
- **Saving (HTTP, for Studio):** `POST /api/designs/<id>/versions`, multipart
  `source`, `preview`, `baseVersionId` (empty for the first save) -> `201
  {versionId, number}`. A base that is not the current version gets `409
  {error, currentVersionId, currentVersionNumber}`: nobody overwrites anyone.
  Files are checked by signature (gzip or `{`; PNG) and size (413). Read:
  `GET /api/designs/<id>` (metadata), `.../source` and `.../preview`
  (`?version=` or the current one; 404 without a version).
- **Safety:** sources are served only as `application/octet-stream`,
  `attachment`, `nosniff`, `no-store`; previews as `image/png` inline. Both
  carry `X-Design-Version` and a `sandbox` CSP. SVG stays forbidden.
- **Concurrency without transactions:** `saveDesignVersion` puts both
  objects, then one `db.batch`: an UPDATE of the design guarded by the
  `updated_at` it read, and an `INSERT ... SELECT` of the version row that only
  finds the design if that UPDATE applied. A stale base or a lost race is a
  `DesignConflictError` and the objects are deleted again. Every write moves
  `updated_at` strictly forward (rename too).
- Server functions (`@/lib/content-designs.functions`): `listContentDesigns`,
  `createContentDesign` (preset, or width and height, or the item's channel),
  `renameContentDesign`, `deleteContentDesign`, `listDesignVersions`,
  `restoreDesignVersion` (copies the old files into a new version; history is
  never rewritten), `publishDesignPreview` (copies the current PNG into the
  item's media as `<name>.png`). Hooks and query options:
  `@/lib/content-designs.queries` (keys `contentKeys.designs(itemId)`,
  `contentKeys.designVersions(designId)`).
- Deleting a design or its item deletes its R2 objects
  (`deleteContentDesign`, `deleteContentItemWithAssets`).
- UI: `ContentDesigns` (`@/components/content/content-designs`) on
  `/content/$itemId`, above the media: cards with the latest PNG (the URL
  names the version, so it refreshes on save), "Novo design" with the
  channel's size preselected, and per card a menu (open, versions with
  restore, "Usar como mídia", rename, delete). Cards link to
  `/content/$itemId/designs/$designId` (file `$itemId_.designs.$designId.tsx`,
  not nested under the item page). Its dialogs are portalled but still inside
  the item `<form>` in React's tree, so their forms stop the submit event.
- MCP: `create_design`, `list_designs`, `get_design` (the PNG
  as image content up to 4 MB), `list_design_versions`,
  `restore_design_version`, `publish_design`, plus the engine tools (see
  "Design engine"). Agent saves use `authorKind: 'agent'`.

### Photo edits: `@/lib/content-photo-edits`

A photo edit is a LightCraft development of one original photo belonging to a
content item (the plan is `docs/LIGHTCRAFT-PLAN.md`; its "Contracts" section is
binding). It copies the designs feature's shape; the differences are below.

- **The original is always the edit's own copy**, in R2 at
  `photo-edits/<editId>/original.<ext>` (`photoEditOriginalKey`), also when
  the edit starts from an image of the item's media: the media's id is kept
  only as provenance (`source_asset_id`, `on delete set null`), so deleting or
  replacing media never breaks an edit. Tables: `content_photo_edit` (name,
  `original_key`/`original_name`/`original_size`, `current_version_id`, null
  until the first save) and `content_photo_edit_version` (`number` unique per
  edit, `author_kind` `user` | `agent`, `settings_size`, `preview_size`). Both
  cascade with the item.
- **Accepted originals** (`PHOTO_ORIGINAL_EXTENSIONS`, the one list): the
  image types of `MEDIA_TYPES` except GIF, plus TIFF and the camera raws
  LightCraft imports that have a checkable signature (CR2, CR3, CRW, NEF, NRW,
  ARW, SRF, SR2, RAF, ORF, RW2, RWL, PEF, SRW, MRW, X3F, 3FR, FFF, IIQ, ERF,
  KDC, MEF, MOS, DNG). Recognised **by extension** (browsers send no useful
  type for raws), then checked **by signature** after it is stored (a ranged
  read of the first 16 bytes; refused objects are deleted):
  `hasPhotoOriginalSignature` follows LightCraft's `crates/codecs/src/sniff.rs`
  (TIFF `II*\0`/`MM\0*`, ORF `IIRO`/`IIRS`/`MMOR`, RW2 `IIU\0`, RAF
  `FUJIFILMCCD-RAW`, MRW, X3F, CRW, CR3 `ftypcrx `). Originals ≤ 100 MB
  (`MAX_PHOTO_ORIGINAL_BYTES` = `MAX_ASSET_BYTES`). Raws never become media
  (`MEDIA_TYPES` is unchanged).
- **Creating:** from an image asset of the same item (`createPhotoEditFromAsset`,
  an R2-to-R2 copy: the `get` body goes through a `FixedLengthStream` because
  R2 `put` needs a known length), or from an upload: `POST
  /api/content/<itemId>/photo-edits?filename=...[&name=...]` with the file as
  the raw body (`Content-Length` required, streamed into R2; the edit id is
  generated before streaming, since it names the key) -> `201 {edit}`. Use
  `useUploadPhotoEditOriginal(itemId)` (progress callback).
- **Versions** = develop settings JSON (`settings.json`, what LightCraft's
  `develop.get` returns, ≤ 1 MB, must start with `{`) + a rendered preview
  (`preview.jpg`, JPEG or PNG by signature, ≤ 20 MB; the R2 object keeps the
  real type, served as that type). `POST /api/photo-edits/<id>/versions`,
  multipart `settings`, `preview`, `baseVersionId` -> `201 {versionId,
  number}`, `409 {error, currentVersionId, currentVersionNumber}`, 411/413/415/
  422 exactly as designs; `savePhotoEditVersion` uses the same guarded
  `db.batch` as `saveDesignVersion`. Reads: `GET /api/photo-edits/<id>`
  (metadata), `.../original`, `.../settings` (both `application/octet-stream`,
  `attachment`, `private, no-store`) and `.../preview` (inline, `private`),
  `?version=` for the last two; all carry `nosniff`, a `sandbox` CSP and
  `X-Photo-Edit-Version`.
- Server functions (`@/lib/content-photo-edits.functions`):
  `listContentPhotoEdits`, `createContentPhotoEdit` (from an asset),
  `renameContentPhotoEdit`, `deleteContentPhotoEdit` (with its R2 objects),
  `listPhotoEditVersions`, `restorePhotoEditVersion`, `publishPhotoEditPreview`
  (the current preview into the item's media as `<name>.jpg`, or `.png`).
  Query keys `contentKeys.photoEdits(itemId)`,
  `contentKeys.photoEditVersions(editId)`. `deleteContentItemWithAssets` also
  deletes the photo edits' originals and versions.
- UI: `ContentPhotoEdits` (`@/components/content/content-photo-edits`), the
  "Fotos" section below "Designs" on `/content/$itemId`: cards with the
  latest preview (the URL names the version), or the original's file name
  and a placeholder before the first save (a browser cannot show a raw);
  "Nova edição de foto" picks an image of the item's media or uploads a file;
  per card: versions with restore, "Usar como mídia", rename, delete. "Abrir
  no LightCraft" is disabled until the editor page
  `/content/$itemId/photos/$editId` exists (task Z3).
- MCP: `create_photo_edit` (from an image asset), `list_photo_edits`,
  `get_photo_edit` (the preview as image content up to 4 MB),
  `list_photo_edit_versions`, `restore_photo_edit_version`,
  `publish_photo_edit`. No photo engine tools yet (task Z6).

### Design engine: `@/lib/studio-engine.server`

Zora Studio's engine, headless, as a stateless HTTP service
(`apps/zora-studio-server` in `../zora-vector`; contract in
docs/STUDIO-PLAN.md, "Engine service": `GET /health`, `GET /commands[?q=]`,
`POST /run` with base64 bytes -> `{source, preview, results, inspect?}` or
`422 {error, index}`). Agents edit designs with it through MCP.

- **Client** (`studio-engine.server.ts`, no Cloudflare imports, tested with
  a fake transport): `runEngine`, `listEngineCommands`, `engineHealth` over a
  `StudioEngineTransport` (`{name, fetch(path, init)}`). Limits are checked
  before sending (200 commands, 20 images named `[A-Za-z0-9_-]{1,64}`, 25 MB
  each and 40 MB together, 50 MB source) and while reading (answer size,
  decoded source <= 50 MB and preview <= 20 MB, the design limits).
  Timeouts: 100 s for `/run` (the engine allows 60 s, plus a cold start), 45
  s otherwise. Errors: `StudioEngineCommandError` (422, with `index`),
  `StudioEngineNotConfiguredError`, `StudioEngineError` (anything else; MCP
  turns them into `isError` results).
- **Where it runs** (`getStudioEngine()`, per request): `STUDIO_ENGINE_URL`
  (optional env var, http(s); the binary run natively for development) wins;
  else the `STUDIO_ENGINE` Durable Object binding; with neither, null and the
  tools answer "the design engine is not configured". `StudioEngine`
  (`studio-engine-container.server.ts`, exported from `src/server.ts`) uses
  the Durable Object Container API (`ctx.container`, `durable_object`
  scheduling policy, as the current Containers docs do; no
  `@cloudflare/containers`): it starts image `ctx.container.images.engine`
  on `standard-1` (1/2 vCPU, 4 GiB), without Internet access, with
  `PORT=8080`, waits for `/health` (40 s at most), forwards the request, and
  lets the container sleep after 5 minutes without requests. Requests are
  spread over 2 named instances. Without a container (the `containers` entry
  is off) it answers 503 `not-configured`, which the client maps to the same
  message.
- **The switch** is the `containers` entry in `wrangler.jsonc`, commented
  out until the owner pushes an image (README, "Design engine"): the image
  is a digest-pinned `registry.cloudflare.com/...@sha256:...` reference,
  because Workers Builds clones only this repo and cannot build the sibling
  repo's Dockerfile. The Durable Object binding and its `exports` entry
  (SQLite) are always there. `dev.enable_containers` is false: Wrangler
  refuses containers on Windows and needs Docker, so `pnpm dev`, `pnpm
  build` and the tests never touch one (checked with the entry switched on,
  too). Locally, set `STUDIO_ENGINE_URL` instead.
- **Tools** (`mcp.server.ts`, tested in `mcp.engine-tools.test.ts`):
  `list_design_commands` (`query`, `limit` <= 200, default 40; `{id, label,
  params}` with long params cut), `list_design_fonts` (families, styles and
  axes from R2 `studio-fonts/manifest.json`, `category` filter; no engine
  needed; notes that Studio's built-in fonts exist too), `edit_design`
  (`designId`, optional `baseVersionId`, `commands: [{command, params}]` 1 to
  200, optional `images: {name: assetId}`: image media files of the caller's
  workspace, read from R2 and sent as base64, placed by `"zora-image:<name>"`
  params). It runs on the current version's source, or `new: {width, height,
  name}` from the design when it has none, with `render: {scale: 1, maxSize:
  4096}`, then saves an `agent` version through `saveDesignVersion` (the 409
  rule: a stale `baseVersionId`, or a Studio save while the engine ran, is an
  `isError` telling the agent to look again; nothing is saved). It returns
  the version number, the engine's `results` (cut at 60k characters) and the
  PNG as image content (up to 4 MB; otherwise a note). A 422 returns the
  failing command's index, id and message, nothing saved. `render_design`
  (current or `versionId`; the stored preview without `scale`, an engine
  render with `scale` 0.05 to 4; never saves), `inspect_design` (`/run` with
  `inspect: true` and no commands; the structure, cut at 60k characters).
  Not in WebMCP.

### Zora Studio hosting: `@/lib/studio-hosting`

Zora Studio (the Rust/wasm editor in `../zora-vector`, built with Trunk to
`dist/web`) is served by this Worker from R2, because its ~73 MB wasm is over
the 25 MiB static-asset limit. Same origin as Zora, so the embedded editor
uses the session cookie for `/api/designs/*`.

- **Routes.** `/studio/*` serves R2 `studio/<path>` (`/studio/` is
  `studio/index.html`; `/studio` redirects to `/studio/`, because Studio's
  index loads its files by relative URL) and `/studio-fonts/*` serves R2
  `studio-fonts/<path>`. Both need a session (401 otherwise, like
  `/api/assets`), answer `GET` and `HEAD`, set `nosniff`, an ETag and 304 on
  `If-None-Match`, and stream the body. `bundleContentType` picks the type
  by extension (`application/wasm`, `text/javascript`, `text/html`, PNG,
  fonts; no extension = plain text for licence files; SVG and unknown =
  `application/octet-stream`). Names carrying a 16-digit hex hash in a file
  or folder name (`-3ee0a15109942011.js`, `-c1b3de632dbb07fa_bg.wasm`,
  `snippets/eframe-<hash>/`, `fonts/<sha16>/`) are
  `public, max-age=31536000, immutable`; everything else (index.html, the
  font manifest, icons, licences) is `no-cache`. `resolveBundlePath`
  refuses `..`, dot-files, empty segments, encoded slashes and backslashes,
  and anything outside `[A-Za-z0-9._@+~-]`.
- **Bundle map.** `HOSTED_BUNDLES` lists every bundle (`STUDIO_BUNDLE`,
  `STUDIO_FONTS_BUNDLE`, `LIGHTCRAFT_BUNDLE`): URL prefix, R2 key prefix,
  index file, `hashedNames` (whether the hash rule above may make a file
  immutable) and `skipPrecompressed` (whether the publish script leaves out
  `.gz`/`.br` copies). The routes are one line each over
  `handleBundleRequest` (`studio-hosting.server.ts`): the bare prefix of a
  bundle with an index redirects (308) to the slashed one, then 401 without
  a session, then `serveBundleFile`. A new bundle is an entry here plus a
  route, never a copy of this code; Studio's tests guard its behaviour.
- **`pnpm studio:publish`** (`scripts/studio-publish.ts`) uploads every file
  of `../zora-vector/dist/web` (or `--dir`), `index.html` last, then deletes
  `studio/` objects of older builds. Locally it writes the simulated bucket
  in `.wrangler/state/v3` through Wrangler's `getPlatformProxy` (the same
  store `pnpm dev` reads; stop or restart `pnpm dev` around it to be safe).
  `--remote` uses `wrangler r2 object put/get/delete --remote` and keeps a
  `.published.json` key list for the stale-object cleanup (remote R2 cannot be
  listed with Wrangler); owner's step only. The scripts are TypeScript run
  by Node's type stripping (imports with `.ts`, hence
  `allowImportingTsExtensions`); `src/lib` modules they import
  (`studio-hosting.ts`, `studio-fonts.ts`) must stay free of imports. The
  folder walk and the per-file filter (`collectBundleFiles` in
  `scripts/lib/r2-store.ts`, over `bundleUploadEntry`) are shared by both
  publish scripts: dot-files are skipped, and a name the route would not
  serve is an error.
- **Font library: `pnpm fonts:sync`** (`scripts/fonts-sync.ts`, logic in
  `@/lib/studio-fonts`). Downloads the curated families
  (`STUDIO_FONT_FAMILIES`) from google/fonts at `GOOGLE_FONTS_COMMIT`, only
  from `ofl/` (Permanent Marker and Satisfy are Apache-2.0 there and are
  skipped), reading each `METADATA.pb` for files, weights, styles, category
  and axes; files are cached in `.cache/fonts/<commit>/` (git-ignored).
  Uploads `<folder>/<name>-<sha16>.<ext>` plus each family's
  `OFL-<sha16>.txt`, then `manifest.json`:
  `{version, source, families: [{family, category, license: "OFL-1.1",
  licenseUrl, axes, files: [{style, weight, italic, url, sha256, size,
  variable}]}]}` (`licenseUrl`, `axes`, `variable` and `source` are additions
  to the plan's contract). Most families are variable fonts (one file per
  upright/italic, weight 400 = Google's default instance, the range in
  `axes`); static families list one file per weight. To change the
  library, edit the list or bump the commit.
- **Editor page** `/content/$itemId/designs/$designId` (`ssr: 'data-only'`,
  search `from` kept for the way back to the item): full bleed, no Zora
  header. The route sets `staticData: { fullBleed: true }`, so `AppShell`
  drops its page padding and `--page-h` becomes the whole height right of
  the sidebar (100svh from `lg`; below `lg`, the height under the mobile top
  bar); Studio's iframe fills it (no border, no radius). Studio itself shows
  the design name, the save state and "Voltar ao item". `src` =
  `studioEditorUrl(designId, theme)` (`/studio/?design=<id>&theme=dark|light`,
  theme from `zora_theme`, fixed for the page's life so a theme switch never
  reloads unsaved work). It first sends `HEAD /studio/`; 404 / 401 / a
  network error show a pt-BR explanation with a small "Voltar ao item" link
  (with `PAGE_PADDING` from `app-shell`, as do the phone and not-found
  states). Messages from Studio are accepted only when `event.origin` is
  Zora's and `event.source` is the frame (`parseStudioMessage` also checks
  the design id): `ready`, `dirty` (a router blocker with a dialog and
  `beforeunload` warn before leaving while dirty), `saved` (clears dirty,
  invalidates `contentKeys.designs(itemId)` and `designVersions(designId)`),
  `back` (navigates to `/content/$itemId` keeping `from`; the blocker asks
  first when dirty). Below `md` (phones) the page shows a "needs a larger
  screen" message instead.

### LightCraft hosting

LightCraft (the photo library and raw developer in `../zora-lightcraft`,
built with `cargo xtask web` to `target/web-site/`) is hosted the same way
(docs/LIGHTCRAFT-PLAN.md, D1 and Z1): `/lightcraft/*` serves R2
`lightcraft/<path>` through the bundle map (`LIGHTCRAFT_BUNDLE`), with
the same session gate, 308 from `/lightcraft`, path safety, ETag/304, HEAD
and `nosniff`. The build is `index.html`, `worker.js`, `lightcraft_web.js`,
`lightcraft_web_bg.wasm` (~13.5 MB, `application/wasm`) and, only when built
with `CRAFT_FONTS_DIR`, `lightcraft_zh_hans.otf` with
`OFL-noto-sans-cjk-sc.txt`. Its names are the same in every version, so
every file is `no-cache` (`hashedNames: false`; the hash rule never applies).
`pnpm lightcraft:publish` (`scripts/lightcraft-publish.ts`) uploads that
folder (or `--dir`) like `studio:publish`, `index.html` last, with the
stale-object cleanup, but **skips the `.gz`/`.br` copies** xtask writes: the
route streams the raw file and Cloudflare compresses `application/wasm` on
the way out. `--remote` is the owner's step. The COOP/COEP headers LightCraft
documents are optional today (no shared memory) and are not sent. The photo
editor page that embeds it is task Z3.

### Drag and drop: `@dnd-kit/react`

Use `@dnd-kit/react` (the package the dnd-kit docs now recommend; React 19;
pointer, touch and keyboard built in). Docs: https://dndkit.com/react/quickstart.
Do not install the legacy `@dnd-kit/core` / `@dnd-kit/sortable`.

```tsx
import { DragDropProvider, useDraggable, useDroppable } from '@dnd-kit/react'
import { contentDragSensors } from '@/lib/dnd'

function DraggableCard({ item }: { item: ContentItem }) {
  const { ref, isDragging } = useDraggable({ id: item.id })
  return <ContentItemCard ref={ref} item={item} from="pipeline" />
}
function Column({ status, children }) {
  const { ref, isDropTarget } = useDroppable({ id: status })
  return <div ref={ref}>{children}</div>
}
<DragDropProvider
  sensors={contentDragSensors}
  onDragEnd={(event) => {
    if (event.canceled) return
    const { source, target } = event.operation
    if (source && target) changeStatus.mutate({ id: String(source.id), status: target.id })
  }}
>
```

- Always pass `sensors={contentDragSensors}`: the card is a link, so Enter
  must open it. Space picks up and drops, arrows move, Escape cancels. Mouse
  and pen drags start only after 5px of movement, touch after a 250ms hold; a
  plain click or tap still follows the link. (dnd-kit's default also starts a
  mouse drag after holding still for 200ms, which swallowed slow clicks; do
  not go back to the default sensors.)
- It renders under SSR in `workerd` (verified); no client-only wrapper needed.
- `DragOverlay` (`@dnd-kit/react`) and `useSortable` (`@dnd-kit/react/sortable`)
  are available if needed; ordering within a column is not persisted.

## Workspaces (Better Auth organizations)

- **Model.** A workspace is a Better Auth organization (`organization()` in
  `createAuth`; tables `organization`, `member`, `invitation`,
  `session.active_organization_id`). `content_item.organization_id` scopes
  items; media follow their item. Roles: `owner`, `admin`, `member` (labels
  in `@/lib/workspace`). Owners and admins invite, cancel and remove
  (`canManageMembers`, Better Auth checks again); every member edits content.
  Workspace deletion is disabled (it would orphan R2 media).
- **Scope every query.** `authMiddleware` provides `context.workspace` (the
  session's active organization while the user is still a member, else
  their oldest one; 403 without any). Every service function in
  `content.server.ts` / `content-assets.server.ts` takes `organizationId`
  and only touches that workspace's rows. The HTTP media routes resolve it
  with `findSessionState`; MCP with `resolveMcpWorkspace` (persisted per user
  in `mcp_workspace_state` when switched via `switch_workspace` /
  `create_workspace`, falling back to the user's most recently used browser
  session, then their oldest workspace, else `null`).
- **Route context.** The root route loads `user` and `workspace`; `_app`
  sends users without a workspace to `/workspaces/new` and exposes a
  non-null `workspace`. The sidebar switcher calls
  `authClient.organization.setActive` and then clears the Query cache.
- **Invitations.** `/team` (Equipe) invites through `inviteWorkspaceMember`
  -> `inviteToWorkspace`: Better Auth creates the invitation (7 days), then
  we send the email with the `EMAIL` binding (Cloudflare Email Sending, from
  `zora@notify.lume.software`). We do not use Better Auth's
  `sendInvitationEmail`: it swallows send errors, and the inviter must know
  (`emailSent: false` -> "copy the link"). The link is `/invite/<id>`: public
  preview (`getInvitationPreview`), then sign up / sign in with the invited
  email (prefilled via `?email=`) and accept. A pending invitation lets its
  email sign up even when it is not on `ALLOWED_SIGNUP_EMAILS`.
- **Email locally.** `pnpm dev` simulates the binding: the message is logged
  in the terminal and saved under `.wrangler/tmp/email`. In production,
  sending to arbitrary recipients needs the Workers Paid plan.
- The migration `20261117134314_useful_frightful_four` (hand-edited) moved
  the existing data into the "Signum" workspace; its test is
  `src/db/workspace-migration.test.ts`.

## Agents: MCP server and WebMCP

Both expose the same actions; their inputs and descriptions live in
`@/lib/agent-tools` (client-safe, plain JSON-Schema-friendly zod shapes;
handlers re-validate with the shared `@/lib/content` schemas).

- **MCP server** (`src/routes/mcp.ts`, tools in `src/lib/mcp.server.ts`,
  tested in `mcp.server.test.ts`): `POST /mcp`, stateless Streamable HTTP via
  `@modelcontextprotocol/server` v2 (`createMcpHandler`, legacy 2025 clients
  served statelessly too). Each request builds a fresh server for the token's
  user. Tools call the `*.server.ts` service functions; rule violations come
  back as `isError` results with the message. Add a tool by adding it to
  `zoraTools` (and to `agentActions` if WebMCP should have it too).
- **Image tools** (MCP only, `@/lib/image-providers.server`, tested in
  `mcp.image-tools.test.ts` with `fetch` mocked): `search_stock_images`
  (Unsplash search, compact results plus up to 6 thumbnails as image
  content), `add_stock_image` (stores the photo, at most 4000 px on the long
  side, as a content asset with its attribution, then calls the photo's
  `download_location` as Unsplash's guidelines require) and `generate_image`
  (fal queue API, endpoint `FAL_IMAGE_MODEL` = `fal-ai/nano-banana-2`; aspect
  from a `designId`; 1 to 4 images, polled every 2.5 s for at most 90 s,
  cancelled after that). Keys are the optional secrets `UNSPLASH_ACCESS_KEY`
  and `FAL_KEY` (`getServerEnv()`, passed in `McpDeps.images`); without one
  the tool returns an `isError` naming it. Downloads are https only, from the
  providers' own hosts (`images.unsplash.com`, `*.fal.media`; redirects
  re-checked), with a timeout, a 30 MB cap, and the type checked from the
  first bytes. They are not WebMCP actions: they spend paid quota and call
  outside services, which belongs on the server with the keys. Unsplash's
  hotlinking rule does not fit a design that embeds the photo: Zora stores a
  copy (that is the "download" the tracking call reports) and keeps the
  credit with it.
- **Photo edit tools** (MCP only, no engine): `create_photo_edit`,
  `list_photo_edits`, `get_photo_edit`, `list_photo_edit_versions`,
  `restore_photo_edit_version`, `publish_photo_edit`; see "Photo edits"
  (tested in `mcp.photo-edit-tools.test.ts`).
- **Design engine tools** (MCP only): `list_design_commands`,
  `list_design_fonts`, `edit_design`, `render_design`, `inspect_design`; see
  "Design engine". `AGENT_INSTRUCTIONS` gives agents the design workflow.
- **Auth**: Better Auth `mcp()` (OAuth 2.1 provider, `@better-auth/mcp`) +
  `jwt()` signing keys, configured in `createAuth`. Discovery is served by
  `auth.handler` from `src/routes/[.]well-known/$.ts`; `requireMcpAuth`
  checks signature, issuer, audience (`mcpResourceUrl`) and expiry. Clients
  register via DCR (`/api/auth/oauth2/register`, open but rate-limited in
  D1; registering grants nothing until a user consents). CIMD was tried and
  dropped: its fetch transport needs connection pinning that Workers cannot
  give, and `cloudflare:sockets` refuses Cloudflare-hosted hosts.
- **Sign-in during OAuth**: `/sign-in` and `/sign-up` must not redirect when
  the URL carries a signed request (`isOAuthContinuation`); the auth client
  (`oauthProviderClient`) follows Better Auth's `{ redirect, url }` itself.
  `/consent` (`ssr: false`) verifies the signed query on the server before
  showing the client and its redirect host.
- **`/connect`** (public; linked under the sign-in and sign-up cards, hidden
  during an OAuth continuation, and from the sidebar): how to connect
  Claude, ChatGPT, Claude Code and Codex, with copyable commands. The URL
  comes from `getMcpServerUrl` (`mcpResourceUrl(BETTER_AUTH_URL)`); the
  per-agent steps live in `@/lib/agent-connect`, which lists the vendor docs
  they were checked against. Re-check them when you edit it.
- **WebMCP** (`src/components/webmcp-tools.tsx`, typings in
  `src/webmcp.d.ts`): registered with `document.modelContext.registerTool`
  while the app shell is mounted, through the Query hooks so changes show on
  screen. Deletes require `window.confirm`. Test in Chrome with
  `--enable-features=WebMCP` (`getTools()` / `executeTool()`).

## Patterns

### Add a protected page

Create `src/routes/_app/<name>.tsx` with `createFileRoute('/_app/<name>')`.
The `_app` layout redirects signed-out users to `/sign-in?redirect=<url>` and
renders the shell. `Route.useRouteContext().user` is the signed-in
`{ id, name, email }`. Add a nav entry (path, label, lucide icon) to `navItems`
in `src/components/app-shell.tsx`. The shell is a shadcn `Sidebar` that
collapses to icons (Ctrl/Cmd+B); its state is a cookie read during SSR
(`@/lib/sidebar-state`), so pages get the full height and width.
The route tree regenerates while `pnpm dev` (or `pnpm build`) runs.

### Responsive layout (phones, iPads, desktop)

Every page must work from a 390px phone up. Check new pages at 390×844,
820×1180 (iPad portrait) and 1180×820 (iPad landscape): no sideways page
scroll, primary actions reachable without hunting.

- **`lg` (1024px) is the shell breakpoint.** Below it (phones, iPad portrait)
  the sidebar is a sheet opened from `MobileTopBar`; `useIsMobile` and the
  sidebar's `lg:` classes follow this. `lg` and up: the fixed sidebar.
- **`--page-h`** (set in `AppShell`) is the height a page can use without the
  window scrolling. Full-height pages use `h-(--page-h)`: the calendar from
  `md`, the item editor from `lg`, the design editor (Studio) from `md`.
  A route with `staticData: { fullBleed: true }` gets no shell padding and a
  `--page-h` of the full height (the design editor); it pads its own
  fallback states with `PAGE_PADDING`.
- **Different component per breakpoint** where a layout cannot shrink:
  `CalendarAgenda` (list of days) replaces the month/week grid below `md`
  (chosen with `useMediaQuery` from `@/hooks/use-media-query`); the content
  list renders stacked rows below `md` and the table from `md`; pipeline
  columns scroll sideways with snapping below `xl` (about 1/2/3 per screen)
  and sit side by side from `xl`.
- **Item editor below `lg`:** one column, and the save/close block becomes a
  bar fixed to the bottom of the screen (safe-area aware; the root viewport
  has `viewport-fit=cover`).
- A flex child that holds wide content needs `min-w-0` (the sidebar inset has
  it), or it pushes the page wider than the screen.

### Add a protected server function

```ts
// src/lib/thing.functions.ts
import { createServerFn } from '@tanstack/react-start'
import { authMiddleware } from './auth-middleware'
import { thingInputSchema } from './thing'          // shared, client-safe schema
import { doThing } from './thing.server'            // DB code taking `db` as a parameter

export const doThingFn = createServerFn({ method: 'POST' })
  .middleware([authMiddleware])
  .validator(thingInputSchema)
  .handler(({ context, data }) =>
    doThing(context.db, context.workspace.id, context.user.id, data),
  )
```

Every server function that touches private data must use `authMiddleware`
and scope its queries by `context.workspace.id`.
Route guards are UX, not the security boundary. Keep DB logic in
`*.server.ts` functions that take `db` explicitly so Vitest can test them
against D1 (see `src/lib/content.server.test.ts`).

### Change the schema

Edit `src/db/content-schema.ts` (or add a file and re-export it from
`src/db/schema.ts`), then `pnpm db:generate` and `pnpm db:migrate`. Commit the
generated `drizzle/` folder. Pushing to `main` deploys through Workers Builds,
whose deploy command (`pnpm deploy:ci`) applies pending migrations to the
production database before `wrangler deploy`, so a migration must work with
the data already there (test it like `src/db/workspace-migration.test.ts`).
Never edit `src/db/auth-schema.ts` by hand.

SQLite rules: enums are `text` columns with `{ enum: LIST }` plus a CHECK
built from the same list (`oneOf` in `content-schema.ts`); dates are
`integer` `timestamp_ms` columns (Drizzle returns `Date`); JSON is
`text({ mode: 'json' })`; ids are `crypto.randomUUID()` strings.

### Dates

Stored as UTC milliseconds (`integer`, `timestamp_ms`), read as `Date`. Display with `<LocalDateTime value={date} />`
(`@/components/local-date-time`): it formats in the browser's time zone after
hydration, because the server does not know the user's zone and would cause a
hydration mismatch. For the same reason, do day/week arithmetic that depends
on the local zone (`date-fns` `startOfDay`, `startOfWeek`, ...) on the client
only, or derive it from an explicit value in the URL.

A route whose loader or markup needs that arithmetic sets `ssr: false`
(`/calendar`: "today" and the day boundaries come from the browser), or
`ssr: 'data-only'` when only the markup does (the editor routes). The calendar
puts its anchor day in the URL as `?date=yyyy-MM-dd` and `?view=month|week`;
the maths is in `@/lib/calendar`. Weeks start on Monday (`WEEK_STARTS_ON`).

## Database decision

Cloudflare D1 (SQLite) through `drizzle-orm/d1`, chosen over Neon Postgres
before launch: one platform and one dashboard, no external database, no
connection setup per request (the binding holds no socket, so Hyperdrive is
not needed), and the free tier covers a three-person team.

- `getRequestServices()` (`src/lib/services.server.ts`) wraps `env.DB` (from
  `cloudflare:workers`) in a Drizzle client and builds Better Auth on it, once
  per `Request`. Better Auth uses `provider: 'sqlite'`.
- **No interactive transactions.** `db.transaction` throws on D1 and SQLite has
  no `SELECT ... FOR UPDATE`. Use single statements or `db.batch([...])`. For
  read-check-write, follow `patchContentItem` in `content.server.ts`: the
  UPDATE matches the `updated_at` that was read, retries from a fresh read when
  it matched nothing, and every write moves `updated_at` strictly forward. The
  CHECK constraints stay as the backstop (a test proves they catch a lost
  update when the guard is removed).
- Foreign keys are enforced on D1.
- The `DB` binding is typed loosely (`AnyD1Database` resolves to `any`)
  because the project does not load the Workers runtime types, which clash
  with the DOM types. `src/cloudflare-workers.d.ts` declares the bindings.
- Tests: `test/db.ts` starts workerd through Wrangler's `getPlatformProxy`
  with `test/wrangler.jsonc` (`persist: false`), so tests use the same engine
  and driver as production.
- Production setup (database id, bucket, migrations): see "Deploying" in
  README.md.

## Surprises and constraints

- **Read env per request.** `process.env` may be empty at module scope on
  Workers. Use `getServerEnv()` inside handlers/middleware only.
- **No module-scope DB or auth instances.** Always go through
  `getRequestServices()` (server code) or the `db` in middleware context.
- **Local env:** one `.env` file feeds Vite/`workerd` (the Cloudflare plugin
  reads `.env` when there is no `.dev.vars`). Do not
  add a `.dev.vars`: it would hide `.env` from the Worker.
- `pnpm build` copies `.env` to `dist/server/.dev.vars` for `vite preview`.
  It is not deployed and `dist/` is git-ignored, but do not share `dist/`.
- **D1 limits:** 500 MB per database on Workers Free, 10 GB on Paid, and 100
  bound parameters per query: keep `inArray` lists and multi-row inserts
  under that. No transactions (see "Database decision").
- **Password hashing CPU.** Better Auth hashes with scrypt in JavaScript.
  That can exceed the Workers Free plan CPU limit (10 ms) on sign-up/sign-in;
  plan on Workers Paid, or configure a cheaper hash, before launch.
- **CSRF:** there is no `src/start.ts`, so Start installs its CSRF middleware
  for server functions automatically. If you add `src/start.ts`, add
  `createCsrfMiddleware()` explicitly (see the Middleware docs).
- **Containers need the Workers Paid plan** and never run locally
  (`dev.enable_containers: false`); the engine container is off until the
  owner switches it on (see "Design engine"). Do not add a Dockerfile path to
  `containers`: Workers Builds cannot see `../zora-vector`.
- **TypeScript is pinned to 6.0.x** because typescript-eslint supports
  `<6.1`. Don't upgrade to TS 7 until typescript-eslint does.
- **pnpm 12** blocks dependency build scripts unless listed under
  `allowBuilds` in `pnpm-workspace.yaml` (esbuild, workerd are allowed).
- **shadcn** in this version generates `cn` from the `cn` package
  (`src/lib/utils.ts`), not clsx + tailwind-merge.
- `compatibility_date` in `wrangler.jsonc` must not be newer than the
  installed `workerd` supports; bump both together.
- Sign-up is enforced in Better Auth's `databaseHooks.user.create`
  (`src/lib/auth.server.ts`), so it covers every way a user can be created:
  allowed are emails with a pending invitation, plus `ALLOWED_SIGNUP_EMAILS`
  (the backup path; empty allows nobody by itself).
- Sign-out on the client also calls `queryClient.clear()` so the next user
  never sees cached data.
