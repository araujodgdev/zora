import { useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import type { ReactNode } from 'react'
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
import { invitationPath, normalizeEmail } from '@/lib/workspace'
import type { InvitationStatus } from '@/lib/workspace'
import { getInvitationPreview } from '@/lib/workspace.functions'
import { unwrapAuth } from '@/lib/workspace.queries'

/**
 * The link in an invitation email. Works signed out: it explains who invited
 * whom, then sends the visitor to sign up or sign in, and back here to accept.
 */
export const Route = createFileRoute('/invite/$invitationId')({
  loader: ({ params }) => getInvitationPreview({ data: { id: params.invitationId } }),
  head: () => ({ meta: [{ title: 'Convite · Zora' }] }),
  component: InvitePage,
})

const CLOSED_MESSAGES: Record<Exclude<InvitationStatus, 'pending'>, string> = {
  accepted: 'Este convite já foi aceito.',
  rejected: 'Este convite foi recusado.',
  canceled: 'Este convite foi cancelado. Peça um novo a quem convidou você.',
  expired: 'Este convite expirou. Peça um novo a quem convidou você.',
}

function InviteCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <AuthLayout>
      <Card className="w-full max-w-sm shadow-2xl shadow-black/15 dark:shadow-black">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
        {footer ? <CardFooter className="mt-6 flex flex-col gap-3">{footer}</CardFooter> : null}
      </Card>
    </AuthLayout>
  )
}

function InvitePage() {
  const invitation = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<'accept' | 'reject' | 'signout' | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!invitation) {
    return (
      <InviteCard
        title="Convite não encontrado"
        description="Confira se o link está completo, ou peça um novo convite."
        footer={<HomeLink />}
      />
    )
  }

  if (invitation.status !== 'pending') {
    return (
      <InviteCard
        title={`Convite para ${invitation.workspaceName}`}
        description={CLOSED_MESSAGES[invitation.status]}
        footer={<HomeLink />}
      />
    )
  }

  const intro = (
    <>
      <strong className="text-foreground">{invitation.inviterName}</strong> convidou{' '}
      <strong className="text-foreground">{invitation.email}</strong> para o workspace{' '}
      <strong className="text-foreground">{invitation.workspaceName}</strong>.
    </>
  )
  const here = invitationPath(invitation.id)

  if (!user) {
    return (
      <InviteCard
        title="Você foi convidado"
        description={intro}
        footer={
          <>
            <Button asChild className="w-full">
              <Link to="/sign-up" search={{ redirect: here, email: invitation.email }}>
                Criar conta
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link to="/sign-in" search={{ redirect: here, email: invitation.email }}>
                Já tenho conta
              </Link>
            </Button>
          </>
        }
      />
    )
  }

  async function run(action: 'accept' | 'reject' | 'signout') {
    setPending(action)
    setError(null)
    try {
      if (action === 'signout') {
        await authClient.signOut()
        queryClient.clear()
        await router.invalidate()
        return
      }
      if (action === 'accept') {
        // Accepting also makes it the session's active workspace.
        await unwrapAuth(
          authClient.organization.acceptInvitation({ invitationId: invitation!.id }),
          'Não foi possível aceitar o convite. Tente de novo.',
        )
      } else {
        await unwrapAuth(
          authClient.organization.rejectInvitation({ invitationId: invitation!.id }),
          'Não foi possível recusar o convite. Tente de novo.',
        )
      }
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/calendar' })
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setPending(null)
    }
  }

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : undefined

  if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
    return (
      <InviteCard
        title="Convite para outro e-mail"
        description={
          <>
            Este convite é para <strong className="text-foreground">{invitation.email}</strong>, mas
            você entrou como <strong className="text-foreground">{user.email}</strong>. Saia e entre
            (ou crie a conta) com o e-mail convidado.
          </>
        }
        footer={
          <Button className="w-full" disabled={pending !== null} onClick={() => void run('signout')}>
            {pending === 'signout' ? 'Saindo…' : 'Sair'}
          </Button>
        }
      >
        {errorAlert}
      </InviteCard>
    )
  }

  return (
    <InviteCard
      title="Você foi convidado"
      description={intro}
      footer={
        <>
          <Button className="w-full" disabled={pending !== null} onClick={() => void run('accept')}>
            {pending === 'accept' ? 'Entrando no workspace…' : 'Aceitar convite'}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            disabled={pending !== null}
            onClick={() => void run('reject')}
          >
            {pending === 'reject' ? 'Recusando…' : 'Recusar'}
          </Button>
        </>
      }
    >
      {errorAlert}
    </InviteCard>
  )
}

function HomeLink() {
  return (
    <Link to="/" className="text-muted-foreground text-sm underline underline-offset-4">
      Ir para o Zora
    </Link>
  )
}
