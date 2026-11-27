import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import {
  ArrowRight,
  Download,
  Globe,
  Moon,
  Sun,
} from 'lucide-react'
import { z } from 'zod'
import heroMp4 from '@/assets/brand/auth-hero.mp4'
import heroWebm from '@/assets/brand/auth-hero.webm'
import heroPoster from '@/assets/brand/auth-hero.webp'
import catYarnAlpha from '@/assets/brand/cat-yarn-alpha.mp4'
import catYarnStill from '@/assets/brand/cat-yarn-still.webp'
import landingCraftArt from '@/assets/brand/landing-craft.webp'
import landingHeroMp4 from '@/assets/brand/landing-hero.mp4'
import landingHeroWebm from '@/assets/brand/landing-hero.webm'
import landingHeroPoster from '@/assets/brand/landing-hero.webp'
import { AlphaLoop, ClayLoop, ZORA_SLOGAN, ZoraLogo } from '@/components/brand'
import {
  LandingConnectYourAi,
  LandingEditorialDeck,
  LandingStudioStage,
} from '@/components/landing/landing-showcase'
import { Button } from '@/components/ui/button'
import { ZORA_DESKTOP_DOWNLOAD_URL } from '@/lib/desktop-bridge'
import { setTheme, useTheme } from '@/lib/theme'

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

  function toggleTheme() {
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <div className="bg-background text-foreground min-h-svh overflow-x-clip">
      {/* Quiet Sticky Navigation (Affinity style) */}
      <header className="bg-background/85 sticky top-0 z-40 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-10">
          <Link to="/" search={{ home: true }} className="text-[1.5rem]">
            <ZoraLogo aria-label="Zora" />
          </Link>

          <nav aria-label="Navegação principal" className="hidden items-center gap-7 text-sm md:flex">
            <a
              href="#produto"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Estúdio
            </a>
            <a
              href="#agentes"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Sua IA
            </a>
            <a
              href="#recursos"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Recursos
            </a>
            <a
              href="#desktop"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Desktop
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
                  Abrir o Zora
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

        {/* BAND 5 — Affinity Horizontal Scrolling Editorial Deck (01 / 02 / 03 / 04) */}
        <LandingEditorialDeck />

        {/* BAND 6 — Contrasting Full-Bleed Warm Bone Chapter (Clay Diorama + Web/Desktop Platforms) */}
        <section
          id="desktop"
          aria-labelledby="platforms-heading"
          className="bg-[#efe9de] text-[#0e1318]"
        >
          <div className="mx-auto max-w-6xl px-6 py-24 sm:px-10 md:py-32">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center">
              {/* The signature Claymation Diorama breathing on warm bone */}
              <div className="mx-auto w-full max-w-md lg:max-w-none">
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[2rem] bg-[#a8d8e8] shadow-2xl shadow-black/15">
                  <ClayLoop
                    webm={heroWebm}
                    mp4={heroMp4}
                    poster={heroPoster}
                    className="absolute inset-0 size-full object-[50%_58%]"
                  />
                </div>
              </div>

              {/* Clean 3-part platform story (no uppercase eyebrow, no pill badges) */}
              <div className="space-y-8">
                <div>
                  <h2
                    id="platforms-heading"
                    className="font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.03] font-semibold tracking-[-0.03em]"
                  >
                    Comece no navegador. Edite nativo quando quiser.
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-[#0e1318]/75 sm:text-base">
                    Tudo de planejamento, publicação, analytics e conexão com Claude, ChatGPT ou
                    Gemini roda direto na web em qualquer sistema. O Zora Desktop é o extra opcional
                    para quem quer os editores nativos de design e foto.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="flex items-start gap-4 rounded-2xl bg-white p-5 shadow-xs">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#a7f175] text-[#0e1318]">
                      <Globe className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h3 className="font-display text-xl font-semibold">Zora na Web</h3>
                        <span className="text-xs text-[#0e1318]/55">Mac · Windows · Celular</span>
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed text-[#0e1318]/70">
                        Calendário, pipeline, publicação direta nas redes, Analytics e conexão com
                        Claude, ChatGPT ou Gemini em poucos cliques.
                      </p>
                    </div>
                  </div>

                  {/* Tactile claymation showcase for Zora Studio + Zora LightCraft */}
                  <div className="overflow-hidden rounded-[1.5rem] bg-white shadow-xs">
                    <img
                      src={landingCraftArt}
                      alt=""
                      aria-hidden="true"
                      width={960}
                      height={720}
                      draggable={false}
                      className="aspect-[16/9] w-full object-cover object-center select-none"
                    />
                    <div className="grid divide-y divide-[#0e1318]/8 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                      <div className="p-5">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-display text-xl font-semibold">Zora Studio</h3>
                          <span className="text-[11px] text-[#0e1318]/55">Windows</span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-[#0e1318]/70">
                          Design vetorial nativo para carrosséis, capas e criativos, com versões
                          sincronizadas no post.
                        </p>
                      </div>
                      <div className="p-5">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="font-display text-xl font-semibold">Zora LightCraft</h3>
                          <span className="text-[11px] text-[#0e1318]/55">Windows</span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed text-[#0e1318]/70">
                          Revelação não-destrutiva de fotos RAW e JPG enviada em 1 clique para a
                          mídia do conteúdo.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button
                    asChild
                    className="h-11 rounded-full bg-[#0e1318] px-6 text-sm font-semibold text-white hover:bg-[#0e1318]/90"
                  >
                    <a href={ZORA_DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer">
                      <Download data-icon="inline-start" />
                      Baixar Zora Desktop (Windows)
                    </a>
                  </Button>
                  <Link
                    to={user ? '/calendar' : '/sign-up'}
                    className="px-3 py-2 text-sm font-semibold text-[#0e1318] underline underline-offset-4 hover:opacity-75"
                  >
                    Ou começar direto na web
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

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
