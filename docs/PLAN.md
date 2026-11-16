# Zora implementation plan

Status as of 2026-11-16. Update this file as steps finish.

Zora is an internal app for a three-person team to plan and run a product
launch. The launch is planned for the week of 2026-11-23. The first feature is
a social media content calendar. `AGENTS.md` describes the architecture, the
commands and the contracts that the steps below build on; read it first.

## Decisions

| Topic | Decision |
| --- | --- |
| Stack | TanStack Start (React) with TanStack Router, Query and Form; Tailwind CSS + shadcn/ui |
| Docs rule | Whoever writes code grounds it in the current official docs (URLs in `AGENTS.md`) |
| Data | PostgreSQL through Drizzle ORM; local Docker Postgres in development, Neon in production |
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

- Project scaffold, scripts, lint, tests, Docker Compose database, first migration.
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

## Remaining

Steps 4 to 6 touch mostly separate files and can be done in any order. All
three use the contracts in `AGENTS.md`; none should need new dependencies.

### 4. Item editor

Files: `src/routes/_app/content/new.tsx`, `src/routes/_app/content/$itemId.tsx`.

- One form for create and edit, covering every field: title, body, channel,
  format, status, scheduled time, published time, published URL, notes, asset
  links, assignee.
- `/content/new` prefills `scheduledAt`, `status` and `channel` from the URL.
- After saving or cancelling, return to the page named by `from`.
- Delete an item, with confirmation.
- Show the server's rule errors next to the form (for example "A scheduled
  item needs a scheduled date and time").
- Remove the quick-create form from `/content` once the editor works.

### 5. Calendar

File: `src/routes/_app/calendar.tsx`.

- Month and week views, with navigation between periods.
- Items shown as compact `ContentItemCard`s at their scheduled time.
- Drag an item to another day to reschedule it (`useRescheduleContentItem`).
- Click an empty day to open `/content/new` with that date.
- The shared filter bar, with filter state in the URL.
- Days and weeks are computed in the browser's time zone, on the client only.

### 6. Pipeline board

File: `src/routes/_app/pipeline.tsx`.

- One column per status, in pipeline order, with `ContentItemCard` cards.
- Drag a card to another column to change its status
  (`useChangeContentItemStatus`).
- The shared filter bar, with filter state in the URL.
- Open question: dragging an unscheduled item to "Scheduled" is rejected by
  the server and rolls back with a toast. Decide whether the board should ask
  for a date instead.

### 7. Review

- An independent review of steps 4 to 6 together.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm deploy:check`.
- A manual pass in the browser over the whole flow: create an item, schedule
  it, move it on the calendar and the board, publish it.

## Before launch

- Commit and push. Nothing is committed yet: `main` is still at the bootstrap
  commit and all of the code is uncommitted local changes.
- Add the other two partners' emails to `ALLOWED_SIGNUP_EMAILS`.
- Create the Neon project and run the migrations against it.
- Set up the Cloudflare Worker and its secrets: `DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_SIGNUP_EMAILS`.
- Put Cloudflare Hyperdrive in front of Neon. Without it every request opens a
  new database connection.
- Password hashing: Better Auth hashes with scrypt in JavaScript, which will
  probably exceed the Workers Free plan's CPU limit. Use Workers Paid or
  configure a cheaper hash.
- Decide on Drizzle: the project uses `1.0.0-rc.5`. Moving to stable 0.45
  means a version change and regenerating the migration.

## Known gaps

- Touch dragging and dark mode have not been tested.
- The toast component reads a theme from `next-themes`, but no theme provider
  is mounted. It falls back to the system theme.
- `pnpm build` copies `.env` into `dist/server/.dev.vars`. `dist/` is
  git-ignored; do not share it.
- The local database holds test users and test items created by the agents.

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
