import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  createFileRoute,
  redirect,
  useHydrated,
  useRouter,
} from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { FormField, firstErrorMessage } from '@/components/form-field'
import { AuthLayout } from '@/components/auth-layout'
import { ZORA_SLOGAN } from '@/components/brand'
import { ConnectAgentLink } from '@/components/connect-agent-link'
import { DownloadDesktopLink } from '@/components/download-desktop-link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import {
  authPageSearchSchema,
  isOAuthContinuation,
  safeRedirectPath,
} from '@/lib/redirect'

const signInSchema = z.object({
  email: z.email({ message: 'Informe um e-mail válido.' }),
  password: z.string().min(1, { message: 'Informe sua senha.' }),
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: authPageSearchSchema,
  beforeLoad: ({ context, search, location }) => {
    if (context.user && !isOAuthContinuation(location.searchStr)) {
      throw redirect({ href: safeRedirectPath(search.redirect) })
    }
  },
  head: () => ({ meta: [{ title: 'Entrar · Zora' }] }),
  component: SignInPage,
})

function SignInPage() {
  const search = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const hydrated = useHydrated()
  // During an MCP client's sign-in, keep its signed request across pages.
  const oauthSearch =
    hydrated && isOAuthContinuation(window.location.search)
      ? window.location.search
      : null
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: search.email ?? '', password: '' },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const { data, error } = await authClient.signIn.email(value)
      if (error) {
        setFormError(authErrorMessage(error, 'Não foi possível entrar. Tente de novo.'))
        return
      }
      // Signing in for an MCP client: the auth client follows the redirect.
      if (data.redirect) return
      // The cached session state belonged to the signed-out visitor.
      queryClient.clear()
      await router.invalidate()
      await router.navigate({ href: safeRedirectPath(search.redirect) })
    },
  })

  return (
    <AuthLayout tagline={ZORA_SLOGAN}>
      <Card className="w-full max-w-sm shadow-2xl shadow-black/15 dark:shadow-black">
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
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
              <form.Field name="email">
                {(field) => (
                  <FormField
                    id={field.name}
                    label="E-mail"
                    error={firstErrorMessage(field.state.meta.errors)}
                  >
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      autoComplete="username"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  </FormField>
                )}
              </form.Field>
              <form.Field name="password">
                {(field) => (
                  <FormField
                    id={field.name}
                    label="Senha"
                    error={firstErrorMessage(field.state.meta.errors)}
                  >
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      autoComplete="current-password"
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
                <Button
                  type="submit"
                  className="w-full"
                  disabled={!hydrated || isSubmitting}
                >
                  {isSubmitting ? 'Entrando…' : 'Entrar'}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-sm">
              Ainda não tem conta?{' '}
              {oauthSearch ? (
                <a href={`/sign-up${oauthSearch}`} className="text-foreground underline underline-offset-4">
                  Criar conta
                </a>
              ) : (
                <Link
                  to="/sign-up"
                  search={{ redirect: search.redirect, email: search.email }}
                  className="text-foreground underline underline-offset-4"
                >
                  Criar conta
                </Link>
              )}
            </p>
          </CardFooter>
        </form>
      </Card>
      {/* Not while an MCP client's sign-in is in progress: leaving drops it. */}
      {oauthSearch ? null : (
        <div className="mt-6 flex flex-col items-center gap-2.5">
          <ConnectAgentLink className="mt-0" />
          <DownloadDesktopLink />
        </div>
      )}
    </AuthLayout>
  )
}
