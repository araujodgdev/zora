import { useForm } from '@tanstack/react-form'
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
import { authErrorMessage } from '@/lib/auth-errors'
import {
  authPageSearchSchema,
  isOAuthContinuation,
  safeRedirectPath,
} from '@/lib/redirect'

// Client-side checks are for feedback only. The server enforces the email
// allowlist and Better Auth's password rules (8–128 characters by default).
const signUpSchema = z.object({
  name: z.string().trim().min(1, { message: 'Informe seu nome.' }),
  email: z.email({ message: 'Informe um e-mail válido.' }),
  password: z
    .string()
    .min(8, { message: 'Use pelo menos 8 caracteres.' })
    .max(128, { message: 'Use no máximo 128 caracteres.' }),
})

export const Route = createFileRoute('/sign-up')({
  validateSearch: authPageSearchSchema,
  beforeLoad: ({ context, search, location }) => {
    if (context.user && !isOAuthContinuation(location.searchStr)) {
      throw redirect({ href: safeRedirectPath(search.redirect) })
    }
  },
  head: () => ({ meta: [{ title: 'Criar conta · Zora' }] }),
  component: SignUpPage,
})

const fields = [
  { name: 'name', label: 'Nome', type: 'text', autoComplete: 'name' },
  { name: 'email', label: 'E-mail', type: 'email', autoComplete: 'username' },
  {
    name: 'password',
    label: 'Senha',
    type: 'password',
    autoComplete: 'new-password',
  },
] as const

function SignUpPage() {
  const search = Route.useSearch()
  const router = useRouter()
  const hydrated = useHydrated()
  // During an MCP client's sign-in, keep its signed request across pages.
  const oauthSearch =
    hydrated && isOAuthContinuation(window.location.search)
      ? window.location.search
      : null
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { name: '', email: '', password: '' },
    validators: { onSubmit: signUpSchema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const { data, error } = await authClient.signUp.email({
        name: value.name.trim(),
        email: value.email,
        password: value.password,
      })
      if (error) {
        setFormError(
          authErrorMessage(error, 'Não foi possível criar a conta. Tente de novo.'),
        )
        return
      }
      // Signing up for an MCP client: the auth client follows the redirect.
      if ('redirect' in data && data.redirect) return
      // Better Auth signs the user in after sign-up.
      await router.invalidate()
      await router.navigate({ href: safeRedirectPath(search.redirect) })
    },
  })

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm shadow-2xl shadow-black">
        <CardHeader>
          <CardTitle>Criar sua conta</CardTitle>
          <CardDescription>
            O cadastro é liberado só para e-mails convidados da equipe.
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
              {fields.map((config) => (
                <form.Field key={config.name} name={config.name}>
                  {(field) => (
                    <FormField
                      id={field.name}
                      label={config.label}
                      error={firstErrorMessage(field.state.meta.errors)}
                    >
                      <Input
                        id={field.name}
                        name={field.name}
                        type={config.type}
                        autoComplete={config.autoComplete}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                    </FormField>
                  )}
                </form.Field>
              ))}
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
                  {isSubmitting ? 'Criando conta…' : 'Criar conta'}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-sm">
              Already have an account?{' '}
              {oauthSearch ? (
                <a href={`/sign-in${oauthSearch}`} className="text-foreground underline underline-offset-4">
                  Entrar
                </a>
              ) : (
                <Link
                  to="/sign-in"
                  search={{ redirect: search.redirect }}
                  className="text-foreground underline underline-offset-4"
                >
                  Entrar
                </Link>
              )}
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
