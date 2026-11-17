import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useHydrated, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { AuthLayout } from '@/components/auth-layout'
import { FormField, firstErrorMessage } from '@/components/form-field'
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
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { workspaceNameSchema, workspaceSlug } from '@/lib/workspace'
import { unwrapAuth } from '@/lib/workspace.queries'

/**
 * Creates a workspace (a Better Auth organization; the creator is its owner)
 * and opens it. Also where signed-in users without any workspace land.
 */
export const Route = createFileRoute('/workspaces/new')({
  beforeLoad: ({ context, location }) => {
    if (!context.user) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return { user: context.user, hasWorkspace: context.workspace !== null }
  },
  head: () => ({ meta: [{ title: 'Novo workspace · Zora' }] }),
  component: NewWorkspacePage,
})

const schema = z.object({ name: workspaceNameSchema })

function NewWorkspacePage() {
  const { hasWorkspace } = Route.useRouteContext()
  const router = useRouter()
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const name = value.name.trim()
      try {
        // Creating makes it the session's active workspace.
        await unwrapAuth(
          authClient.organization.create({
            name,
            slug: workspaceSlug(name, crypto.randomUUID().slice(0, 6)),
          }),
          'Não foi possível criar o workspace. Tente de novo.',
        )
      } catch (error) {
        setFormError((error as Error).message)
        return
      }
      // Nothing cached from the previous workspace may show in the new one.
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ to: '/calendar' })
    },
  })

  async function signOut() {
    await authClient.signOut()
    queryClient.clear()
    await router.navigate({ to: '/sign-in' })
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm shadow-2xl shadow-black/15 dark:shadow-black">
        <CardHeader>
          <CardTitle>{hasWorkspace ? 'Novo workspace' : 'Crie seu workspace'}</CardTitle>
          <CardDescription>
            {hasWorkspace
              ? 'Um workspace tem seu próprio conteúdo e sua própria equipe.'
              : 'Você ainda não faz parte de nenhum workspace. Se alguém convidou você, abra o link do e-mail de convite; ou crie um workspace seu.'}
          </CardDescription>
        </CardHeader>
        <form
          method="post"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <CardContent>
            <fieldset disabled={!hydrated} className="grid gap-4">
              {formError ? (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              ) : null}
              <form.Field name="name">
                {(field) => (
                  <FormField
                    id={field.name}
                    label="Nome do workspace"
                    error={firstErrorMessage(field.state.meta.errors)}
                  >
                    <Input
                      id={field.name}
                      name={field.name}
                      autoComplete="organization"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </FormField>
                )}
              </form.Field>
            </fieldset>
          </CardContent>
          <CardFooter className="mt-6 flex flex-col gap-3">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" className="w-full" disabled={!hydrated || isSubmitting}>
                  {isSubmitting ? 'Criando…' : 'Criar workspace'}
                </Button>
              )}
            </form.Subscribe>
            {hasWorkspace ? (
              <Link to="/calendar" className="text-muted-foreground text-sm underline underline-offset-4">
                Voltar
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void signOut()}
                className="text-muted-foreground text-sm underline underline-offset-4"
              >
                Sair
              </button>
            )}
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
