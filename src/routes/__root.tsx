/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouter,
} from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { ClayFilters } from '@/components/clay/clay-filters'
import { TooltipProvider } from '@/components/ui/tooltip'
import { registerServiceWorker } from '@/lib/pwa'
import { loadQuery } from '@/lib/route-query'
import { sessionStateQueryOptions } from '@/lib/session.queries'
import { readTheme, useTheme } from '@/lib/theme'
import { UiModeProvider, readUiMode, useUiMode } from '@/lib/ui-mode'
import appCss from '@/styles/app.css?url'

export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every page depends on the session, so never cache HTML publicly.
  headers: () => ({ 'Cache-Control': 'private, no-store' }),
  // Route-level auth state for guards and the app shell. Data access is
  // protected separately by `authMiddleware` on each server function.
  // `workspace` is the one the user has open (null without any). It comes
  // from the Query cache after the first load: this runs before every
  // navigation, and a round trip here delayed every page change.
  // The theme and the look (classic or fun) come from cookies, so the
  // server renders the right ones.
  beforeLoad: async ({ context }) => ({
    ...(await loadQuery(context.queryClient, sessionStateQueryOptions())),
    theme: readTheme(),
    uiMode: readUiMode(),
  }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Zora' },
      // Installed app (PWA): `public/manifest.webmanifest`, icons from
      // `scripts/generate-icons.mjs`. The theme colour is in RootDocument.
      { name: 'application-name', content: 'Zora' },
      { name: 'apple-mobile-web-app-title', content: 'Zora' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/icons/icon-192.png', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  component: Outlet,
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
})

function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="font-display text-4xl font-semibold">Página não encontrada</h1>
      <Link to="/" className="text-sm underline underline-offset-4">
        Ir para o calendário
      </Link>
    </main>
  )
}

function RootError({ reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="font-display text-3xl font-semibold">Algo deu errado</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Não foi possível carregar esta página agora. Tente novamente ou volte para o início.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <Button
          type="button"
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          Tentar novamente
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Ir para o calendário</Link>
        </Button>
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  const initialUiMode = Route.useRouteContext({ select: (context) => context.uiMode })
  return (
    <UiModeProvider initial={initialUiMode}>
      <RootHtml>{children}</RootHtml>
    </UiModeProvider>
  )
}

/** The canvas colour per look and theme, for the browser and installed-app chrome. */
const THEME_COLORS = {
  classic: { dark: '#000000', light: '#f4f4f4' },
  fun: { dark: '#1b1a19', light: '#efe9de' },
} as const

function RootHtml({ children }: { children: ReactNode }) {
  const initialTheme = Route.useRouteContext({ select: (context) => context.theme })
  const theme = useTheme(initialTheme)
  const uiMode = useUiMode()
  useEffect(registerServiceWorker, [])
  return (
    <html lang="pt-BR" className={theme === 'dark' ? 'dark' : undefined} data-ui={uiMode}>
      <head>
        <HeadContent />
        {/* The browser and installed-app chrome follow the theme's canvas. */}
        <meta name="theme-color" content={THEME_COLORS[uiMode][theme]} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <ClayFilters />
        {/* The one toast container: call `toast()` from `sonner` anywhere. */}
        <Toaster theme={theme} />
        <Scripts />
      </body>
    </html>
  )
}
