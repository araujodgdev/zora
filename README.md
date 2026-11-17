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

## Connecting an AI agent (MCP)

Zora is an MCP server at `<app URL>/mcp` (production:
`https://zora.lume.software/mcp`). Add it as a custom connector in Claude
(Settings, Connectors) or with
`claude mcp add --transport http zora https://zora.lume.software/mcp` in
Claude Code. The client opens Zora's sign-in page, you approve it on the
consent page, and the agent then acts as you. There is no screen yet to
revoke an agent's access; see "Known gaps" in docs/PLAN.md.

In Chrome with WebMCP (origin trial, or `chrome://flags/#enable-webmcp-testing`),
an agent in the browser also gets tools for the open tab.

## Production

Live at https://zora.lume.software (a Custom Domain on the `lume.software`
zone; the `workers.dev` URL is turned off): one Cloudflare Worker (`zora`) with
the D1 database `zora` (binding `DB`) and the R2 bucket `zora-media` (binding
`MEDIA`), on the account set as `account_id` in `wrangler.jsonc`.

`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `ALLOWED_SIGNUP_EMAILS` are Worker
secrets (`pnpm exec wrangler secret list`). To change the allowlist:
`pnpm exec wrangler secret put ALLOWED_SIGNUP_EMAILS` (takes effect in a few
seconds, no deploy needed). If the app moves to another URL, update
`BETTER_AUTH_URL` the same way.

To deploy a new version:

1. `pnpm db:migrate:remote` when there are new migrations.
2. `pnpm build && pnpm exec wrangler deploy`. (`pnpm deploy` is a pnpm
   built-in, not this project's script.)

See AGENTS.md for production caveats (Workers CPU limits, D1 limits).
