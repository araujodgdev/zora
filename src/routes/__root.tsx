/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { getSessionUser } from '@/lib/auth.functions'
import { readTheme, useTheme } from '@/lib/theme'
import appCss from '@/styles/app.css?url'

export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every page depends on the session, so never cache HTML publicly.
  headers: () => ({ 'Cache-Control': 'private, no-store' }),
  // Route-level auth state for guards and the app shell. Data access is
  // protected separately by `authMiddleware` on each server function.
  // The theme comes from a cookie, so the server renders the right one.
  beforeLoad: async () => ({
    user: await getSessionUser(),
    theme: readTheme(),
  }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: 'Zora' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: Outlet,
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <h1 className="font-display text-4xl font-semibold">Página não encontrada</h1>
      <Link to="/" className="text-sm underline underline-offset-4">
        Ir para o calendário
      </Link>
    </main>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  const initialTheme = Route.useRouteContext({ select: (context) => context.theme })
  const theme = useTheme(initialTheme)
  return (
    <html lang="pt-BR" className={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        {/* The one toast container: call `toast()` from `sonner` anywhere. */}
        <Toaster theme={theme} />
        <Scripts />
      </body>
    </html>
  )
}
