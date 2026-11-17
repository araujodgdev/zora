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
  openid: 'Saber quem você é',
  profile: 'Ver o seu nome',
  email: 'Ver o seu e-mail',
  offline_access: 'Continuar conectado sem pedir de novo',
}

// Where Better Auth sends you when an MCP client (Claude, ChatGPT, an editor)
// asks to act for you. Client-only: the signed query must reach the server
// exactly as it appears in the address bar.
export const Route = createFileRoute('/consent')({
  ssr: false,
  head: () => ({ meta: [{ title: 'Permitir acesso · Zora' }] }),
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
      setError(failure.message ?? 'Algo deu errado. Comece de novo pelo app.')
      setPending(null)
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-md shadow-2xl shadow-black">
        {!request ? (
          <CardHeader>
            <CardTitle>Este link não é mais válido</CardTitle>
            <CardDescription>
              Ele expirou ou foi alterado. Volte ao app que trouxe você até aqui
              e conecte ao Zora de novo.
            </CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              {request.logoUri ? (
                <img src={request.logoUri} alt="" className="mb-2 size-10 rounded-md" />
              ) : null}
              <CardTitle>Permitir que {request.clientName} use o Zora?</CardTitle>
              <CardDescription>
                Ele vai agir como {user?.name ?? 'você'}: pode ler, criar, alterar
                e excluir conteúdos e mídias do espaço da equipe.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {request.clientHost ? (
                  <>
                    <dt className="text-muted-foreground">App de</dt>
                    <dd className="font-medium">{request.clientHost}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Volta para</dt>
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
                Só permita apps que você mesmo começou a conectar.
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
                {pending === 'deny' ? 'Recusando…' : 'Recusar'}
              </Button>
              <Button disabled={pending !== null} onClick={() => void decide(true)}>
                {pending === 'allow' ? 'Permitindo…' : 'Permitir'}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </AuthLayout>
  )
}
