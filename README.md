# Zora

Internal web app for planning and running our product launch. The first
feature is a social media content calendar.

Stack: TanStack Start (React) on Cloudflare Workers, PostgreSQL with Drizzle,
Better Auth, Tailwind CSS and shadcn/ui. See [AGENTS.md](./AGENTS.md) for the
architecture and conventions.

## Prerequisites

- Node.js 22 or newer
- pnpm 12 (`corepack enable` picks up the version in `package.json`)
- Docker (for the local Postgres database)

You do not need a Cloudflare or Neon account for local development.

## First-time setup

```sh
pnpm install
pnpm env:setup      # creates .env from .env.example with a generated auth secret
```

Open `.env` and set `ALLOWED_SIGNUP_EMAILS` to the comma-separated emails of
the people who may create an account (matching ignores case). Nobody else can
sign up.

```sh
pnpm db:up          # starts Postgres in Docker on localhost:5433
pnpm db:migrate     # applies the migrations in ./drizzle
pnpm dev            # http://localhost:3000
```

Open http://localhost:3000, choose **Create an account**, and sign up with an
allowlisted email.

The database runs on host port 5433 so it does not clash with a Postgres
installed on the default port. Data persists in the `zora-db` Docker volume;
`pnpm db:down` stops the container and keeps the data.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server. Server code runs in `workerd`, like production. |
| `pnpm build` | Production build into `dist/` |
| `pnpm preview` | Serves the production build locally in `workerd` |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest. Needs `pnpm db:up`; uses the `zora_test` database. |
| `pnpm db:up` / `pnpm db:down` | Start / stop the local database |
| `pnpm db:generate` | Create a migration after changing `src/db/*-schema.ts` |
| `pnpm db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `pnpm db:studio` | Drizzle Studio for browsing data |
| `pnpm auth:generate` | Regenerate the Better Auth tables after changing auth config |
| `pnpm deploy:check` | Build and run `wrangler deploy --dry-run` |

## Environment variables

All live in `.env` locally (git-ignored; `.env.example` documents them).

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `TEST_DATABASE_URL` | Database used by `pnpm test` (truncated by tests) |
| `BETTER_AUTH_SECRET` | Auth secret, at least 32 random characters |
| `BETTER_AUTH_URL` | Public base URL of the app |
| `ALLOWED_SIGNUP_EMAILS` | Comma-separated emails allowed to sign up |

## Deploying (not set up yet)

Production target is Cloudflare Workers with a Neon Postgres database. When
the accounts exist:

1. Create the Neon database and run `DATABASE_URL=<neon url> pnpm db:migrate`.
2. `pnpm exec wrangler login`.
3. Set secrets: `pnpm exec wrangler secret put DATABASE_URL` and
   `pnpm exec wrangler secret put BETTER_AUTH_SECRET` (use a new secret, not
   your local one).
4. Set `BETTER_AUTH_URL` and `ALLOWED_SIGNUP_EMAILS` as variables in the
   Cloudflare dashboard (or under `vars` in `wrangler.jsonc`).
5. `pnpm deploy`.

See AGENTS.md for production caveats (Hyperdrive, Workers CPU limits).
