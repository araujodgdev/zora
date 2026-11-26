import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Clock,
  FileText,
  Kanban,
  Link2,
  MessageSquare,
  Send,
} from 'lucide-react'
import { useRef, useState } from 'react'
import landingAiMp4 from '@/assets/brand/landing-ai.mp4'
import landingAiWebm from '@/assets/brand/landing-ai.webm'
import landingAiPoster from '@/assets/brand/landing-ai.webp'
import landingAnalyticsArt from '@/assets/brand/landing-analytics.webp'
import landingRocketArt from '@/assets/brand/landing-rocket.webp'
import { AnalyticsDonutChart } from '@/components/analytics/analytics-donut-chart'
import type { DonutSlice } from '@/components/analytics/analytics-donut-chart'
import { ClayLoop, ZoraLogo } from '@/components/brand'
import { ChannelIconTile } from '@/components/content/channel-badge'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import type { SocialChannel } from '@/lib/social'
import { cn } from '@/lib/utils'

type ShowcaseTab = 'calendar' | 'publish' | 'analytics' | 'ai'

const DOCK_TABS: ReadonlyArray<{
  id: ShowcaseTab
  label: string
  icon: typeof CalendarDays
}> = [
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
  { id: 'publish', label: 'Publicação', icon: Send },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'ai', label: 'Sua IA', icon: MessageSquare },
]

const CHANNEL_ACCENT: Record<Channel, string> = {
  instagram: 'bg-channel-instagram',
  tiktok: 'bg-channel-tiktok',
  youtube: 'bg-channel-youtube',
  linkedin: 'bg-channel-linkedin',
  x: 'bg-channel-x',
  blog: 'bg-channel-blog',
}

const SAMPLE_WEEK: ReadonlyArray<{
  day: string
  date: string
  today?: boolean
  items: ReadonlyArray<{
    id: string
    title: string
    channel: Channel
    time: string
    format: string
    caption: string
    swatch: string
  }>
}> = [
  {
    day: 'Seg',
    date: '23',
    items: [
      {
        id: 'c1',
        title: 'Bastidores do estúdio novo',
        channel: 'instagram',
        time: '11:00',
        format: 'Reel',
        caption: 'Mostrando como ficou a montagem da luz principal e o áudio do estúdio.',
        swatch: 'from-[#ff8ad8]/35 to-[#6b3fe0]/25',
      },
      {
        id: 'c1b',
        title: 'Resumo da semana em 5 linhas',
        channel: 'linkedin',
        time: '16:00',
        format: 'Post',
        caption: 'O que mudou na minha rotina desde que parei de improvisar post na hora.',
        swatch: 'from-[#5cc8ff]/30 to-[#0a66c2]/20',
      },
    ],
  },
  {
    day: 'Ter',
    date: '24',
    items: [
      {
        id: 'c2',
        title: '5 lentes que realmente uso',
        channel: 'tiktok',
        time: '18:30',
        format: 'Vídeo',
        caption: 'Sem patrocínio: as duas lentes que ficaram na mochila o ano inteiro.',
        swatch: 'from-[#3ef0e8]/30 to-[#0d9488]/20',
      },
      {
        id: 'c3',
        title: 'Thread: bastidores da semana',
        channel: 'x',
        time: '20:00',
        format: 'Thread',
        caption: 'Quatro aprendizados rápidos gravando conteúdo todo dia sem perder a mão.',
        swatch: 'from-white/15 to-white/5',
      },
    ],
  },
  {
    day: 'Qua',
    date: '25',
    today: true,
    items: [
      {
        id: 'c4',
        title: 'Como edito cor em 3 minutos',
        channel: 'youtube',
        time: '19:00',
        format: 'Short',
        caption: 'Meu ajuste base de contraste, pele e curva antes de exportar o vídeo.',
        swatch: 'from-[#ff6b6b]/35 to-[#f08a3e]/20',
      },
      {
        id: 'c4b',
        title: 'Enquete: próximo tema',
        channel: 'instagram',
        time: '21:00',
        format: 'Story',
        caption: 'Qual vídeo vocês querem ver na sexta? Luz barata ou roteiro rápido?',
        swatch: 'from-[#ff8ad8]/30 to-[#f5c04a]/20',
      },
    ],
  },
  {
    day: 'Qui',
    date: '26',
    items: [
      {
        id: 'c5',
        title: 'Checklist de iluminação barata',
        channel: 'instagram',
        time: '12:00',
        format: 'Carrossel',
        caption: '7 slides práticos para montar um setup limpo gastando pouco.',
        swatch: 'from-[#a7f175]/30 to-[#3ef0e8]/20',
      },
    ],
  },
  {
    day: 'Sex',
    date: '27',
    items: [
      {
        id: 'c6',
        title: 'O que aprendi postando todo dia',
        channel: 'youtube',
        time: '18:00',
        format: 'Vídeo',
        caption: 'Os números reais de 30 dias mantendo constância sem burnout.',
        swatch: 'from-[#ff6b6b]/30 to-[#a370fc]/20',
      },
    ],
  },
]

const DEMO_CHANNEL_SLICES: ReadonlyArray<DonutSlice> = [
  { id: 'instagram', label: 'Instagram', value: 18400, color: 'var(--channel-instagram)' },
  { id: 'tiktok', label: 'TikTok', value: 14200, color: 'var(--channel-tiktok)' },
  { id: 'youtube', label: 'YouTube', value: 9600, color: 'var(--channel-youtube)' },
  { id: 'x', label: 'X', value: 4800, color: 'var(--channel-x)' },
]

const PUBLISH_CHANNELS: ReadonlyArray<{
  channel: SocialChannel
  formats: string
  timing: string
}> = [
  { channel: 'instagram', formats: 'Reels, Carrossel, Post e Story', timing: 'Hoje · 19:00' },
  { channel: 'tiktok', formats: 'Vídeo direto ou rascunho no Inbox', timing: 'Amanhã · 18:30' },
  { channel: 'youtube', formats: 'Vídeos, Shorts e capa personalizada', timing: 'Qui · 18:00' },
  { channel: 'linkedin', formats: 'Texto, imagem, vídeo e PDF', timing: 'Sex · 09:30' },
  { channel: 'x', formats: 'Posts e threads separadas por ---', timing: 'No ar' },
]

type AiAssistantId = 'claude' | 'chatgpt' | 'gemini'

const AI_ASSISTANTS: ReadonlyArray<{
  id: AiAssistantId
  name: string
  prompt: string
  reply: string
  createdItems: ReadonlyArray<{
    title: string
    channel: Channel
    meta: string
  }>
}> = [
  {
    id: 'claude',
    name: 'Claude',
    prompt:
      'Olha quais posts o pessoal mais salvou no meu Instagram este mês e monta 3 roteiros de Reel para a semana que vem.',
    reply:
      'Seus tutoriais curtos lideram em salvamentos. Já criei 3 roteiros prontos para gravar e deixei no seu calendário.',
    createdItems: [
      {
        title: '3 ajustes de luz que mudam qualquer vídeo',
        channel: 'instagram',
        meta: 'Reel · Ter 18:00',
      },
      {
        title: 'Bastidores: como gravo sem câmera cara',
        channel: 'instagram',
        meta: 'Reel · Qui 12:00',
      },
      {
        title: 'Checklist antes de apertar publicar',
        channel: 'instagram',
        meta: 'Carrossel · Sáb 11:00',
      },
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    prompt:
      'Cria a legenda da minha thread de sexta, gera a capa do carrossel de quinta e deixa tudo agendado nos melhores horários.',
    reply:
      'Tudo pronto! A capa foi anexada ao carrossel de quinta e a thread já ficou programada para sexta às 18h.',
    createdItems: [
      {
        title: 'Checklist de iluminação barata',
        channel: 'instagram',
        meta: 'Carrossel + capa · Qui 12:00',
      },
      {
        title: 'O que funcionou publicando toda semana',
        channel: 'x',
        meta: 'Thread (5 posts) · Sex 18:00',
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    prompt:
      'Resume o que funcionou melhor no meu TikTok e no YouTube nos últimos 30 dias e sugere o próximo vídeo.',
    reply:
      'Seus vídeos curtos de bastidores tiveram o maior volume de compartilhamentos. Já deixei dois roteiros prontos na fila.',
    createdItems: [
      {
        title: 'Tour rápido do meu setup em 45 segundos',
        channel: 'youtube',
        meta: 'Short · Qua 19:00',
      },
      {
        title: 'Antes e depois da cor em 1 clique',
        channel: 'tiktok',
        meta: 'Vídeo · Sex 19:30',
      },
    ],
  },
]

/**
 * Affinity-inspired full-bleed dark studio showcase:
 * realistic Zora app frame (sidebar + interactive workspace canvas + floating bottom dock),
 * completely free of fake browser dots or pill badge clutter.
 */
export function LandingStudioStage() {
  const [activeTab, setActiveTab] = useState<ShowcaseTab>('calendar')
  const [selectedCardId, setSelectedCardId] = useState<string>('c4')
  const [selectedPublishChannel, setSelectedPublishChannel] = useState<SocialChannel>('instagram')

  const allItems = SAMPLE_WEEK.flatMap((d) => d.items)
  const selectedCard = allItems.find((i) => i.id === selectedCardId) ?? allItems[0]!

  return (
    <section
      id="produto"
      aria-labelledby="stage-heading"
      className="bg-[#111110] text-white dark:bg-[#111110]"
    >
      <div className="mx-auto max-w-6xl px-6 py-24 sm:px-10 md:py-32">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="stage-heading"
            className="font-display text-[clamp(2.25rem,5.5vw,4rem)] leading-[1.01] font-semibold tracking-[-0.03em] text-balance"
          >
            Chega de ficar trocando de aplicativo
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#a8a39b] sm:text-base">
            Planeje, publique, acompanhe seus resultados e trabalhe com a IA que você já usa sem
            sair do mesmo lugar.
          </p>
        </div>

        {/* Realistic Zora Studio App Frame (no fake browser chrome, no pill spam) */}
        <div className="relative mt-12 overflow-hidden rounded-[1.75rem] bg-[#0a0a0a] shadow-2xl shadow-black/50 ring-1 ring-white/10">
          <div className="grid min-h-[480px] md:grid-cols-[196px_minmax(0,1fr)]">
            {/* Real Zora Sidebar inside the mockup */}
            <aside className="hidden flex-col justify-between border-r border-white/8 bg-[#141414] p-4 md:flex">
              <div>
                <div className="px-2 pt-1 pb-5 text-lg text-white">
                  <ZoraLogo aria-hidden="true" />
                </div>
                <nav className="space-y-1 text-xs" aria-label="Prévia da barra lateral">
                  {[
                    { id: 'calendar' as const, label: 'Calendário', icon: CalendarDays },
                    { id: 'calendar' as const, label: 'Pipeline', icon: Kanban, secondary: true },
                    { id: 'publish' as const, label: 'Publicação', icon: Send },
                    { id: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
                    { id: 'ai' as const, label: 'Sua IA', icon: MessageSquare },
                  ].map((nav) => {
                    const Icon = nav.icon
                    const active = !nav.secondary && activeTab === nav.id
                    return (
                      <button
                        key={nav.label}
                        type="button"
                        onClick={() => setActiveTab(nav.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left font-medium transition-colors',
                          active
                            ? 'bg-white/6 text-[#a7f175]'
                            : 'text-[#a8a39b] hover:bg-white/4 hover:text-white',
                        )}
                      >
                        <Icon className="size-3.5 shrink-0" />
                        <span>{nav.label}</span>
                      </button>
                    )
                  })}
                </nav>
              </div>

              <div className="border-t border-white/8 pt-3 text-[11px] text-[#a8a39b]">
                <p className="font-medium text-white">Estúdio da Marina</p>
                <p className="mt-0.5">5 redes conectadas</p>
              </div>
            </aside>

            {/* Active Studio Workspace Canvas */}
            <div className="flex flex-col justify-between p-5 pb-20 sm:p-7 sm:pb-22">
              {activeTab === 'calendar' ? (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div>
                    <div className="mb-4 flex items-baseline justify-between">
                      <h3 className="font-display text-xl font-semibold text-white">
                        Novembro · Semana 4
                      </h3>
                      <span className="text-xs text-[#a8a39b]">8 conteúdos na semana</span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-5">
                      {SAMPLE_WEEK.map((col) => (
                        <div
                          key={col.day}
                          className={cn(
                            'flex min-h-[280px] flex-col gap-2 rounded-xl p-2.5',
                            col.today ? 'bg-[#191918] ring-1 ring-[#a7f175]/45' : 'bg-[#141414]',
                          )}
                        >
                          <div className="flex items-center justify-between px-0.5 text-xs">
                            <span className="text-[#a8a39b]">{col.day}</span>
                            <span
                              className={cn(
                                'font-semibold tabular-nums',
                                col.today ? 'text-[#a7f175]' : 'text-white/80',
                              )}
                            >
                              {col.date}
                            </span>
                          </div>

                          <div className="flex flex-col gap-2">
                            {col.items.map((entry) => {
                              const selected = selectedCard.id === entry.id
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  onClick={() => setSelectedCardId(entry.id)}
                                  className={cn(
                                    'group relative overflow-hidden rounded-lg bg-[#20201f] p-2.5 text-left transition-colors',
                                    selected
                                      ? 'ring-1 ring-[#a7f175]'
                                      : 'hover:bg-[#262524]',
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={cn(
                                      'absolute inset-y-0 left-0 w-1',
                                      CHANNEL_ACCENT[entry.channel],
                                    )}
                                  />
                                  <div className="pl-1.5">
                                    <div className="flex items-center justify-between text-[10px] text-[#a8a39b]">
                                      <span>{CHANNEL_LABELS[entry.channel]}</span>
                                      <span className="tabular-nums">{entry.time}</span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-white">
                                      {entry.title}
                                    </p>
                                    <p className="mt-1.5 text-[10px] text-[#a8a39b]">
                                      {entry.format}
                                    </p>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right quick inspector for the selected calendar card */}
                  <div className="flex flex-col justify-between rounded-xl bg-[#141414] p-4">
                    <div>
                      <div
                        className={cn(
                          'flex aspect-[4/3] w-full flex-col justify-between rounded-lg bg-gradient-to-br p-3',
                          selectedCard.swatch,
                        )}
                      >
                        <span className="text-[10px] font-semibold tracking-wide text-white/80 uppercase">
                          {selectedCard.format}
                        </span>
                        <p className="font-display text-base leading-tight font-semibold text-white">
                          {selectedCard.title}
                        </p>
                      </div>

                      <div className="mt-3.5 space-y-2 text-xs">
                        <div className="flex items-center justify-between text-[#a8a39b]">
                          <span>{CHANNEL_LABELS[selectedCard.channel]}</span>
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <Clock className="size-3" />
                            {selectedCard.time}
                          </span>
                        </div>
                        <p className="leading-relaxed text-white/80">{selectedCard.caption}</p>
                      </div>
                    </div>

                    <div className="mt-4 border-t border-white/8 pt-3 text-[11px] text-[#a8a39b]">
                      Arraste no calendário para mudar o dia ou o horário.
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'publish' ? (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
                  {/* Left: active post composer preview */}
                  <div className="space-y-4 rounded-xl bg-[#141414] p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <ChannelIconTile
                          channel={selectedPublishChannel}
                          className="size-8 rounded-lg"
                        />
                        <div>
                          <p className="text-sm font-semibold text-white">
                            {CHANNEL_LABELS[selectedPublishChannel]}
                          </p>
                          <p className="text-[11px] text-[#a8a39b]">
                            Conta conectada · publicação automática
                          </p>
                        </div>
                      </div>
                      <FileText className="size-4 text-[#a8a39b]" />
                    </div>

                    <div className="rounded-lg bg-[#0d0d0d] p-4">
                      <p className="font-display text-lg font-semibold text-white">
                        Checklist de iluminação barata
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-[#a8a39b]">
                        Três ajustes simples com janela + rebatedor caseiro que deixam qualquer
                        vídeo com cara de estúdio sem gastar uma fortuna.
                      </p>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="aspect-[4/5] rounded-md bg-gradient-to-br from-[#ff8ad8]/35 to-[#6b3fe0]/30 p-2 text-[10px] font-medium text-white/85">
                          Slide 01
                        </div>
                        <div className="aspect-[4/5] rounded-md bg-gradient-to-br from-[#a7f175]/30 to-[#3ef0e8]/25 p-2 text-[10px] font-medium text-white/85">
                          Slide 02
                        </div>
                        <div className="aspect-[4/5] rounded-md bg-gradient-to-br from-[#f5c04a]/30 to-[#ff6b6b]/25 p-2 text-[10px] font-medium text-white/85">
                          Slide 03
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-[#a8a39b]">Agendado para Qui · 12:00</span>
                      <span className="rounded-lg bg-[#a7f175] px-3.5 py-1.5 text-xs font-semibold text-[#0e1318]">
                        Publicar agora
                      </span>
                    </div>
                  </div>

                  {/* Right: clickable network list */}
                  <div className="space-y-2">
                    <p className="mb-3 text-xs text-[#a8a39b]">
                      Clique em uma rede para alternar a prévia
                    </p>
                    {PUBLISH_CHANNELS.map((row) => {
                      const active = selectedPublishChannel === row.channel
                      return (
                        <button
                          key={row.channel}
                          type="button"
                          onClick={() => setSelectedPublishChannel(row.channel)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors',
                            active
                              ? 'bg-[#20201f] ring-1 ring-[#a7f175]/60'
                              : 'bg-[#141414] hover:bg-[#1b1b1a]',
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <ChannelIconTile channel={row.channel} className="size-8 rounded-lg" />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white">
                                {CHANNEL_LABELS[row.channel]}
                              </p>
                              <p className="truncate text-xs text-[#a8a39b]">{row.formats}</p>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs text-[#a8a39b] tabular-nums">
                            {row.timing}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {activeTab === 'analytics' ? (
                <div className="space-y-5">
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Visualizações (30d)', value: '47 mil' },
                      { label: 'Interações', value: '3,8 mil' },
                      { label: 'Publicados', value: '18' },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-xl bg-[#141414] p-4">
                        <p className="text-[11px] text-[#a8a39b]">{stat.label}</p>
                        <p className="font-display mt-1.5 text-2xl font-semibold text-white sm:text-3xl">
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl bg-[#141414] p-5">
                      <p className="font-display text-lg font-semibold text-white">
                        Views por rede
                      </p>
                      <AnalyticsDonutChart
                        slices={DEMO_CHANNEL_SLICES}
                        totalLabel="views"
                        valueUnit="compact"
                        emptyMessage=""
                      />
                    </div>

                    <div className="flex flex-col justify-between rounded-xl bg-[#141414] p-5">
                      <div>
                        <p className="font-display text-lg font-semibold text-white">
                          Ritmo dos últimos 30 dias
                        </p>
                        <p className="mt-1 text-xs text-[#a8a39b]">
                          Seus posts recentes entram automaticamente assim que você conecta a rede.
                        </p>
                      </div>

                      <svg
                        viewBox="0 0 360 120"
                        className="mt-5 h-32 w-full overflow-visible"
                        aria-hidden="true"
                      >
                        <defs>
                          <linearGradient id="landing-area" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#a7f175" stopOpacity="0.35" />
                            <stop offset="100%" stopColor="#a7f175" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        <path
                          d="M 0 96 L 45 84 L 90 90 L 135 62 L 180 68 L 225 38 L 270 46 L 315 22 L 360 14 L 360 116 L 0 116 Z"
                          fill="url(#landing-area)"
                        />
                        <path
                          d="M 0 96 L 45 84 L 90 90 L 135 62 L 180 68 L 225 38 L 270 46 L 315 22 L 360 14"
                          fill="none"
                          stroke="#a7f175"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>

                      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-white/8 pt-3.5 text-xs">
                        <div>
                          <span className="text-[#a8a39b]">Envios por alcance</span>
                          <p className="font-display mt-0.5 text-xl font-semibold text-[#a7f175]">
                            2,4%
                          </p>
                        </div>
                        <div>
                          <span className="text-[#a8a39b]">Tempo médio (Reels)</span>
                          <p className="font-display mt-0.5 text-xl font-semibold text-white">
                            14,2 s
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'ai' ? (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
                  <div className="space-y-4">
                    <h3 className="font-display text-2xl leading-tight font-semibold text-white">
                      Converse com o Claude, ChatGPT ou Gemini direto no seu calendário.
                    </h3>
                    <p className="text-sm leading-relaxed text-[#a8a39b]">
                      Em vez de copiar roteiros de um chat e colar em cinco telas, você conecta sua
                      IA ao Zora uma vez. Ela lê seus resultados, cria rascunhos e agenda com você.
                    </p>
                    <Link
                      to="/connect"
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#a7f175] hover:underline"
                    >
                      <Link2 className="size-4" />
                      Ver como conectar em 1 minuto
                    </Link>
                  </div>

                  <div className="space-y-3 rounded-xl bg-[#141414] p-5">
                    <div className="rounded-xl bg-[#222120] px-4 py-3 text-sm text-white">
                      “Pega os posts que mais tiveram salvos este mês e cria 3 roteiros de Reel para
                      a semana que vem.”
                    </div>
                    <div className="space-y-2 pt-1">
                      {[
                        {
                          title: '3 ajustes de luz em 30 segundos',
                          channel: 'instagram' as const,
                          meta: 'Reel · Ter 18:00',
                        },
                        {
                          title: 'Como gravo bastidores com celular',
                          channel: 'instagram' as const,
                          meta: 'Reel · Qui 12:00',
                        },
                        {
                          title: 'Checklist antes de publicar',
                          channel: 'instagram' as const,
                          meta: 'Carrossel · Sáb 11:00',
                        },
                      ].map((row) => (
                        <div
                          key={row.title}
                          className="relative flex items-center justify-between gap-3 overflow-hidden rounded-lg bg-[#0d0d0d] py-2.5 pr-3.5 pl-4 text-xs"
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute inset-y-0 left-0 w-1',
                              CHANNEL_ACCENT[row.channel],
                            )}
                          />
                          <span className="truncate font-medium text-white">{row.title}</span>
                          <span className="shrink-0 text-[#a8a39b]">{row.meta}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Floating bottom dock (Affinity Studio signature) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
            <div
              role="tablist"
              aria-label="Módulos do Zora"
              className="pointer-events-auto inline-flex flex-wrap items-center justify-center gap-1 rounded-full bg-[#0e0e0d]/95 p-1.5 shadow-2xl ring-1 ring-white/15 backdrop-blur-md"
            >
              {DOCK_TABS.map((tab) => {
                const Icon = tab.icon
                const active = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-all sm:px-4',
                      active
                        ? 'bg-[#a7f175] font-semibold text-[#0e1318]'
                        : 'text-[#a8a39b] hover:text-white',
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Creator-friendly section focused on connecting the user's own favorite AI
 * (Claude, ChatGPT, Gemini) directly to Zora — clean typography, zero pill spam.
 */
export function LandingConnectYourAi() {
  const [activeId, setActiveId] = useState<AiAssistantId>('claude')
  const assistant =
    AI_ASSISTANTS.find((item) => item.id === activeId) ?? AI_ASSISTANTS[0]!

  return (
    <section
      id="agentes"
      aria-labelledby="ai-connect-heading"
      className="mx-auto max-w-6xl px-6 py-24 sm:px-10 md:py-32"
    >
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
        <div>
          <h2
            id="ai-connect-heading"
            className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.03] font-semibold tracking-[-0.03em] text-balance"
          >
            Já usa Claude, ChatGPT ou Gemini? Conecte no Zora.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-[46ch] text-sm leading-relaxed sm:text-base">
            Nada de ficar copiando roteiro de um chat e colando em cinco telas. Você liga sua IA ao
            seu estúdio e ela cria rascunhos, sugere pautas olhando seus resultados e agenda seus
            posts com você.
          </p>

          {/* Clean underline tabs (zero pill badges) */}
          <div
            className="border-border mt-8 flex items-center gap-6 border-b"
            role="tablist"
            aria-label="Escolher IA"
          >
            {AI_ASSISTANTS.map((item) => {
              const active = activeId === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveId(item.id)}
                  className={cn(
                    '-mb-px border-b-2 pb-3 text-sm font-semibold transition-colors',
                    active
                      ? 'border-lime text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.name}
                </button>
              )
            })}
          </div>

          {/* Prompt & reply for the selected AI */}
          <div className="mt-6 space-y-2.5">
            <p className="font-display text-xl leading-snug font-medium sm:text-2xl">
              “{assistant.prompt}”
            </p>
            <p className="text-muted-foreground text-sm leading-relaxed">{assistant.reply}</p>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-4">
            <Link
              to="/connect"
              className="text-brand inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
            >
              Conectar minha IA em 1 minuto
              <ArrowUpRight className="size-4" />
            </Link>
            <span className="text-muted-foreground text-xs">
              Funciona direto na web, sem instalar nada
            </span>
          </div>
        </div>

        {/* Right: Living stop-motion claymation loop + resulting calendar items */}
        <div className="space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-[1.75rem] bg-[#ebe4d6] shadow-2xl shadow-black/20">
            <ClayLoop
              webm={landingAiWebm}
              mp4={landingAiMp4}
              poster={landingAiPoster}
              className="absolute inset-0 size-full"
            />
          </div>

          <div className="bg-card rounded-[1.5rem] p-4 sm:p-5">
            <p className="text-muted-foreground mb-3 text-xs font-medium">
              Criado no seu calendário pelo{' '}
              <strong className="text-foreground">{assistant.name}</strong>
            </p>
            <div className="space-y-2">
              {assistant.createdItems.map((entry) => (
                <div
                  key={entry.title}
                  className="bg-background/75 relative flex items-center justify-between gap-3 overflow-hidden rounded-xl py-2.5 pr-4 pl-4"
                >
                  <span
                    aria-hidden="true"
                    className={cn('absolute inset-y-0 left-0 w-1', CHANNEL_ACCENT[entry.channel])}
                  />
                  <div className="min-w-0 pl-1">
                    <p className="truncate text-sm font-medium">{entry.title}</p>
                    <p className="text-muted-foreground text-xs">
                      {CHANNEL_LABELS[entry.channel]} · {entry.meta}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Affinity-inspired horizontal scrolling editorial deck ("O novo padrão" -> "O novo ritmo")
 * with numbered 01-04 cards on alternating contrasting surfaces.
 */
export function LandingEditorialDeck() {
  const trackRef = useRef<HTMLDivElement>(null)

  function scrollByCard(direction: -1 | 1) {
    trackRef.current?.scrollBy({ left: direction * 390, behavior: 'smooth' })
  }

  return (
    <section id="recursos" aria-labelledby="deck-heading" className="py-20 md:py-28">
      <div className="mx-auto flex max-w-6xl items-end justify-between gap-4 px-6 sm:px-10">
        <div>
          <h2
            id="deck-heading"
            className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.03] font-semibold tracking-[-0.03em]"
          >
            O novo ritmo
          </h2>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            Pensado para o dia a dia real de quem cria conteúdo em várias redes.
          </p>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <button
            type="button"
            onClick={() => scrollByCard(-1)}
            aria-label="Card anterior"
            className="bg-card hover:bg-muted flex size-10 items-center justify-center rounded-full ring-1 ring-border transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByCard(1)}
            aria-label="Próximo card"
            className="bg-card hover:bg-muted flex size-10 items-center justify-center rounded-full ring-1 ring-border transition-colors"
          >
            <ArrowRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Horizontal snap-scrolling card rail */}
      <div
        ref={trackRef}
        className="mx-auto mt-10 flex max-w-6xl snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] sm:px-10 [&::-webkit-scrollbar]:hidden"
      >
        {/* 01 — Deep charcoal card with bespoke claymation analytics sculpture */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[2rem] bg-[#1e1e1f] text-white ring-1 ring-white/10">
          <div className="p-7 pb-3">
            <span className="font-mono text-xs text-[#a8a39b]">01</span>
            <h3 className="font-display mt-3 text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
              Conectou, já tem dados
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#a8a39b]">
              Ao ligar Instagram, TikTok ou YouTube, o Zora importa seus posts recentes na hora e
              monta seu Analytics sem você começar do zero.
            </p>
          </div>

          <div aria-hidden="true" className="relative mt-2 w-full overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-[#1e1e1f] to-transparent" />
            <img
              src={landingAnalyticsArt}
              alt=""
              width={640}
              height={640}
              draggable={false}
              className="aspect-[16/11] w-full object-cover object-[50%_72%] select-none"
            />
          </div>
        </article>

        {/* 02 — High-contrast Warm Bone card */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[2rem] bg-[#efe9de] p-7 text-[#0e1318]">
          <div>
            <span className="font-mono text-xs text-[#0e1318]/55">02</span>
            <h3 className="font-display mt-3 text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
              Equipe e IA no mesmo lugar
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#0e1318]/75">
              Convide editores, social media ou clientes por e-mail. Todo mundo — inclusive sua IA
              conectada — trabalha no mesmo calendário.
            </p>
          </div>

          <div aria-hidden="true" className="mt-8 space-y-2.5 rounded-2xl bg-white p-4 shadow-md">
            {[
              { name: 'Marina', role: 'Aprovou o Reel', color: 'bg-[#a7f175]' },
              { name: 'Lucas', role: 'Subiu corte final.mp4', color: 'bg-[#5cc8ff]' },
              { name: 'Claude', role: 'Agendou thread no X', color: 'bg-[#a370fc]' },
            ].map((row) => (
              <div key={row.name} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 font-semibold text-[#0e1318]">
                  <span className={`size-2.5 rounded-full ${row.color}`} />
                  {row.name}
                </span>
                <span className="text-[#0e1318]/60">{row.role}</span>
              </div>
            ))}
          </div>
        </article>

        {/* 03 — Deep midnight violet studio card with bespoke claymation rocket */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[2rem] bg-[#262139] text-white">
          <div className="p-7 pb-3">
            <span className="font-mono text-xs text-white/60">03</span>
            <h3 className="font-display mt-3 text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
              No ar na hora certa
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-white/75">
              Agende no calendário e esqueça. O Zora processa vídeos longos em segundo plano e avisa
              por e-mail se alguma conta precisar reconectar.
            </p>
          </div>

          <div aria-hidden="true" className="relative mt-2 w-full overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-[#262139] to-transparent" />
            <img
              src={landingRocketArt}
              alt=""
              width={640}
              height={640}
              draggable={false}
              className="aspect-[16/11] w-full object-cover object-center select-none"
            />
          </div>
        </article>

        {/* 04 — Electric Lime editorial card */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[2rem] bg-[#a7f175] p-7 text-[#0e1318]">
          <div>
            <span className="font-mono text-xs text-[#0e1318]/60">04</span>
            <h3 className="font-display mt-3 text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
              Sinais de criador, sem siglas
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#0e1318]/80">
              Cada rede mede sucesso diferente. Veja envios por alcance, salvos, tempo assistido e
              gráficos visuais que fazem sentido em 5 segundos.
            </p>
          </div>

          <div aria-hidden="true" className="mt-8 grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl bg-[#0e1318] p-3.5 text-white">
              <span className="text-[10px] text-white/65">Envios / alcance</span>
              <p className="font-display mt-1 text-2xl font-semibold text-[#a7f175]">2,4%</p>
            </div>
            <div className="rounded-2xl bg-white p-3.5 text-[#0e1318]">
              <span className="text-[10px] text-[#0e1318]/60">Tempo médio</span>
              <p className="font-display mt-1 text-2xl font-semibold">14,2 s</p>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}
