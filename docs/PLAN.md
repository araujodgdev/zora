# Zora implementation plan

Status as of 2026-11-16. Steps 1 to 8 are done; what is left is under "Before launch". Update this file as steps finish.

Zora is an internal app for a three-person team to plan and run a product
launch. The launch is planned for the week of 2026-11-23. The first feature is
a social media content calendar. `AGENTS.md` describes the architecture, the
commands and the contracts that the steps below build on; read it first.

## Decisions

| Topic | Decision |
| --- | --- |
| Stack | TanStack Start (React) with TanStack Router, Query and Form; Tailwind CSS + shadcn/ui |
| Docs rule | Whoever writes code grounds it in the current official docs (URLs in `AGENTS.md`) |
| Data | Cloudflare D1 (SQLite) through Drizzle ORM, simulated locally by Wrangler; uploaded media in R2. Switched from Neon Postgres on 2026-11-16, before launch |
| Auth | Better Auth inside the app, email + password |
| Team model | One shared workspace: every signed-in user sees and edits everything. No roles, no admin account |
| Sign-up | Limited to the emails in `ALLOWED_SIGNUP_EMAILS`, enforced on the server |
| Hosting | Cloudflare Workers through `@cloudflare/vite-plugin` |
| Channels | X, LinkedIn, Instagram, Blog |
| Formats | Post, thread, carousel, reel, story, article |
| Statuses | Idea, draft, ready, scheduled, published |
| Item model | One item is one piece of content for one channel. A post for two channels is two items |
| Publishing | Track only for now. Auto-publishing comes later |
| Drag and drop | `@dnd-kit/react` with the shared `contentDragSensors` |

## Done

### 1. Foundation

- Project scaffold, scripts, lint, tests, database, first migration.
- Auth: sign-up, sign-in, sign-out, the email allowlist, protected routes that
  return to the requested URL after sign-in.
- App shell with navigation to Calendar, Pipeline and Content.
- Content data layer: shared module `@/lib/content`, eight server functions
  that each check the session, and the TanStack Query helpers.

### 2. Shared content UI kit

- Shared dependencies and shadcn/ui components, so feature work does not need
  to touch `package.json`.
- Shared components in `src/components/content/`: `ChannelBadge`,
  `StatusBadge`, `AssigneeAvatar`, `ContentItemCard`, `ContentFilters`.
- Filter state in the URL (`@/lib/content-filters`) and the editor route
  contract (`@/lib/editor-search`).
- `/content`: list with filters and the quick-create form.
- `/content/new` and `/content/$itemId`: routes and loaders exist; the pages
  are placeholders.
- Optimistic reschedule and status-change mutations with rollback and an
  error toast.

### 3. Local fixes

- `strictPort: true` in `vite.config.ts`, so the dev server never moves off
  port 3000 (`BETTER_AUTH_URL` must match the browser's origin).

### How it was checked

- `pnpm typecheck`, `pnpm lint`, `pnpm test` (73 tests) and `pnpm build` pass
  in this checkout.
- The two agents that built steps 1 and 2 each drove the app in a real browser
  (auth, allowlist, content list, filters, drag and drop under SSR).
- Not yet confirmed: a sign-up by a team member in this checkout.

### 4. Item editor

- `ContentItemForm` (`src/components/content/content-item-form.tsx`) is used by
  `/content/new` and `/content/$itemId`: every field, presets from the URL,
  return to `from` after save, cancel or delete, delete with confirmation.
- Field errors from the shared schema show next to the fields (including "A
  scheduled item needs a scheduled date and time"); server errors show in an
  alert above the form.
- The quick-create form is gone from `/content`.
- The editor routes use `ssr: 'data-only'`, because the form reads local times.

### 5. Calendar

- `/calendar`: month and week views, previous / today / next, filters in the
  URL, `?view=` and `?date=yyyy-MM-dd`. The route has `ssr: false`: days are
  computed in the browser's time zone. Maths and tests: `src/lib/calendar.ts`.
- Compact cards at their scheduled time; drag one to another day to reschedule
  it (the time of day is kept). Click an empty part of a day, or its "+", to
  open `/content/new` at 09:00 of that day. A month cell shows three items and
  a "+N more" link to that week.
- Weeks start on Monday.

### 6. Pipeline board

- `/pipeline`: one column per status, cards draggable between columns,
  filters in the URL, a "+" per column that opens `/content/new` with that
  status.
- Decision on the open question: dropping an unscheduled item on "Scheduled"
  opens a dialog that asks for a date and saves status and date together.
  Cancelling leaves the item where it was.

### How steps 4 to 6 were checked

- `pnpm typecheck`, `pnpm lint` and `pnpm test` (91 tests) pass.
- Driven in Chrome against the dev server: create with and without a date
  (field errors), prefilled editor from the calendar, drag on the calendar,
  click on an empty day, board drags including the schedule dialog and a move
  to Published, edit, save, delete.
- Not checked: touch dragging, dark mode, keyboard dragging on the new pages.

### 7. Media on the item page

- `/content/$itemId` has a Media section: upload by button or drag and drop
  (several files, progress per file), previews in place (images and videos open
  in a viewer, PDFs in a new tab), delete with confirmation.
- Allowed: PNG, JPEG, GIF, WebP, AVIF, MP4, WebM, MOV, PDF, up to 100 MB each.
  Files are in Cloudflare R2 (binding `MEDIA`, bucket `zora-media`); metadata
  in the new `content_asset` table (migration committed).
- Not on `/content/new`: the item has to exist first.

### 8. Database moved to Cloudflare D1

- Schema rewritten for SQLite (text enums with CHECK, millisecond dates, JSON
  as text), auth schema regenerated, one fresh migration. Postgres, Docker and
  `DATABASE_URL` are gone.
- Item updates no longer use a transaction: they write only if `updated_at`
  is unchanged and retry otherwise (tested with simultaneous saves).
- Tests run on an in-memory D1 database; nothing needs to be running.
- Checked: the 101 tests, and the same Chrome flows as steps 4 to 7
  (editor, calendar, pipeline, media upload up to 90 MB, delete cascading to
  R2) against the local D1.

## Before launch

- Deployed on 2026-11-16, served at https://zora.lume.software (see README.md
  "Production"). Checked there with a temporary test account, since removed:
  sign-up and sign-in, the editor, calendar and pipeline flows, media upload,
  playback and delete. The database and bucket were left empty.
- The three partners create their accounts (the allowlist has three emails).
- Password hashing: sign-up and sign-in worked in production. If they ever
  fail with a CPU limit error (Workers Free allows 10 ms), move to Workers
  Paid or configure a cheaper hash.
- Decide on Drizzle: the project uses `1.0.0-rc.5`. Moving to stable 0.45
  means a version change and regenerating the migration.

## Known gaps

- Touch dragging and dark mode have not been tested.
- The toast component reads a theme from `next-themes`, but no theme provider
  is mounted. It falls back to the system theme.
- `pnpm build` copies `.env` into `dist/server/.dev.vars`. `dist/` is
  git-ignored; do not share it.
- The `DB` binding is typed loosely (`any`); see AGENTS.md "Database decision".
- Two people saving the same item at the same instant: the second save is
  retried up to three times, then fails with "changed by someone else".

## Later

- Auto-publishing to the networks.
- Analytics and AI-assisted copy.
- Password reset and email verification.
- Sign-in rate limiting.

## How the work is run

- Work directly in this checkout. Do not create separate worktrees.
- One orchestrating agent plans and reviews; sub-agents write the code.
  Models chosen by the owner: Opus 5.5 Medium for foundation work, Fable 5.2
  Low for feature work.
- If two agents work in this folder at the same time, keep them to the files
  listed for their step. `src/routeTree.gen.ts` is generated, and `AGENTS.md`
  is shared.
