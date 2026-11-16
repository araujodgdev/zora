import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  getRouteApi,
  useMatchRoute,
  useRouter,
} from '@tanstack/react-router'
import { CalendarDays, List, LogOut, SquareKanban } from 'lucide-react'
import { useState } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { authClient } from '@/lib/auth-client'

const appRoute = getRouteApi('/_app')

const navItems = [
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/pipeline', label: 'Pipeline', icon: SquareKanban },
  { to: '/content', label: 'Content', icon: List },
] as const

/**
 * Signed-in layout: a sidebar that collapses to icons (toggle with its button,
 * the rail, or Ctrl/Cmd+B), so pages get the full height. On small screens the
 * sidebar is a sheet opened from the button at the top left.
 */
export function AppShell() {
  const { sidebarOpen } = appRoute.useRouteContext()
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar />
      <SidebarInset>
        <SidebarTrigger className="m-2 md:hidden" />
        <main className="w-full px-6 py-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

function AppSidebar() {
  const { user } = appRoute.useRouteContext()
  const router = useRouter()
  const matchRoute = useMatchRoute()
  // On small screens the sidebar is a sheet: close it once a page is chosen.
  const { setOpenMobile } = useSidebar()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await authClient.signOut()
      // Drop the previous user's cached data before anything else renders.
      queryClient.clear()
      await router.navigate({ to: '/sign-in' })
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center justify-between group-data-[collapsible=icon]:justify-center">
        <Link
          to="/calendar"
          className="px-2 font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
        >
          Zora
        </Link>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Main">
              {navItems.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={Boolean(matchRoute({ to, fuzzy: true }))}
                    tooltip={label}
                  >
                    <Link to={to} onClick={() => setOpenMobile(false)}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div
              className="text-muted-foreground truncate px-2 text-xs group-data-[collapsible=icon]:hidden"
              title={user.email}
            >
              {user.name}
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign out"
              onClick={() => void signOut()}
              disabled={signingOut}
            >
              <LogOut />
              <span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
/** Standard page heading for pages inside the app shell. */
export function PageHeader({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      ) : null}
    </div>
  )
}
