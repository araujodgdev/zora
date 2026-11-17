import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthLayout } from '@/components/auth-layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { authClient } from '@/lib/auth-client'
import { getConsentRequest } from '@/lib/oauth-consent.functions'

const SCOPE_LABELS: Record<string, string> = {
  openid: 'Know who you are',
  profile: 'See your name',
  email: 'See your email address',
  offline_access: 'Stay connected without asking you again',
}

// Where Better Auth sends you when an MCP client (Claude, ChatGPT, an editor)
// asks to act for you. Client-only: the signed query must reach the server
// exactly as it appears in the address bar.
export const Route = createFileRoute('/consent')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Allow access · Zora' }] }),
  loader: () =>
    getConsentRequest({ data: { search: window.location.search } }).catch(
      () => null,
    ),
  component: ConsentPage,
})

function ConsentPage() {
  const request = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const [pending, setPending] = useState<'allow' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(accept: boolean) {
    setPending(accept ? 'allow' : 'deny')
    setError(null)
    // On success the auth client follows the redirect back to the app.
    const { error: failure } = await authClient.oauth2.consent({ accept })
    if (failure) {
      setError(failure.message ?? 'Something went wrong. Start again from the app.')
      setPending(null)
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md shadow-2xl shadow-black">
        {!request ? (
          <CardHeader>
            <CardTitle>This link is no longer valid</CardTitle>
            <CardDescription>
              It expired or was changed. Go back to the app that sent you here
              and connect to Zora again.
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              {request.logoUri ? (
                <img src={request.logoUri} alt="" className="mb-2 size-10 rounded-md" />
              ) : null}
              <CardTitle>Allow {request.clientName} to use Zora?</CardTitle>
              <CardDescription>
                It will act as {user?.name ?? 'you'}: it can read, create, change
                and delete content and media in the team workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {request.clientHost ? (
                  <>
                    <dt className="text-muted-foreground">App from</dt>
                    <dd className="font-medium">{request.clientHost}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Returns to</dt>
                <dd className="font-medium">{request.redirectHost}</dd>
              </dl>
              {request.scopes.length > 0 ? (
                <ul className="text-muted-foreground list-disc pl-5">
                  {request.scopes.map((scope) => (
                    <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-muted-foreground">
                Only allow apps you started connecting yourself.
              </p>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
            <CardFooter className="justify-end gap-2">
              <Button
                variant="outline"
                disabled={pending !== null}
                onClick={() => void decide(false)}
              >
                {pending === 'deny' ? 'Denying…' : 'Deny'}
              </Button>
              <Button disabled={pending !== null} onClick={() => void decide(true)}>
                {pending === 'allow' ? 'Allowing…' : 'Allow'}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </AuthLayout>
  )
}
