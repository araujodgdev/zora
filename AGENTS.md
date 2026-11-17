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
  locally under `.wrangler/state`).
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
    api/auth/$.ts            Better Auth HTTP handler
    mcp.ts                   POST /mcp: MCP server behind OAuth (see "Agents")
    consent.tsx              OAuth consent page for MCP clients
    connect.tsx              /connect: public docs, connect an agent to the MCP server
    [.]well-known/$.ts       OAuth discovery documents (served by Better Auth)
    api/content/$itemId/assets.ts  POST: upload a file of an item (raw body)
    api/assets/$assetId.ts   GET: serve an uploaded file (session required, range support)
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
    content-schema.ts        content_item table + enums
    schema.ts                re-exports both (used by drizzle-kit)
    client.server.ts         createDb(binding): Drizzle over the D1 binding
  components/                app-shell, auth-layout, brand (logo, clay loops, loader),
                             connect-agent-link, copy-field, form-field,
                             local-date-time, ui/ (shadcn)
  assets/brand/              generated clay artwork (see scripts/brand/README.md)
    content/                 shared content UI kit: channel-badge, status-badge,
                             assignee-avatar, content-item-card, content-filters
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
  `lg` the Z alone, with the `ZoraWordmark` large above the form), and the
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
  with `findSessionState`; MCP with `resolveMcpWorkspace` (the workspace of
  the user's most recently used session).
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
  `md`, the item editor from `lg`.
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
