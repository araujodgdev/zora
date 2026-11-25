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
pnpm db:migrate     # applies the migrations in ./drizzle to the local D1 database
pnpm dev            # http://localhost:3000
```

Open http://localhost:3000, choose **Criar conta**, sign up and create your
workspace. To add teammates to a workspace, invite them from its **Equipe**
page. Invitation emails are not sent locally: the dev server logs them (and
saves them under `.wrangler/tmp/email`).

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
| `UNSPLASH_ACCESS_KEY` | Optional. Unsplash access key for the MCP stock photo tools |
| `FAL_KEY` | Optional. fal API key for the MCP `generate_image` tool |
| `STUDIO_ENGINE_URL` | Optional. URL of a design engine run natively (development); wins over the container |

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
the D1 database `zora` (binding `DB`), the R2 bucket `zora-media` (binding
`MEDIA`) and Cloudflare Email Sending from `notify.lume.software` (binding
`EMAIL`, for invitations; needs the Workers Paid plan to reach any address),
on the account set as `account_id` in `wrangler.jsonc`.

`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are Worker secrets
(`pnpm exec wrangler secret list`). If the app moves to another URL, update
`BETTER_AUTH_URL` with `pnpm exec wrangler secret put BETTER_AUTH_URL` (takes
effect in a few seconds, no deploy needed).
The image tools' keys are optional secrets too:
`pnpm exec wrangler secret put UNSPLASH_ACCESS_KEY` and `... FAL_KEY`.

Deploys run on Cloudflare **Workers Builds**, connected to `main` of the
GitHub repository: every push to `main` builds and deploys. Settings (Workers
& Pages > `zora` > Settings > Builds):

- Build command: `pnpm build`
- Deploy command: `pnpm deploy:ci` (applies pending D1 migrations, then
  `wrangler deploy`; migrations always run before the new code goes live)
- API token: needs **D1 (edit)** besides the Workers permissions, because of
  the migrations. The token Workers Builds creates by default does not have it.

pnpm comes from the `packageManager` field (Corepack). To deploy by hand
instead, run `pnpm build && pnpm deploy:ci` from a machine logged in with
Wrangler. (`pnpm deploy` is a pnpm built-in, not this project's script.)

### Design engine (Cloudflare Container)

The MCP design tools (`edit_design`, `render_design` with a scale,
`inspect_design`, `list_design_commands`) run Zora Studio's engine
(`apps/zora-studio-server` in `../zora-vector`) in a Cloudflare Container.
It is **off** until these owner steps are done (the tools say "not
configured" meanwhile):

1. Upgrade to the Workers Paid plan (Containers need it).
2. Build the image (linux/amd64) from the Studio repo and push it to the
   Cloudflare registry, from this repo's folder (Wrangler is here):
   ```sh
   docker build --platform linux/amd64 -f ../zora-vector/apps/zora-studio-server/Dockerfile -t zora-studio-engine:<tag> ../zora-vector
   pnpm exec wrangler containers push zora-studio-engine:<tag>
   docker image inspect --format '{{join .RepoDigests "
"}}' registry.cloudflare.com/bf552f67bcf46921dbe4137ee0ff8980/zora-studio-engine:<tag>
   ```
   (Adjust the build context if the R3 Dockerfile expects another one.)
3. In `wrangler.jsonc`, uncomment the `containers` entry and put the
   `registry.cloudflare.com/...@sha256:<digest>` reference in
   `images.engine.image`. A digest (not a Dockerfile path) keeps Workers
   Builds working: it clones only this repo, so it could not build from
   `../zora-vector`.
4. Push to `main`. The first deploy provisions the container; it can take
   several minutes before the tools work. A new engine build = steps 2 to 4
   with a new tag and digest.

Locally the container never runs (`dev.enable_containers` is false;
Wrangler does not run containers on Windows): start the engine binary
yourself and set `STUDIO_ENGINE_URL` (e.g. `http://127.0.0.1:8080`) in `.env`.

See AGENTS.md for production caveats (Workers CPU limits, D1 limits).
