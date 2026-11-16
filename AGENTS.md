# AGENTS.md

Guide for agents (and people) working on Zora: an internal TanStack Start app
for a three-person team planning a product launch. Users share one workspace;
everyone sees and edits all content.

## Rule: ground code in the current docs

These libraries change quickly. Before writing code in an area, read the
current official docs for it and follow them. Where the docs disagree with
what you remember, the docs win. Do not substitute stack choices.

| Area | Docs |
| --- | --- |
| TanStack Start (React) | https://tanstack.com/start/latest/docs/framework/react/overview (append `.md` to any page path for markdown, e.g. `.../guide/hosting.md`) |
| TanStack Router / Query / Form | https://tanstack.com (latest docs of each library) |
| Better Auth (+ TanStack Start integration, Drizzle adapter) | https://www.better-auth.com/docs (append `.md` to page paths; fetch large pages with `curl` and search them) |
| Drizzle ORM / drizzle-kit (PostgreSQL) | https://orm.drizzle.team/docs/overview |
| Cloudflare Workers, Vite plugin, Postgres from Workers | https://developers.cloudflare.com/workers/ |
| Neon drivers and connections | https://neon.com/docs |
| shadcn/ui (TanStack Start) | https://ui.shadcn.com/docs |

## Stack

- TanStack Start (React 19, TypeScript, Vite 8) with TanStack Router (file
  routes), TanStack Query (with `@tanstack/react-router-ssr-query`) and
  TanStack Form.
- Tailwind CSS v4 + shadcn/ui (style `radix-nova`, components in
  `src/components/ui`, added with `pnpm dlx shadcn@latest add <name>`).
- PostgreSQL via Drizzle ORM **1.0 RC** (`drizzle-orm@rc`, as the current
  Drizzle docs install) and drizzle-kit migrations committed in `./drizzle`.
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
pnpm db:up         # Postgres in Docker on localhost:5433 (dev db `zora`, test db `zora_test`)
pnpm db:migrate    # apply migrations to DATABASE_URL
pnpm dev           # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm deploy:check  # build + wrangler deploy --dry-run
pnpm db:generate   # new migration after editing src/db/*-schema.ts
pnpm auth:generate # regenerate src/db/auth-schema.ts after changing auth config
```

`pnpm test` needs the database running; its global setup migrates
`TEST_DATABASE_URL` and the DB tests truncate it.

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
    api/content/$itemId/assets.ts  POST: upload a file of an item (raw body)
    api/assets/$assetId.ts   GET: serve an uploaded file (session required, range support)
  lib/
    content.ts               SHARED content module (enums, labels, schemas, rules, types)
    content.functions.ts     content server functions (RPC contract)
    team.functions.ts        listTeamMembers server function
    content.queries.ts       queryOptions factories, query keys, mutation hooks
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
    client.server.ts         createDb(url) / closeDb(db)
  components/                app-shell, form-field, local-date-time, ui/ (shadcn)
    content/                 shared content UI kit: channel-badge, status-badge,
                             assignee-avatar, content-item-card, content-filters
test/                        Vitest global setup + test DB helpers
drizzle/                     committed SQL migrations
better-auth.config.ts        entry point for the Better Auth CLI only
```

File suffixes follow the Start docs: `*.server.ts` is server-only (import
protection denies it in the client build), `*.functions.ts` holds
`createServerFn` wrappers that are safe to import anywhere, plain `.ts` is
client-safe.

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
    context.queryClient.query(contentListQueryOptions({ scheduledFrom, scheduledTo })),
  component: CalendarPage,
})
function CalendarPage() {
  const { data } = useSuspenseQuery(contentListQueryOptions({ scheduledFrom, scheduledTo }))
  const reschedule = useRescheduleContentItem()
  // reschedule.mutate({ id, scheduledAt: newDate })
}
```

Use the same filters object in the loader and the component (put search-param
filters in `loaderDeps`). Use `queryClient.query` in loaders; the Router docs
mark `ensureQueryData`/`prefetchQuery` as deprecated.

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
    context.queryClient.query(contentListQueryOptions(deps.filters)),
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
  fields, server errors in an alert), saves, deletes (with confirmation) and
  returns to `editorReturnPath(from)`. The routes use `ssr: 'data-only'`: the
  form reads local times, so it renders in the browser.

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
  drags start after 5px, touch after a 250ms hold (dnd-kit defaults); a plain
  click or tap still follows the link.
- It renders under SSR in `workerd` (verified); no client-only wrapper needed.
- `DragOverlay` (`@dnd-kit/react`) and `useSortable` (`@dnd-kit/react/sortable`)
  are available if needed; ordering within a column is not persisted.

## Patterns

### Add a protected page

Create `src/routes/_app/<name>.tsx` with `createFileRoute('/_app/<name>')`.
The `_app` layout redirects signed-out users to `/sign-in?redirect=<url>` and
renders the shell. `Route.useRouteContext().user` is the signed-in
`{ id, name, email }`. Add a nav entry in `src/components/app-shell.tsx`.
The route tree regenerates while `pnpm dev` (or `pnpm build`) runs.

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
  .handler(({ context, data }) => doThing(context.db, context.user.id, data))
```

Every server function that touches private data must use `authMiddleware`.
Route guards are UX, not the security boundary. Keep DB logic in
`*.server.ts` functions that take `db` explicitly so Vitest can test them
against Postgres (see `src/lib/content.server.test.ts`).

### Change the schema

Edit `src/db/content-schema.ts` (or add a file and re-export it from
`src/db/schema.ts`), then `pnpm db:generate` and `pnpm db:migrate`. Commit the
generated `drizzle/` folder. Never edit `src/db/auth-schema.ts` by hand.

### Dates

Stored as `timestamptz` (UTC). Display with `<LocalDateTime value={date} />`
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

## Database driver decision

`pg` (node-postgres) over TCP through `drizzle-orm/node-postgres`, with a
**new client per request** (`getRequestServices()` in
`src/lib/services.server.ts`, keyed by the current `Request`).

Why:

- One code path for local Docker Postgres and Neon. Neon's serverless driver
  (`@neondatabase/serverless`, HTTP/WebSocket) only talks to Neon, so it could
  not reach the local database without an extra proxy.
- Cloudflare's Postgres tutorial and Neon's "Choosing your connection method"
  guide both use `pg` from Workers (TCP sockets, `nodejs_compat`), and `pg` is
  what Hyperdrive expects.
- Cloudflare and Better Auth docs: Workers cannot reuse I/O objects across
  requests, so pools/clients must not live at module scope. Hence the
  per-request client (and per-request Better Auth instance, which holds it).
  The runtime closes the socket when the request ends.

Verified: the dev server (`workerd`) and `pnpm preview` both reach the Docker
Postgres at `127.0.0.1:5433`.

Production note: without Hyperdrive each request opens a fresh TCP+TLS
connection to Neon (several round trips). Neon and Cloudflare recommend
Hyperdrive in front of Neon; adopting it means reading
`env.HYPERDRIVE.connectionString` instead of `DATABASE_URL` in
`getRequestServices()` (no other change).

## Surprises and constraints

- **Read env per request.** `process.env` may be empty at module scope on
  Workers. Use `getServerEnv()` inside handlers/middleware only.
- **No module-scope DB or auth instances.** Always go through
  `getRequestServices()` (server code) or the `db` in middleware context.
- **Local env:** one `.env` file feeds Vite/`workerd` (the Cloudflare plugin
  reads `.env` when there is no `.dev.vars`), drizzle-kit and Vitest. Do not
  add a `.dev.vars`: it would hide `.env` from the Worker.
- `pnpm build` copies `.env` to `dist/server/.dev.vars` for `vite preview`.
  It is not deployed and `dist/` is git-ignored, but do not share `dist/`.
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
- Sign-up allowlist is enforced in Better Auth's `databaseHooks.user.create`
  (`src/lib/auth.server.ts`), so it covers every way a user can be created.
  An empty `ALLOWED_SIGNUP_EMAILS` allows nobody.
- Sign-out on the client also calls `queryClient.clear()` so the next user
  never sees cached data.
