import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { ZoraLogo } from '@/components/brand'
import { CopyField } from '@/components/copy-field'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { AGENT_IDS, EXAMPLE_PROMPTS, agentGuides, connectSearchSchema } from '@/lib/agent-connect'
import type { AgentId } from '@/lib/agent-connect'
import { getMcpServerUrl } from '@/lib/agent-connect.functions'

/**
 * `/connect`: how to connect Claude, ChatGPT, Claude Code or Codex to Zora's
 * MCP server. Public (linked from the sign-in pages and the sidebar); the
 * agent picked is `?agent=`, so a link can open a given guide.
 */
export const Route = createFileRoute('/connect')({
  validateSearch: connectSearchSchema,
  loader: () => getMcpServerUrl(),
  staleTime: Infinity,
  head: () => ({ meta: [{ title: 'Conectar agentes · Zora' }] }),
  component: ConnectPage,
})

function ConnectPage() {
  const serverUrl = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const guides = agentGuides(serverUrl)
  const agent: AgentId = search.agent ?? AGENT_IDS[0]
  const guide = guides.find((g) => g.id === agent) ?? guides[0]!
  const home = user ? '/calendar' : '/sign-in'

  return (
    <div className="min-h-svh">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10">
        <Link to={home} className="text-[1.5rem]">
          <ZoraLogo aria-label="Zora" />
        </Link>
        <Button variant="ghost" size="sm" asChild>
          <Link to={home}>
            <ArrowLeft data-icon="inline-start" />
            {user ? 'Voltar ao Zora' : 'Entrar'}
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-3xl px-6 pt-12 pb-20 sm:px-10 sm:pt-16">
        <h1 className="font-display text-[clamp(2.25rem,6vw,3.25rem)] leading-[1.05] tracking-tight">
          Conecte o Zora ao seu agente
        </h1>
        <p className="text-muted-foreground mt-4 max-w-[58ch] text-base sm:text-lg">
          Peça ao Claude, ao ChatGPT ou ao Codex para planejar, criar conteúdos e designs,
          reagendar e publicar nas suas redes — direto pela nuvem, sem precisar do app desktop.
        </p>

        <section aria-labelledby="server-url" className="mt-10">
          <h2 id="server-url" className="mb-2 text-sm font-medium">
            URL do servidor MCP
          </h2>
          <CopyField value={serverUrl} label="URL do servidor" />
        </section>

        <section aria-labelledby="agent-guide" className="mt-10">
          <h2 id="agent-guide" className="sr-only">
            Como conectar
          </h2>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={1.5}
            value={agent}
            aria-label="Agente"
            onValueChange={(value) => {
              if (value) void navigate({ search: { agent: value as AgentId }, replace: true })
            }}
            // 2×2 on phones (four names do not fit one row), one row from `sm`.
            // `!` because the primitive sets `flex w-fit`.
            className="grid! w-full! grid-cols-2 sm:grid-cols-4"
          >
            {guides.map((g) => (
              <ToggleGroupItem key={g.id} value={g.id} className="whitespace-nowrap">
                {g.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="bg-card mt-4 rounded-2xl p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="font-display text-2xl">{guide.name}</h3>
              <p className="text-muted-foreground text-sm">{guide.surface}</p>
            </div>

            {guide.command ? (
              <CopyField value={guide.command} label="comandos" className="mt-5" />
            ) : null}

            <ol className="mt-5 grid gap-3">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-[0.9375rem] leading-6">
                  <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            {guide.link ? (
              <Button asChild className="mt-6">
                <a href={guide.link.href} target="_blank" rel="noreferrer">
                  {guide.link.label}
                  <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            ) : null}

          </div>
        </section>

        <section aria-labelledby="try-it" className="mt-12">
          <h2 id="try-it" className="font-display text-2xl">
            Depois, é só pedir
          </h2>
          <ul className="mt-4 grid gap-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li key={prompt} className="bg-card rounded-xl px-4 py-3 text-[0.9375rem]">
                “{prompt}”
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
