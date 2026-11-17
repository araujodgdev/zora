import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { readSidebarOpen } from '@/lib/sidebar-state'

/**
 * Pathless layout for every signed-in page. Put protected pages in
 * `src/routes/_app/`. The guard is route UX; server functions still check the
 * session and the workspace themselves through `authMiddleware`.
 *
 * Signed-in users without a workspace go to `/workspaces/new`.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, location }) => {
    if (!context.user) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: location.href },
      })
    }
    if (!context.workspace) throw redirect({ to: '/workspaces/new' })
    return {
      user: context.user,
      workspace: context.workspace,
      sidebarOpen: readSidebarOpen(),
    }
  },
  component: AppShell,
})
