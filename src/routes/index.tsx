import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowRight, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { z } from 'zod'
import catYarnAlpha from '@/assets/brand/cat-yarn-alpha.mp4'
import catYarnStill from '@/assets/brand/cat-yarn-still.webp'
import landingHeroMp4 from '@/assets/brand/landing-hero.mp4'
import landingHeroWebm from '@/assets/brand/landing-hero.webm'
import landingHeroPoster from '@/assets/brand/landing-hero.webp'
import { AlphaLoop, ClayLoop, ZORA_SLOGAN, ZoraLogo } from '@/components/brand'
import {
  LandingConnectYourAi,
  LandingEditorialDeck,
  LandingPricing,
  LandingStudioStage,
} from '@/components/landing/landing-showcase'
import { Button } from '@/components/ui/button'
import { ZORA_DESKTOP_DOWNLOAD_URL } from '@/lib/desktop-bridge'
import { setTheme, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

const landingSearchSchema = z.object({
  home: z.boolean().optional(),
})

const MARQUEE_ITEMS = [
  'INSTAGRAM',
  'TIKTOK',
  'YOUTUBE',
  'LINKEDIN',
  'X',
  'BLOG',
  'CLAUDE · CHATGPT · GEMINI',
  'ZORA STUDIO',
  'LIGHTCRAFT',
  'AGENDAMENTO AUTOMÁTICO',
] as const

export const Route = createFileRoute('/')({
  validateSearch: landingSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.user && !search.home) {
      throw redirect({ to: '/calendar' })
    }
  },
  head: () => ({
    meta: [
      { title: `Zora · ${ZORA_SLOGAN}` },
      {
        name: 'description',
        content:
          'Planeje no calendário, publique direto nas redes, acompanhe analytics feito para criadores e conecte Claude, ChatGPT ou Gemini ao seu estúdio.',
      },
      { property: 'og:title', content: `Zora · ${ZORA_SLOGAN}` },
      {
        property: 'og:description',
        content:
          'Calendário editorial, publicação automática, analytics visual para criadores e sua IA favorita conectada no mesmo estúdio.',
      },
      { property: 'og:image', content: '/icons/icon-512.png' },
    ],
  }),
  component: LandingPage,
})

function LandingPage() {
  const { user, theme: initialTheme } = Route.useRouteContext()
  const theme = useTheme(initialTheme)
  const isDark = theme === 'dark'
  const headerRef = useRef<HTMLElement>(null)

  const headerOverDark = useHeaderOverDarkSection(headerRef)

  function toggleTheme() {
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <div className="bg-background text-foreground min-h-svh overflow-x-clip">
      {/* Quiet Sticky Navigation (Affinity style) */}
      <header
        ref={headerRef}
        className={cn(
          'bg-background/85 text-foreground sticky top-0 z-40 backdrop-blur-md transition-colors duration-300',
          headerOverDark && 'dark',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10">
          <Link to="/" search={{ home: true }} className="text-[1.5rem]">
            <ZoraLogo aria-label="Zora" />
          </Link>

          <nav aria-label="Navegação principal" className="hidden items-center gap-7 text-sm md:flex">
            <a
              href="#produto"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Conheça
            </a>
            <a
              href="#agentes"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              MCP
            </a>
            <a
              href="#recursos"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Recursos
            </a>
            <a
              href="#precos"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Preços
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggleTheme}
              aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
              title={isDark ? 'Tema claro' : 'Tema escuro'}
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>

            {user ? (
              <Button asChild size="sm" className="rounded-full px-4">
                <Link to="/calendar">
                  Acessar
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden rounded-full sm:inline-flex">
                  <Link to="/sign-in">Entrar</Link>
                </Button>
                <Button asChild size="sm" className="rounded-full px-4">
                  <Link to="/sign-up">Começar grátis</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* BAND 1 — Living Outdoor Claymation Hero Stage ("Criação sem ruído.") */}
        <section className="mx-auto max-w-[1220px] px-4 pt-3 pb-12 sm:px-8 sm:pt-5 sm:pb-16">
          <h1 className="sr-only">Criação sem ruído.</h1>

          <div className="relative aspect-video w-full overflow-hidden rounded-[1.5rem] bg-[#b8dfec] shadow-2xl shadow-black/25 sm:rounded-[2.25rem]">
            <ClayLoop
              webm={landingHeroWebm}
              mp4={landingHeroMp4}
              poster={landingHeroPoster}
              className="absolute inset-0 size-full"
            />
          </div>

          <p className="text-muted-foreground mx-auto mt-7 max-w-[56ch] text-center text-base leading-relaxed sm:mt-8 sm:text-lg">
            Calendário editorial, publicação automática, analytics para criadores e Claude, ChatGPT
            ou Gemini conectados ao seu estúdio.
          </p>
        </section>

        {/* BAND 2 — Full-Bleed Electric Lime Ticker Strip (Affinity & Later signature) */}
        <div
          aria-hidden="true"
          className="bg-lime overflow-hidden py-3.5 text-[#0e1318] select-none"
        >
          <div className="zora-marquee-track items-center gap-8 text-xs font-extrabold tracking-[0.14em] uppercase sm:text-sm">
            {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((label, idx) => (
              <span key={`${label}-${idx}`} className="inline-flex items-center gap-8">
                <span>{label}</span>
                <span className="size-1.5 rounded-full bg-[#0e1318]/45" />
              </span>
            ))}
          </div>
        </div>

        {/* BAND 3 — Affinity Full-Bleed Charcoal Studio Stage + Floating Bottom Dock */}
        <LandingStudioStage />

        {/* BAND 4 — Connect your favorite AI (Claude, ChatGPT, Gemini) */}
        <LandingConnectYourAi />

        {/* BAND 5 — Editorial deck: three cards */}
        <LandingEditorialDeck />

        {/* BAND 6 — Pricing on warm bone: free during launch, claymation price tag */}
        <LandingPricing signedIn={Boolean(user)} />

        {/* BAND 7 — Signature Electric Lime CTA Band with Animated Cutout Clay Cat */}
        <section className="mx-auto max-w-6xl px-6 py-16 sm:px-10 md:py-24">
          <div className="bg-lime relative overflow-hidden rounded-[2.25rem] px-7 py-12 text-[#0e1318] sm:px-12 sm:py-16">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center">
              <div>
                <h2 className="font-display text-[clamp(2.25rem,5.2vw,3.75rem)] leading-[1.01] font-semibold tracking-[-0.03em] text-balance">
                  Menos abas abertas. Mais conteúdo no ar.
                </h2>
                <p className="mt-4 max-w-[44ch] text-base leading-relaxed text-[#0e1318]/80 sm:text-lg">
                  Crie seu workspace em segundos e organize a semana inteira com calma.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {user ? (
                    <Button
                      asChild
                      size="lg"
                      className="h-12 rounded-full bg-[#0e1318] px-7 text-base font-semibold text-white hover:bg-[#0e1318]/90"
                    >
                      <Link to="/calendar">
                        Voltar ao meu workspace
                        <ArrowRight data-icon="inline-end" />
                      </Link>
                    </Button>
                  ) : (
                    <>
                      <Button
                        asChild
                        size="lg"
                        className="h-12 rounded-full bg-[#0e1318] px-7 text-base font-semibold text-white hover:bg-[#0e1318]/90"
                      >
                        <Link to="/sign-up">
                          Criar minha conta
                          <ArrowRight data-icon="inline-end" />
                        </Link>
                      </Button>
                      <Link
                        to="/sign-in"
                        className="rounded-full px-4 py-2.5 text-sm font-semibold text-[#0e1318] underline underline-offset-4 transition-opacity hover:opacity-75"
                      >
                        Já tenho conta
                      </Link>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-center lg:justify-end">
                <AlphaLoop
                  src={catYarnAlpha}
                  still={catYarnStill}
                  width={320}
                  height={242}
                  className="w-56 sm:w-64"
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* BAND 8 — Monumental Affinity / Later Edge-to-Edge Wordmark Footer */}
      <footer className="border-border/70 border-t pt-14">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-12 sm:grid-cols-2 sm:px-10 md:grid-cols-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide uppercase">Produto</p>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <a href="#produto" className="hover:text-foreground transition-colors">
                  Calendário & Pipeline
                </a>
              </li>
              <li>
                <a href="#produto" className="hover:text-foreground transition-colors">
                  Publicação direta
                </a>
              </li>
              <li>
                <a href="#produto" className="hover:text-foreground transition-colors">
                  Analytics para criadores
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide uppercase">IA & Desktop</p>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <Link to="/connect" className="hover:text-foreground transition-colors">
                  Conectar Claude, ChatGPT ou Gemini
                </Link>
              </li>
              <li>
                <a
                  href={ZORA_DESKTOP_DOWNLOAD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  Zora Desktop (Windows)
                </a>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide uppercase">Conta</p>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <Link to="/sign-in" className="hover:text-foreground transition-colors">
                  Entrar
                </Link>
              </li>
              <li>
                <Link to="/sign-up" className="hover:text-foreground transition-colors">
                  Criar conta grátis
                </Link>
              </li>
              <li>
                <Link to="/forgot-password" className="hover:text-foreground transition-colors">
                  Recuperar senha
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wide uppercase">Aparência</p>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="hover:text-foreground transition-colors"
                >
                  {isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
                </button>
              </li>
              <li className="text-xs opacity-75">{ZORA_SLOGAN}</li>
            </ul>
          </div>
        </div>

        {/* Monumental edge-to-edge brand wordmark (Affinity × Later signature!) */}
        <div
          aria-hidden="true"
          className="mx-auto max-w-7xl overflow-hidden px-4 pt-2 pb-4 text-center select-none"
        >
          <div className="relative inline-flex items-baseline justify-center">
            <span className="font-sans text-[clamp(6.5rem,27vw,22rem)] leading-[0.78] font-extrabold tracking-[-0.065em] text-foreground">
              zora
            </span>
          </div>
        </div>

        <div className="border-border/60 text-muted-foreground mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 border-t px-6 py-5 text-xs sm:px-10">
          <span>© {new Date().getFullYear()} Zora · lume.software</span>
          <span>Português (Brasil)</span>
        </div>
      </footer>
    </div>
  )
}

/**
 * True while the sticky header sits over a section marked
 * `data-header-theme="dark"`, so the header can switch to the dark tokens
 * there (in the light theme; in the dark theme it is dark anyway).
 */
function useHeaderOverDarkSection(headerRef: RefObject<HTMLElement | null>) {
  const [overDark, setOverDark] = useState(false)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const header = headerRef.current
      if (!header) return
      const probe = header.getBoundingClientRect().bottom / 2
      const sections = document.querySelectorAll<HTMLElement>('[data-header-theme="dark"]')
      let hit = false
      for (const section of sections) {
        const rect = section.getBoundingClientRect()
        if (rect.top <= probe && rect.bottom >= probe) {
          hit = true
          break
        }
      }
      setOverDark(hit)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [headerRef])

  return overDark
}
