import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  getRouteApi,
  useMatchRoute,
  useHydrated,
  useMatches,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Download,
  List,
  LogOut,
  LayoutGrid,
  Moon,
  Plug,
  Plus,
  Share2,
  Sparkles,
  SquareKanban,
  Sun,
  Users,
} from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WebMcpTools } from '@/components/webmcp-tools'
import { ZoraLogo, ZoraWordmark } from '@/components/brand'
import { authClient } from '@/lib/auth-client'
import { ZORA_DESKTOP_DOWNLOAD_URL, isZoraDesktop } from '@/lib/desktop-bridge'
import { cn } from '@/lib/utils'
import { setTheme, useTheme } from '@/lib/theme'
import { setUiMode, useUiMode } from '@/lib/ui-mode'
import { myWorkspacesQueryOptions, unwrapAuth } from '@/lib/workspace.queries'
import { toast } from 'sonner'

const appRoute = getRouteApi('/_app')

const navItems = [
  { to: '/calendar', label: 'Calendário', icon: CalendarDays },
  { to: '/pipeline', label: 'Pipeline', icon: SquareKanban },
  { to: '/content', label: 'Conteúdos', icon: List },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/connections', label: 'Conexões', icon: Share2 },
  { to: '/team', label: 'Equipe', icon: Users },
] as const

/**
 * Signed-in layout.
 *
 * - `lg` and up (desktops, iPad landscape): a sidebar that collapses to icons
 *   (its button, the rail, or Ctrl/Cmd+B), so pages get the full height.
 * - Below `lg` (phones, iPad portrait): a top bar with the menu button; the
 *   sidebar opens as a sheet.
 *
 * `--page-h` is the height a page can use without scrolling the window (the
 * window minus the top bar and the padding). Full-height pages (calendar,
 * item editor) size themselves with `h-(--page-h)`.
 *
 * A route with `staticData: { fullBleed: true }` (the design editor) gets no
 * padding: it fills the whole area right of the sidebar (below the top bar
 * under `lg`), and `--page-h` is that whole height. Such a page pads its own
 * fallback states with `PAGE_PADDING`.
 */
export function AppShell() {
  const { sidebarOpen } = appRoute.useRouteContext()
  const fullBleed = useMatches({
    select: (matches) => matches.some((match) => match.staticData.fullBleed === true),
  })
  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <WebMcpTools />
      <AppSidebar />
      <SidebarInset>
        <NavigationProgress />
        <MobileTopBar />
        <div
          className={
            fullBleed
              ? 'w-full [--page-h:calc(100svh-3.5rem-env(safe-area-inset-top))] lg:[--page-h:100svh]'
              : cn(
                  'w-full [--page-h:calc(100svh-3.5rem-env(safe-area-inset-top)-3rem)] lg:[--page-h:calc(100svh-4rem)]',
                  PAGE_PADDING,
                )
          }
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

/** The shell's page padding, for full-bleed pages' own fallback states. */
export const PAGE_PADDING = 'px-4 py-6 md:px-6 lg:px-10 lg:py-8'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The page fills the area right of the sidebar, with no shell padding. */
    fullBleed?: boolean
  }
}

/**
 * A thin lime bar across the top while a navigation waits on data, so a
 * click always answers at once. It appears after a short delay (CSS), so
 * navigations served from the cache never flash it.
 */
function NavigationProgress() {
  const pending = useRouterState({ select: (state) => state.status === 'pending' })
  // The router is still pending while it hydrates a route the server rendered
  // without its markup (`ssr: 'data-only'`), but the server's HTML had no bar:
  // shown before hydration ends, the attribute was a hydration mismatch.
  const hydrated = useHydrated()
  return (
    <div
      aria-hidden="true"
      data-pending={hydrated && pending ? '' : undefined}
      className="zora-nav-progress"
    />
  )
}

/**
 * Below `lg`: the menu button and the wordmark, pinned to the top. Installed
 * on iOS the page runs under the status bar (`black-translucent`), so the bar
 * grows by the safe-area inset (0 in a browser tab).
 */
function MobileTopBar() {
  return (
    <header className="bg-background/85 sticky top-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] gap-2 border-b px-2 backdrop-blur-md lg:hidden">
      <SidebarTrigger className="size-10" />
      {/* Just the name here; the full logo (Z and cat) is in the open menu. */}
      <Link to="/calendar" className="text-[1.5rem]">
        <ZoraWordmark />
      </Link>
    </header>
  )
}

function AppSidebar() {
  const { user } = appRoute.useRouteContext()
  const router = useRouter()
  const matchRoute = useMatchRoute()
  // On small screens the sidebar is a sheet: close it once a page is chosen.
  const { setOpenMobile } = useSidebar()
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const showDesktopDownload = hydrated && !isZoraDesktop()
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
          className="px-2 text-[1.5rem] group-data-[collapsible=icon]:hidden"
        >
          <ZoraLogo />
        </Link>
        <SidebarTrigger />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <WorkspaceSwitcher />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
          {showDesktopDownload ? (
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Baixar Zora Desktop (Studio e LightCraft)">
                <a
                  href={ZORA_DESKTOP_DOWNLOAD_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setOpenMobile(false)}
                >
                  <Download />
                  <span>Baixar Zora Desktop</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Conectar agente">
              <Link to="/connect" onClick={() => setOpenMobile(false)}>
                <Plug />
                <span>Conectar agente</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeSwitcher />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <UiModeSwitcher />
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

/**
 * The open workspace, and a menu to switch to another one or create one.
 * Switching changes the session's active organization; everything cached
 * belongs to the previous workspace, so the cache is dropped.
 */
function WorkspaceSwitcher() {
  const { workspace } = appRoute.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const workspaces = useQuery({ ...myWorkspacesQueryOptions(), enabled: open })

  async function switchTo(organizationId: string) {
    if (organizationId === workspace.id) return
    try {
      await unwrapAuth(
        authClient.organization.setActive({ organizationId }),
        'Não foi possível trocar de workspace.',
      )
    } catch (error) {
      toast.error((error as Error).message)
      return
    }
    setOpenMobile(false)
    queryClient.clear()
    await router.invalidate()
    await router.navigate({ to: '/calendar' })
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip={workspace.name} className="font-medium">
          <span
            aria-hidden
            className="bg-lime text-ink flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[0.625rem] font-semibold"
          >
            {Array.from(workspace.name)[0]?.toUpperCase()}
          </span>
          <span className="truncate">{workspace.name}</span>
          <ChevronsUpDown className="ml-auto" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {(workspaces.data ?? [workspace]).map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => void switchTo(item.id)}>
            <span className="truncate">{item.name}</span>
            {item.id === workspace.id ? <Check className="ml-auto" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/workspaces/new" onClick={() => setOpenMobile(false)}>
            <Plus />
            Novo workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

/**
 * Switches between the classic look and fun mode (Zora Clay, the plasticine
 * components); the choice is remembered (`@/lib/ui-mode`).
 */
function UiModeSwitcher() {
  const mode = useUiMode()
  const next = mode === 'fun' ? 'classic' : 'fun'
  const label = next === 'fun' ? 'Modo Fun' : 'Modo clássico'
  return (
    <SidebarMenuButton tooltip={label} onClick={() => setUiMode(next)}>
      {next === 'fun' ? <Sparkles /> : <LayoutGrid />}
      <span>{label}</span>
    </SidebarMenuButton>
  )
}

/** Standard page heading for pages inside the app shell. */
export function PageHeader({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('mb-8', className)}>
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
