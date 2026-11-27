import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import landingAiMp4 from '@/assets/brand/landing-ai.mp4'
import landingAiWebm from '@/assets/brand/landing-ai.webm'
import landingAiPoster from '@/assets/brand/landing-ai.webp'
import landingAnalyticsArt from '@/assets/brand/landing-analytics.webp'
import landingRocketArt from '@/assets/brand/landing-rocket.webp'
import landingTourMp4 from '@/assets/brand/landing-tour.mp4'
import landingTourWebm from '@/assets/brand/landing-tour.webm'
import landingTourPoster from '@/assets/brand/landing-tour.webp'
import { ClayLoop } from '@/components/brand'
import { CHANNEL_LABELS } from '@/lib/content'
import type { Channel } from '@/lib/content'
import { cn } from '@/lib/utils'

const TOUR_DURATION_SECONDS = 32

const CHANNEL_ACCENT: Record<Channel, string> = {
  instagram: 'bg-channel-instagram',
  tiktok: 'bg-channel-tiktok',
  youtube: 'bg-channel-youtube',
  linkedin: 'bg-channel-linkedin',
  x: 'bg-channel-x',
  blog: 'bg-channel-blog',
}

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
 * 100% stop-motion claymation product launch film (1080p, ~32s) with quiet
 * floating playback controls.
 */
export function LandingStudioStage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const userPausedRef = useRef(false)
  const userStartedRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(TOUR_DURATION_SECONDS)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let visible = false

    const sync = () => {
      if (visible && !reduce.matches && !userPausedRef.current) {
        video.play().catch(() => {})
      } else if (!visible && !userStartedRef.current) {
        video.pause()
      } else if (!visible) {
        video.pause()
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting)
        sync()
      },
      { threshold: 0.15 },
    )
    observer.observe(video)
    reduce.addEventListener('change', sync)

    return () => {
      observer.disconnect()
      reduce.removeEventListener('change', sync)
    }
  }, [])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      userPausedRef.current = false
      userStartedRef.current = true
      if (video.readyState === 0) {
        video.load()
      }
      video.play().catch(() => {})
    } else {
      userPausedRef.current = true
      video.pause()
    }
  }

  function toggleMute() {
    const video = videoRef.current
    if (!video) return
    const nextMuted = !muted
    video.muted = nextMuted
    setMuted(nextMuted)
    if (!nextMuted && video.paused) {
      userPausedRef.current = false
      userStartedRef.current = true
      video.play().catch(() => {})
    }
  }

  function restart() {
    const video = videoRef.current
    if (!video) return
    userPausedRef.current = false
    userStartedRef.current = true
    video.currentTime = 0
    video.play().catch(() => {})
  }

  const progressPct = Math.min(100, Math.max(0, (currentTime / Math.max(1, duration)) * 100))

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
            Conheça o Zora em 30 segundos
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-[#a8a39b] sm:text-base">
            Planejamento no calendário, publicação direta nas redes, analytics para criadores e sua
            IA favorita operando no mesmo estúdio.
          </p>
        </div>

        {/* 16:9 Cinema Launch Film Frame (zero numbering, clean controls) */}
        <div className="group relative mt-12 overflow-hidden rounded-[1.5rem] bg-[#efe9de] shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:rounded-[2rem]">
          <div className="relative aspect-video w-full">
            <video
              ref={videoRef}
              muted={muted}
              loop
              playsInline
              preload="auto"
              poster={landingTourPoster}
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={(e) => {
                if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
                  setDuration(e.currentTarget.duration)
                }
              }}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
              aria-label="Vídeo de apresentação do Zora"
              className="absolute inset-0 size-full cursor-pointer object-cover"
            >
              <source src={landingTourMp4} type="video/mp4" />
              <source src={landingTourWebm} type="video/webm" />
            </video>

            {/* Subtle floating cinema controls (bottom-right) */}
            <div className="pointer-events-auto absolute right-4 bottom-5 z-20 flex items-center gap-1.5 rounded-full bg-[#0e1318]/80 p-1.5 text-white shadow-xl ring-1 ring-white/15 backdrop-blur-md">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Pausar vídeo' : 'Reproduzir vídeo'}
                title={playing ? 'Pausar' : 'Reproduzir'}
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/15"
              >
                {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
              </button>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Ativar som' : 'Silenciar vídeo'}
                title={muted ? 'Ativar som' : 'Silenciar'}
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/15"
              >
                {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5 text-[#a7f175]" />}
              </button>
              <button
                type="button"
                onClick={restart}
                aria-label="Reiniciar vídeo"
                title="Reiniciar"
                className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-white/15"
              >
                <RotateCcw className="size-3.5" />
              </button>
            </div>

            {/* Razor-thin progress bar along bottom edge */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-[3px] bg-black/20"
            >
              <div
                className="h-full bg-[#a7f175] transition-[width] duration-150 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
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
