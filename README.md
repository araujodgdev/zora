# Zora

Internal web app for planning and running our product launch. The first
feature is a social media content calendar.

Stack: TanStack Start (React) on Cloudflare Workers, Cloudflare D1 (SQLite) with
Drizzle, R2 for media, Better Auth, Tailwind CSS and shadcn/ui. See [AGENTS.md](./AGENTS.md) for the
architecture and conventions.

## Prerequisites

- Node.js 22 or newer
- pnpm 12 (`corepack enable` picks up the version in `package.json`)

You do not need a Cloudflare account or Docker for local development: the
database (D1) and the media bucket (R2) are simulated under `.wrangler/state`.

## First-time setup

```sh
pnpm install
pnpm env:setup      # creates .env from .env.example with a generated auth secret
```

Open `.env` and set `ALLOWED_SIGNUP_EMAILS` to the comma-separated emails of
the people who may create an account (matching ignores case). Nobody else can
sign up.

```sh
pnpm db:migrate     # applies the migrations in ./drizzle to the local D1 database
pnpm dev            # http://localhost:3000
```

Open http://localhost:3000, choose **Create an account**, and sign up with an
allowlisted email.

Local data lives in `.wrangler/state` (git-ignored); delete that folder to start
from an empty database, then run `pnpm db:migrate` again.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server. Server code runs in `workerd`, like production. |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serves the production build locally in `workerd` |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest. Database tests run on an in-memory D1 database. |
| `pnpm db:generate` | Create a migration after changing `src/db/*-schema.ts` |
| `pnpm db:migrate` | Apply pending migrations to the local D1 database |
| `pnpm db:migrate:remote` | Apply pending migrations to the production D1 database |
| `pnpm auth:generate` | Regenerate the Better Auth tables after changing auth config |
| `pnpm deploy:check` | Build and run `wrangler deploy --dry-run` |

## Environment variables

All live in `.env` locally (git-ignored; `.env.example` documents them).

| Name | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Auth secret, at least 32 random characters |
| `BETTER_AUTH_URL` | Public base URL of the app |
| `ALLOWED_SIGNUP_EMAILS` | Comma-separated emails allowed to sign up |

## Deploying

Production is one Cloudflare Worker with a D1 database (`DB`) and an R2 bucket
(`MEDIA`). First deploy:

1. `pnpm exec wrangler login` (and `pnpm exec wrangler whoami` to check the
   account).
2. Create the database: `pnpm exec wrangler d1 create zora`. Paste the printed
   `database_id` into the `DB` entry of `wrangler.jsonc` and commit it.
3. Create the bucket: `pnpm exec wrangler r2 bucket create zora-media` (R2 must
   be enabled on the account).
4. Apply the migrations: `pnpm db:migrate:remote`.
5. Set the secret: `pnpm exec wrangler secret put BETTER_AUTH_SECRET` (a new
   value, not your local one).
6. Set `BETTER_AUTH_URL` (the exact public URL, e.g.
   `https://zora.<subdomain>.workers.dev`) and `ALLOWED_SIGNUP_EMAILS` as
   variables in the Cloudflare dashboard, or under `vars` in `wrangler.jsonc`.
7. `pnpm build && pnpm exec wrangler deploy`. (`pnpm deploy` is a pnpm
   built-in, not this project's script.)

Later deploys: `pnpm db:migrate:remote` when there are new migrations, then
step 7. See AGENTS.md for production caveats (Workers CPU limits).
