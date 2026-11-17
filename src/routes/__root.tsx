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
import appCss from '@/styles/app.css?url'

export type RouterContext = {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every page depends on the session, so never cache HTML publicly.
  headers: () => ({ 'Cache-Control': 'private, no-store' }),
  // Route-level auth state for guards and the app shell. Data access is
  // protected separately by `authMiddleware` on each server function.
  beforeLoad: async () => ({ user: await getSessionUser() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
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
      <h1 className="font-display text-4xl font-semibold">Page not found</h1>
      <Link to="/" className="text-sm underline underline-offset-4">
        Go to the calendar
      </Link>
    </main>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        {/* The one toast container: call `toast()` from `sonner` anywhere. */}
        <Toaster />
        <Scripts />
      </body>
    </html>
  )
}
