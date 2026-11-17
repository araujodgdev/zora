import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  getRouteApi,
  useMatchRoute,
  useRouter,
} from '@tanstack/react-router'
import { CalendarDays, List, LogOut, Moon, SquareKanban, Sun } from 'lucide-react'
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
import { WebMcpTools } from '@/components/webmcp-tools'
import { authClient } from '@/lib/auth-client'
import { setTheme, useTheme } from '@/lib/theme'

const appRoute = getRouteApi('/_app')

const navItems = [
  { to: '/calendar', label: 'Calendário', icon: CalendarDays },
  { to: '/pipeline', label: 'Pipeline', icon: SquareKanban },
  { to: '/content', label: 'Conteúdos', icon: List },
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
      <WebMcpTools />
      <AppSidebar />
      <SidebarInset>
        <SidebarTrigger className="m-2 md:hidden" />
        <main className="w-full px-6 py-8 md:px-10">
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
          className="font-display wonk px-2 text-2xl leading-none font-semibold tracking-tight italic group-data-[collapsible=icon]:hidden"
        >
          Zora
        </Link>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Principal">
              {navItems.map(({ to, label, icon: Icon }) => (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={Boolean(matchRoute({ to, fuzzy: true }))}
                    tooltip={label}
                    className="data-[active=true]:text-brand"
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
            <ThemeSwitcher />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sair"
              onClick={() => void signOut()}
              disabled={signingOut}
            >
              <LogOut />
              <span>{signingOut ? 'Saindo…' : 'Sair'}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

/** Switches between the dark and the light theme; the choice is remembered. */
function ThemeSwitcher() {
  const { theme: initialTheme } = appRoute.useRouteContext()
  const theme = useTheme(initialTheme)
  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'light' ? 'Tema claro' : 'Tema escuro'
  return (
    <SidebarMenuButton tooltip={label} onClick={() => setTheme(next)}>
      {next === 'light' ? <Sun /> : <Moon />}
      <span>{label}</span>
    </SidebarMenuButton>
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
    <div className="mb-8">
      <h1 className="font-display text-4xl leading-[1.05] font-semibold tracking-[-0.02em] md:text-5xl">
        {title}
      </h1>
      {description ? (
        <p className="text-muted-foreground mt-2 max-w-prose text-[0.9375rem]">
          {description}
        </p>
      ) : null}
    </div>
  )
}
