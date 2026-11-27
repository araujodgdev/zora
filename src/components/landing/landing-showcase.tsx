import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ArrowRight,
  Check,
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
import landingPricingMp4 from '@/assets/brand/landing-pricing.mp4'
import landingPricingWebm from '@/assets/brand/landing-pricing.webm'
import landingPricingPoster from '@/assets/brand/landing-pricing.webp'
import landingRocketArt from '@/assets/brand/landing-rocket.webp'
import landingTourMp4 from '@/assets/brand/landing-tour.mp4'
import landingTourWebm from '@/assets/brand/landing-tour.webm'
import landingTourPoster from '@/assets/brand/landing-tour.webp'
import { ClayLoop } from '@/components/brand'
import { Button } from '@/components/ui/button'

const TOUR_DURATION_SECONDS = 32

/**
 * 100% stop-motion claymation product launch film (1080p, ~32s) with quiet
 * floating playback controls.
 */
export function LandingStudioStage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const userPausedRef = useRef(false)
  const userStartedRef = useRef(false)
  // Once the film has played to the end it holds its last frame: scrolling
  // back into view must not start it again (only Play or Restart do).
  const endedRef = useRef(false)
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
      if (visible && !reduce.matches && !userPausedRef.current && !endedRef.current) {
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
      endedRef.current = false
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
    if (!nextMuted && video.paused && !endedRef.current) {
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
    endedRef.current = false
    video.currentTime = 0
    video.play().catch(() => {})
  }

  const progressPct = Math.min(100, Math.max(0, (currentTime / Math.max(1, duration)) * 100))

  return (
    <section
      id="produto"
      aria-labelledby="stage-heading"
      data-header-theme="dark"
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
              playsInline
              preload="auto"
              poster={landingTourPoster}
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => {
                endedRef.current = true
                setPlaying(false)
              }}
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
 * Connect the user's own AI (Claude, ChatGPT, Gemini) to Zora's MCP server:
 * title, a short subtitle, the clay loop and one button to /connect.
 */
export function LandingConnectYourAi() {
  return (
    <section
      id="agentes"
      aria-labelledby="ai-connect-heading"
      className="mx-auto max-w-6xl px-6 py-24 sm:px-10 md:py-32"
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12">
        <div>
          <h2
            id="ai-connect-heading"
            className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.03] font-semibold tracking-[-0.03em] text-balance"
          >
            Já usa Claude, ChatGPT ou Gemini? Conecte no Zora.
          </h2>
          <p className="text-muted-foreground mt-4 max-w-[46ch] text-base leading-relaxed sm:hidden">
            Sua IA cria rascunhos e agenda posts direto no seu calendário.
          </p>
          <p className="text-muted-foreground mt-4 hidden max-w-[46ch] text-base leading-relaxed sm:block">
            Nada de copiar roteiro de um chat e colar em cinco telas. Ligue sua IA ao Zora e ela
            cria rascunhos, sugere pautas olhando seus resultados e agenda seus posts com você.
          </p>

          <Button asChild size="lg" className="mt-8 h-11 rounded-full px-6">
            <Link to="/connect">
              Conectar MCP
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-[1.75rem] bg-[#ebe4d6] shadow-2xl shadow-black/20">
          <ClayLoop
            webm={landingAiWebm}
            mp4={landingAiMp4}
            poster={landingAiPoster}
            className="absolute inset-0 size-full"
          />
        </div>
      </div>
    </section>
  )
}

/**
 * "O novo ritmo": three editorial cards on contrasting surfaces, a snapping
 * rail on small screens and a three-column row from `lg`.
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

        <div className="hidden items-center gap-2 sm:flex lg:hidden">
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
        className="mx-auto mt-10 flex max-w-6xl snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] sm:px-10 lg:grid lg:grid-cols-3 lg:overflow-visible [&::-webkit-scrollbar]:hidden"
      >
        {/* Deep charcoal card with the clay analytics sculpture */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start lg:w-auto lg:max-w-none flex-col justify-between overflow-hidden rounded-[2rem] bg-[#1e1e1f] text-white ring-1 ring-white/10">
          <div className="p-7 pb-3">
            <h3 className="font-display text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
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

        {/* Warm bone card */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start lg:w-auto lg:max-w-none flex-col justify-between overflow-hidden rounded-[2rem] bg-[#efe9de] p-7 text-[#0e1318]">
          <div>
            <h3 className="font-display text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
              Equipe e IA no mesmo lugar
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#0e1318]/75">
              Convide editores, social media ou clientes por e-mail. Todo mundo, inclusive sua IA
              conectada, trabalha no mesmo calendário.
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

        {/* Midnight violet card with the clay rocket */}
        <article className="relative flex min-h-[460px] w-[84vw] max-w-[370px] shrink-0 snap-start lg:w-auto lg:max-w-none flex-col justify-between overflow-hidden rounded-[2rem] bg-[#262139] text-white">
          <div className="p-7 pb-3">
            <h3 className="font-display text-3xl leading-[1.08] font-semibold tracking-[-0.02em]">
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

      </div>
    </section>
  )
}

const LAUNCH_PLAN_FEATURES = [
  'Calendário editorial e pipeline',
  'Publicação direta no Instagram, TikTok, YouTube, LinkedIn e X',
  'Analytics feito para criadores',
  'Claude, ChatGPT ou Gemini conectados pelo MCP',
  'Workspace com sua equipe',
  'Zora Desktop com Studio e LightCraft',
] as const

/**
 * Pricing: everything is free during the launch. One plan card beside the
 * clay price tag loop, on the warm bone surface.
 */
export function LandingPricing({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="precos" aria-labelledby="pricing-heading" className="bg-[#efe9de] text-[#0e1318]">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:px-10 md:py-32">
        <div className="max-w-2xl">
          <h2
            id="pricing-heading"
            className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.03] font-semibold tracking-[-0.03em] text-balance"
          >
            Grátis por tempo limitado
          </h2>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-stretch">
          <div className="relative aspect-video w-full overflow-hidden rounded-[2rem] bg-[#e4dccd] shadow-2xl shadow-black/15 lg:aspect-auto lg:min-h-full">
            <ClayLoop
              webm={landingPricingWebm}
              mp4={landingPricingMp4}
              poster={landingPricingPoster}
              className="absolute inset-0 size-full"
            />
          </div>

          <div className="flex flex-col rounded-[2rem] bg-white p-7 shadow-xs sm:p-9">
            <h3 className="font-display text-2xl font-semibold">Lançamento</h3>
            <p className="mt-4 flex items-baseline gap-2">
              <span className="font-display text-6xl font-semibold tracking-[-0.03em]">R$ 0</span>
              <span className="text-sm text-[#0e1318]/60">por mês</span>
            </p>
            <p className="mt-2 text-sm text-[#0e1318]/65">Sem cartão de crédito.</p>

            <ul className="mt-7 space-y-3 text-sm">
              {LAUNCH_PLAN_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#a7f175]">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                  <span className="leading-relaxed">{feature}</span>
                </li>
              ))}
            </ul>

            <Button
              asChild
              size="lg"
              className="mt-8 h-12 rounded-full bg-[#0e1318] px-7 text-base font-semibold text-white hover:bg-[#0e1318]/90 lg:mt-auto"
            >
              <Link to={signedIn ? '/calendar' : '/sign-up'}>
                {signedIn ? 'Acessar meu workspace' : 'Criar minha conta grátis'}
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
