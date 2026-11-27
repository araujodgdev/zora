import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  AtSign,
  CalendarClock,
  Heart,
  Lightbulb,
  Moon,
  PenLine,
  Plus,
  Search,
  Send,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { CLAY_COLORS, ClayButton } from '@/components/clay/clay-button'
import { ClayInput } from '@/components/clay/clay-input'
import { ClaySwitch } from '@/components/clay/clay-switch'
import { ClayCheckbox } from '@/components/clay/clay-checkbox'
import { ClayTabs, ClayTabsContent, ClayTabsList, ClayTabsTrigger } from '@/components/clay/clay-tabs'
import { ClayCard, ClayCardFooter, ClayCardMedia, ClayCardText, ClayCardTitle } from '@/components/clay/clay-card'
import { ClayBadge } from '@/components/clay/clay-badge'
import { ClayProgress } from '@/components/clay/clay-progress'
import pricingPoster from '@/assets/brand/landing-pricing.webp'
import analyticsPoster from '@/assets/brand/landing-analytics.webp'

/**
 * `/ui`: the showcase of Zora Clay, the plasticine component library in
 * `@/components/clay`. Public and unlisted; each component gets a section
 * with its colours, sizes and states, on a light or a dark table.
 */
export const Route = createFileRoute('/ui')({
  head: () => ({
    meta: [{ title: 'Zora Clay · componentes' }, { name: 'robots', content: 'noindex' }],
  }),
  component: ClayShowcasePage,
})

const COLOR_LABELS: Record<(typeof CLAY_COLORS)[number], string> = {
  lime: 'Lima',
  cream: 'Creme',
  sky: 'Céu',
  pink: 'Chiclete',
  butter: 'Manteiga',
  coral: 'Coral',
  violet: 'Violeta',
  charcoal: 'Carvão',
}

function ClayShowcasePage() {
  const [surface, setSurface] = useState<'light' | 'dark'>('light')
  const dark = surface === 'dark'

  return (
    <div className="clay-table min-h-svh transition-colors duration-300" data-surface={surface}>
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-10">
        <Link to="/" className="font-sans text-[1.5rem] font-extrabold tracking-[-0.05em]">
          zora <span className="opacity-50">clay</span>
        </Link>
        <ClayButton
          color={dark ? 'butter' : 'charcoal'}
          size="icon"
          aria-label={dark ? 'Mesa clara' : 'Mesa escura'}
          onClick={() => setSurface(dark ? 'light' : 'dark')}
        >
          {dark ? <Sun /> : <Moon />}
        </ClayButton>
      </header>

      <main className="mx-auto max-w-5xl px-6 pt-12 pb-24 sm:px-10 sm:pt-16">
        <h1 className="font-display text-[clamp(2.5rem,7vw,4rem)] leading-[1.02] tracking-tight">
          Componentes de massinha
        </h1>
        <p className="mt-4 max-w-[52ch] text-base opacity-70 sm:text-lg">
          Uma biblioteca de UI moldada à mão, no estilo claymation do Zora. Um componente por vez.
        </p>

        <ShowcaseSection id="botao" title="Botão" path="@/components/clay/clay-button">
          <Demo label="Cores">
            {CLAY_COLORS.map((color) => (
              <ClayButton key={color} color={color}>
                {COLOR_LABELS[color]}
              </ClayButton>
            ))}
          </Demo>

          <Demo label="Tamanhos">
            <ClayButton size="sm">Pequeno</ClayButton>
            <ClayButton size="md">Médio</ClayButton>
            <ClayButton size="lg">Grande</ClayButton>
          </Demo>

          <Demo label="Com ícone">
            <ClayButton>
              <Plus />
              Novo post
            </ClayButton>
            <ClayButton color="cream">
              Continuar
              <ArrowRight />
            </ClayButton>
            <ClayButton color="violet">
              <Sparkles />
              Pedir à IA
            </ClayButton>
            <ClayButton color="coral">
              <Trash2 />
              Excluir
            </ClayButton>
          </Demo>

          <Demo label="Só ícone">
            <ClayButton size="icon" aria-label="Adicionar">
              <Plus />
            </ClayButton>
            <ClayButton size="icon" color="pink" aria-label="Curtir">
              <Heart />
            </ClayButton>
            <ClayButton size="icon" color="sky" aria-label="Gerar com IA">
              <Sparkles />
            </ClayButton>
            <ClayButton size="icon" color="charcoal" aria-label="Seguir">
              <ArrowRight />
            </ClayButton>
          </Demo>

          <Demo label="Estados">
            <ClayButton>Normal</ClayButton>
            <ClayButton data-pressed="">Pressionado</ClayButton>
            <ClayButton disabled>Desativado</ClayButton>
            <ClayButton color="cream" asChild>
              <a href="#botao">Como link</a>
            </ClayButton>
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="campo" title="Campo de texto" path="@/components/clay/clay-input">
          <Demo label="Básico">
            <div className="grid w-full max-w-md gap-2">
              <label htmlFor="ui-title" className="text-sm font-semibold">
                Título do post
              </label>
              <ClayInput id="ui-title" placeholder="Lançamento da coleção de verão" />
            </div>
          </Demo>

          <Demo label="Com ícone e botão">
            <div className="grid w-full max-w-md gap-6">
              <ClayInput aria-label="Buscar posts" type="search" placeholder="Buscar posts" icon={<Search />} />
              <ClayInput
                aria-label="E-mail"
                type="email"
                placeholder="voce@exemplo.com"
                icon={<AtSign />}
                trailing={
                  <ClayButton size="sm" className="-my-1 -mr-2">
                    Convidar
                  </ClayButton>
                }
              />
            </div>
          </Demo>

          <Demo label="Cores">
            <div className="grid w-full gap-6 sm:grid-cols-2">
              {(['cream', 'butter', 'sky', 'pink'] as const).map((color) => (
                <ClayInput key={color} color={color} aria-label={COLOR_LABELS[color]} placeholder={COLOR_LABELS[color]} />
              ))}
            </div>
          </Demo>

          <Demo label="Tamanhos">
            <div className="grid w-full max-w-md gap-6">
              <ClayInput size="sm" aria-label="Pequeno" placeholder="Pequeno" />
              <ClayInput size="md" aria-label="Médio" placeholder="Médio" />
              <ClayInput size="lg" aria-label="Grande" placeholder="Grande" />
            </div>
          </Demo>

          <Demo label="Estados">
            <div className="grid w-full items-start gap-6 sm:grid-cols-2">
              <ClayInput aria-label="Em foco" defaultValue="Em foco" data-focused="" />
              <div className="grid gap-2">
                <ClayInput
                  aria-label="Com erro"
                  defaultValue="post sem data"
                  aria-invalid
                  aria-describedby="ui-error"
                />
                <p id="ui-error" className="text-sm font-semibold text-[#c8303f] in-data-[surface=dark]:text-[#ff8f8f]">
                  Posts agendados precisam de uma data.
                </p>
              </div>
              <ClayInput aria-label="Desativado" placeholder="Desativado" disabled />
            </div>
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="interruptor" title="Interruptor" path="@/components/clay/clay-switch">
          <Demo label="Em uma lista de ajustes">
            <SwitchSettings />
          </Demo>

          <Demo label="Cores quando ligado">
            {(['lime', 'sky', 'pink', 'butter', 'violet'] as const).map((color) => (
              <ClaySwitch key={color} color={color} defaultChecked aria-label={COLOR_LABELS[color]} />
            ))}
          </Demo>

          <Demo label="Tamanhos">
            <ClaySwitch size="sm" defaultChecked aria-label="Pequeno" />
            <ClaySwitch size="md" defaultChecked aria-label="Médio" />
            <ClaySwitch size="lg" defaultChecked aria-label="Grande" />
          </Demo>

          <Demo label="Estados">
            <ClaySwitch aria-label="Desligado" />
            <ClaySwitch defaultChecked aria-label="Ligado" />
            <ClaySwitch disabled aria-label="Desativado e desligado" />
            <ClaySwitch disabled defaultChecked aria-label="Desativado e ligado" />
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="selecao" title="Caixa de seleção" path="@/components/clay/clay-checkbox">
          <Demo label="Checklist do post">
            <PostChecklist />
          </Demo>

          <Demo label="Cores">
            {(['lime', 'sky', 'pink', 'butter', 'violet', 'coral'] as const).map((color) => (
              <ClayCheckbox key={color} color={color} defaultChecked aria-label={COLOR_LABELS[color]} />
            ))}
          </Demo>

          <Demo label="Tamanhos">
            <ClayCheckbox size="sm" defaultChecked aria-label="Pequeno" />
            <ClayCheckbox size="md" defaultChecked aria-label="Médio" />
            <ClayCheckbox size="lg" defaultChecked aria-label="Grande" />
          </Demo>

          <Demo label="Estados">
            <ClayCheckbox aria-label="Desmarcada" />
            <ClayCheckbox defaultChecked aria-label="Marcada" />
            <ClayCheckbox indeterminate aria-label="Parcial" />
            <ClayCheckbox disabled aria-label="Desativada" />
            <ClayCheckbox disabled defaultChecked aria-label="Desativada e marcada" />
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="abas" title="Abas" path="@/components/clay/clay-tabs">
          <Demo label="Etapas do conteúdo">
            <ClayTabs defaultValue="ideas" className="w-full">
              <ClayTabsList aria-label="Etapas do conteúdo">
                {STAGES.map((stage) => (
                  <ClayTabsTrigger key={stage.value} value={stage.value}>
                    <stage.icon />
                    <span className="sr-only sm:not-sr-only">{stage.label}</span>
                  </ClayTabsTrigger>
                ))}
              </ClayTabsList>
              {STAGES.map((stage) => (
                <ClayTabsContent key={stage.value} value={stage.value} className="mt-5 max-w-md text-base opacity-75">
                  {stage.text}
                </ClayTabsContent>
              ))}
            </ClayTabs>
          </Demo>

          <Demo label="Cores">
            <div className="grid gap-6">
              {(['lime', 'sky', 'pink', 'violet', 'charcoal'] as const).map((color) => (
                <ClayTabs key={color} defaultValue="mes">
                  <ClayTabsList color={color} aria-label={`Período (${COLOR_LABELS[color]})`}>
                    <ClayTabsTrigger value="mes">Mês</ClayTabsTrigger>
                    <ClayTabsTrigger value="semana">Semana</ClayTabsTrigger>
                    <ClayTabsTrigger value="dia">Dia</ClayTabsTrigger>
                  </ClayTabsList>
                </ClayTabs>
              ))}
            </div>
          </Demo>

          <Demo label="Tamanhos">
            <div className="grid gap-6">
              {(['sm', 'md', 'lg'] as const).map((size) => (
                <ClayTabs key={size} defaultValue="a">
                  <ClayTabsList size={size} aria-label={`Tamanho ${size}`}>
                    <ClayTabsTrigger value="a">Lista</ClayTabsTrigger>
                    <ClayTabsTrigger value="b">Quadro</ClayTabsTrigger>
                    <ClayTabsTrigger value="c" disabled>
                      Linha do tempo
                    </ClayTabsTrigger>
                  </ClayTabsList>
                </ClayTabs>
              ))}
            </div>
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="cartao" title="Cartão" path="@/components/clay/clay-card">
          <Demo label="Post com imagem">
            <div className="grid w-full gap-8 sm:grid-cols-2">
              <ClayCard>
                <ClayCardMedia className="aspect-video">
                  <img src={pricingPoster} alt="Gato de massinha brincando com uma etiqueta de preço" />
                </ClayCardMedia>
                <ClayCardTitle>Bastidores da sessão de fotos</ClayCardTitle>
                <ClayCardText>Carrossel com 8 fotos do dia de gravação. Legenda pronta, falta escolher a capa.</ClayCardText>
                <ClayCardFooter>
                  <ClayButton size="sm">
                    <CalendarClock />
                    Agendar
                  </ClayButton>
                  <ClayButton size="sm" color="cream">
                    Editar
                  </ClayButton>
                </ClayCardFooter>
              </ClayCard>
              <ClayCard color="butter">
                <ClayCardMedia className="aspect-video">
                  <img src={analyticsPoster} alt="Gráficos de massinha" />
                </ClayCardMedia>
                <ClayCardTitle>Resumo da semana</ClayCardTitle>
                <ClayCardText>31 posts publicados, 4 mil salvamentos. O carrossel de verão puxou o resultado.</ClayCardText>
                <ClayCardFooter>
                  <ClayButton size="sm" color="charcoal">
                    Ver relatório
                    <ArrowRight />
                  </ClayButton>
                </ClayCardFooter>
              </ClayCard>
            </div>
          </Demo>

          <Demo label="Clicável e cores">
            <div className="grid w-full gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ['cream', 'Ideias', '12 esperando alguém pegar.'],
                  ['sky', 'Rascunhos', '5 em andamento.'],
                  ['pink', 'Agendados', '8 nesta semana.'],
                  ['charcoal', 'Publicados', '31 neste mês.'],
                ] as const
              ).map(([color, title, text]) => (
                <ClayCard key={color} color={color} interactive asChild>
                  <a href="#cartao">
                    <ClayCardTitle>{title}</ClayCardTitle>
                    <ClayCardText>{text}</ClayCardText>
                  </a>
                </ClayCard>
              ))}
            </div>
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="selo" title="Selo" path="@/components/clay/clay-badge">
          <Demo label="Status do conteúdo">
            <ClayBadge dot="charcoal">Ideia</ClayBadge>
            <ClayBadge dot="butter">Rascunho</ClayBadge>
            <ClayBadge dot="violet">Pronto</ClayBadge>
            <ClayBadge dot="sky">Agendado</ClayBadge>
            <ClayBadge dot="lime">Publicado</ClayBadge>
          </Demo>

          <Demo label="Cores">
            {CLAY_COLORS.map((color) => (
              <ClayBadge key={color} color={color}>
                {COLOR_LABELS[color]}
              </ClayBadge>
            ))}
          </Demo>

          <Demo label="Com ícone e contagem">
            <ClayBadge color="lime">
              <Sparkles />
              Feito com IA
            </ClayBadge>
            <ClayBadge color="pink">
              <Heart />
              4,2 mil
            </ClayBadge>
            <ClayBadge color="charcoal">
              <CalendarClock />
              Amanhã, 9h
            </ClayBadge>
            <ClayBadge color="coral">3 atrasados</ClayBadge>
          </Demo>

          <Demo label="Tamanhos">
            <ClayBadge size="sm" dot="lime">
              Pequeno
            </ClayBadge>
            <ClayBadge size="md" dot="lime">
              Médio
            </ClayBadge>
            <ClayBadge size="lg" dot="lime">
              Grande
            </ClayBadge>
          </Demo>

          <Demo label="Num cartão">
            <ClayCard className="w-full max-w-sm">
              <div className="flex flex-wrap gap-2">
                <ClayBadge size="sm" color="sky">
                  Instagram
                </ClayBadge>
                <ClayBadge size="sm" dot="sky">
                  Agendado
                </ClayBadge>
              </div>
              <ClayCardTitle>Carrossel de verão</ClayCardTitle>
              <ClayCardText>Sai amanhã às 9h, com 8 fotos e a legenda revisada.</ClayCardText>
            </ClayCard>
          </Demo>
        </ShowcaseSection>

        <ShowcaseSection id="progresso" title="Barra de progresso" path="@/components/clay/clay-progress">
          <Demo label="Enviando um vídeo">
            <UploadDemo />
          </Demo>

          <Demo label="Cores">
            <div className="grid w-full max-w-md gap-5">
              {(['lime', 'sky', 'pink', 'butter', 'violet'] as const).map((color, i) => (
                <ClayProgress key={color} color={color} value={30 + i * 15} aria-label={COLOR_LABELS[color]} />
              ))}
            </div>
          </Demo>

          <Demo label="Tamanhos">
            <div className="grid w-full max-w-md gap-5">
              <ClayProgress size="sm" value={40} aria-label="Pequeno" />
              <ClayProgress size="md" value={60} aria-label="Médio" />
              <ClayProgress size="lg" value={80} aria-label="Grande" />
            </div>
          </Demo>

          <Demo label="Sem previsão">
            <div className="grid w-full max-w-md gap-2">
              <p id="ui-syncing" className="text-sm font-semibold">
                Sincronizando métricas do Instagram…
              </p>
              <ClayProgress aria-labelledby="ui-syncing" />
            </div>
          </Demo>
        </ShowcaseSection>
      </main>
    </div>
  )
}

function UploadDemo() {
  const [value, setValue] = useState(35)
  const done = value >= 100
  return (
    <div className="grid w-full max-w-md gap-3">
      <div className="flex items-baseline justify-between text-sm font-semibold">
        <span id="ui-upload">corte-final.mp4</span>
        <span className="tabular-nums opacity-60">{done ? 'Enviado' : `${value}%`}</span>
      </div>
      <ClayProgress value={value} aria-labelledby="ui-upload" />
      <div className="mt-2 flex gap-3">
        <ClayButton size="sm" disabled={done} onClick={() => setValue((v) => Math.min(v + 20, 100))}>
          Avançar
        </ClayButton>
        <ClayButton size="sm" color="cream" onClick={() => setValue(0)}>
          Recomeçar
        </ClayButton>
      </div>
    </div>
  )
}

const STAGES = [
  { value: 'ideas', label: 'Ideias', icon: Lightbulb, text: '12 ideias esperando alguém pegar. A mais votada é o bastidor da sessão de fotos.' },
  { value: 'drafts', label: 'Rascunhos', icon: PenLine, text: '5 rascunhos em andamento, 2 com legenda pronta para revisão.' },
  { value: 'scheduled', label: 'Agendados', icon: CalendarClock, text: '8 posts agendados para esta semana, o próximo sai amanhã às 9h.' },
  { value: 'published', label: 'Publicados', icon: Send, text: '31 posts publicados neste mês. O carrossel de verão foi o mais salvo.' },
]

const CHECKLIST = ['Revisar a legenda', 'Escolher a capa', 'Marcar a marca parceira', 'Agendar no Instagram']

function PostChecklist() {
  const [done, setDone] = useState<string[]>(CHECKLIST.slice(0, 2))
  const all = done.length === CHECKLIST.length
  return (
    <div className="grid w-full max-w-md gap-4">
      <label className="flex cursor-pointer items-center gap-3 font-semibold">
        <ClayCheckbox
          checked={all}
          indeterminate={done.length > 0 && !all}
          onCheckedChange={() => setDone(all ? [] : CHECKLIST)}
        />
        Tudo pronto para publicar
      </label>
      <ul className="grid gap-3 pl-9">
        {CHECKLIST.map((task) => {
          const checked = done.includes(task)
          return (
            <li key={task}>
              <label className="flex cursor-pointer items-center gap-3">
                <ClayCheckbox
                  checked={checked}
                  onCheckedChange={(on) =>
                    setDone((prev) => (on ? [...prev, task] : prev.filter((t) => t !== task)))
                  }
                />
                <span className={checked ? 'line-through opacity-50' : undefined}>{task}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

const SETTINGS = [
  { id: 'auto', label: 'Publicar automaticamente', hint: 'Posts agendados saem na hora marcada.', on: true },
  { id: 'notify', label: 'Avisar a equipe', hint: 'Um e-mail quando um post muda de status.', on: false },
  { id: 'ai', label: 'Sugestões da IA', hint: 'Ideias de legenda no editor.', on: true },
]

function SwitchSettings() {
  const [values, setValues] = useState(() => Object.fromEntries(SETTINGS.map((s) => [s.id, s.on])))
  return (
    <ul className="grid w-full max-w-md gap-5">
      {SETTINGS.map((setting) => (
        <li key={setting.id}>
          <label className="flex cursor-pointer items-center justify-between gap-6">
            <span>
              <span className="block font-semibold">{setting.label}</span>
              <span className="block text-sm opacity-60">{setting.hint}</span>
            </span>
            <ClaySwitch
              checked={values[setting.id]}
              onCheckedChange={(on) => setValues((prev) => ({ ...prev, [setting.id]: on }))}
            />
          </label>
        </li>
      ))}
    </ul>
  )
}

function ShowcaseSection({
  id,
  title,
  path,
  children,
}: {
  id: string
  title: string
  path: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-16 scroll-mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id={`${id}-title`} className="font-display text-3xl tracking-tight">
          {title}
        </h2>
        <code className="text-xs opacity-55">{path}</code>
      </div>
      <div className="mt-6 grid gap-10">{children}</div>
    </section>
  )
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-4 text-xs font-semibold tracking-[0.12em] uppercase opacity-55">{label}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-6">{children}</div>
    </div>
  )
}
