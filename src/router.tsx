import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { CatLoader } from './components/zora-cat'
import { routeTree } from './routeTree.gen'

// Start creates a router per SSR request, so the QueryClient is created here,
// never at module scope (it would leak one user's data into another's HTML).
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000 } },
  })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Shown only when a navigation takes longer than `defaultPendingMs` (1s).
    defaultPendingComponent: () => <CatLoader className="min-h-[50svh]" />,
  })

  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
