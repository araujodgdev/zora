import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'

/**
 * Pathless layout for every signed-in page. Put protected pages in
 * `src/routes/_app/`. The guard is route UX; server functions still check the
 * session themselves through `authMiddleware`.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (!context.user) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }
    return { user: context.user }
  },
  component: AppShell,
})
