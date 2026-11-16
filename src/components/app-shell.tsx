import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  getRouteApi,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

const appRoute = getRouteApi('/_app')

const navItems = [
  { to: '/calendar', label: 'Calendar' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/content', label: 'Content' },
] as const

/** Signed-in layout: top navigation, current user, sign-out. */
export function AppShell() {
  const { user } = appRoute.useRouteContext()
  const router = useRouter()
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
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link to="/calendar" className="font-semibold tracking-tight">
            Zora
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 text-sm transition-colors"
                activeProps={{
                  className: 'bg-muted text-foreground font-medium',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-muted-foreground text-sm" title={user.email}>
              {user.name}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
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
