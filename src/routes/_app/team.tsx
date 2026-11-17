import { useForm } from '@tanstack/react-form'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, useHydrated } from '@tanstack/react-router'
import { Copy, Mail, RotateCw, UserMinus, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { PageHeader } from '@/components/app-shell'
import { INVITATION_EMAIL_FAILED_MESSAGE } from '@/lib/invitation-email'
import { AssigneeAvatar } from '@/components/content/assignee-avatar'
import { FormField, firstErrorMessage } from '@/components/form-field'
import { LocalDateTime } from '@/components/local-date-time'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  canManageMembers,
  invitationPath,
  inviteEmailSchema,
  parseRoles,
  roleLabel,
} from '@/lib/workspace'
import type { PendingInvitation, WorkspaceMember } from '@/lib/workspace'
import { loadQuery } from '@/lib/route-query'
import {
  useCancelInvitation,
  useInviteMember,
  useRemoveMember,
  workspaceInvitationsQueryOptions,
  workspaceMembersQueryOptions,
} from '@/lib/workspace.queries'

/**
 * The current workspace's members and, for owners and admins, its pending
 * invitations and the invite form. Better Auth checks every action again.
 */
export const Route = createFileRoute('/_app/team')({
  loader: async ({ context }) => {
    await Promise.all([
      loadQuery(context.queryClient, workspaceMembersQueryOptions()),
      loadQuery(context.queryClient, workspaceInvitationsQueryOptions()),
    ])
  },
  head: () => ({ meta: [{ title: 'Equipe · Zora' }] }),
  component: TeamPage,
})

function TeamPage() {
  const { user, workspace } = Route.useRouteContext()
  const canManage = canManageMembers(workspace.role)
  const { data: members } = useSuspenseQuery(workspaceMembersQueryOptions())
  const { data: invitations } = useSuspenseQuery(workspaceInvitationsQueryOptions())

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Equipe"
        description={`Quem faz parte de ${workspace.name}. Todo membro vê e edita todo o conteúdo do workspace.`}
      />
      <div className="grid gap-6">
        {canManage ? <InviteCard /> : null}
        {canManage && invitations.length > 0 ? (
          <InvitationsCard invitations={invitations} />
        ) : null}
        <MembersCard
          organizationId={workspace.id}
          members={members}
          currentUserId={user.id}
          canManage={canManage}
        />
      </div>
    </div>
  )
}

const inviteSchema = z.object({ email: inviteEmailSchema })

/** Toast for a finished invite: sent, or created without its email. */
function announceInvite(email: string, emailSent: boolean, verb: string) {
  if (emailSent) toast.success(`Convite ${verb} para ${email}.`)
  else toast.warning(INVITATION_EMAIL_FAILED_MESSAGE, { duration: 10_000 })
}

function InviteCard() {
  const invite = useInviteMember()
  const hydrated = useHydrated()
  const [formError, setFormError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: inviteSchema },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null)
      try {
        const { emailSent } = await invite.mutateAsync({ email: value.email })
        announceInvite(value.email.trim(), emailSent, 'enviado')
        formApi.reset()
      } catch (error) {
        setFormError((error as Error).message)
      }
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convidar pessoa</CardTitle>
        <CardDescription>
          Ela recebe um e-mail com um link (válido por 7 dias) para criar a conta ou entrar e
          aceitar o convite.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <fieldset
            disabled={!hydrated}
            className="flex flex-col gap-3 sm:flex-row sm:items-start"
          >
            <form.Field name="email">
              {(field) => (
                <div className="min-w-0 flex-1">
                  <FormField
                    id="invite-email"
                    label="E-mail"
                    error={firstErrorMessage(field.state.meta.errors)}
                  >
                    <Input
                      id="invite-email"
                      type="email"
                      autoComplete="off"
                      placeholder="nome@exemplo.com"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </FormField>
                </div>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting} className="sm:mt-[1.375rem]">
                  <Mail data-icon="inline-start" />
                  {isSubmitting ? 'Enviando…' : 'Enviar convite'}
                </Button>
              )}
            </form.Subscribe>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  )
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function InvitationsCard({ invitations }: { invitations: Array<PendingInvitation> }) {
  const resend = useInviteMember()
  const cancel = useCancelInvitation()
  const busy = resend.isPending || cancel.isPending

  async function copyLink(invitation: PendingInvitation) {
    const url = new URL(invitationPath(invitation.id), window.location.origin).toString()
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link do convite copiado.')
    } catch {
      toast.error('Não foi possível copiar. Link: ' + url)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convites pendentes</CardTitle>
        <CardDescription>
          Se o e-mail não chegar, copie o link e envie você mesmo: só funciona para o e-mail
          convidado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {invitations.map((invitation) => {
            const { expired } = invitation
            return (
              <li key={invitation.id} className="flex items-center gap-3 py-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{invitation.email}</span>
                  <span className="text-muted-foreground text-xs">
                    {expired ? 'Expirou em ' : 'Expira em '}
                    <LocalDateTime value={invitation.expiresAt} />
                  </span>
                </div>
                {!expired ? (
                  <IconAction label="Copiar link" onClick={() => void copyLink(invitation)}>
                    <Copy />
                  </IconAction>
                ) : null}
                <IconAction
                  label="Reenviar convite"
                  disabled={busy}
                  onClick={() =>
                    resend.mutate(
                      { email: invitation.email, resend: true },
                      {
                        onSuccess: ({ emailSent }) =>
                          announceInvite(invitation.email, emailSent, 'reenviado'),
                        onError: (error) => toast.error(error.message),
                      },
                    )
                  }
                >
                  <RotateCw />
                </IconAction>
                <IconAction
                  label="Cancelar convite"
                  disabled={busy}
                  onClick={() =>
                    cancel.mutate(invitation.id, {
                      onSuccess: () => toast.success('Convite cancelado.'),
                      onError: (error) => toast.error(error.message),
                    })
                  }
                >
                  <X />
                </IconAction>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function MembersCard({
  organizationId,
  members,
  currentUserId,
  canManage,
}: {
  organizationId: string
  members: Array<WorkspaceMember>
  currentUserId: string
  canManage: boolean
}) {
  const remove = useRemoveMember(organizationId)

  function confirmRemove(member: WorkspaceMember) {
    if (!window.confirm(`Remover ${member.name} do workspace? Os itens atribuídos a essa pessoa vão aparecer sem responsável.`)) {
      return
    }
    remove.mutate(member.memberId, {
      onSuccess: () => toast.success(`${member.name} saiu do workspace.`),
      onError: (error) => toast.error(error.message),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Membros</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {members.map((member) => {
            const removable =
              canManage && member.id !== currentUserId && !parseRoles(member.role).includes('owner')
            return (
              <li key={member.memberId} className="flex items-center gap-3 py-3">
                <AssigneeAvatar member={member} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">
                    {member.name}
                    {member.id === currentUserId ? (
                      <span className="text-muted-foreground font-normal"> (você)</span>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground truncate text-xs">{member.email}</span>
                </div>
                <span className="text-muted-foreground text-sm">{roleLabel(member.role)}</span>
                {removable ? (
                  <IconAction
                    label="Remover do workspace"
                    disabled={remove.isPending}
                    onClick={() => confirmRemove(member)}
                  >
                    <UserMinus />
                  </IconAction>
                ) : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
