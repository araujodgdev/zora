import { useForm } from '@tanstack/react-form'
import { Link, createFileRoute, redirect, useHydrated } from '@tanstack/react-router'
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
import { authErrorMessage } from '@/lib/auth-errors'

const forgotPasswordSearchSchema = z.object({
  email: z.string().optional(),
})

const forgotPasswordSchema = z.object({
  email: z.email({ message: 'Informe um e-mail válido.' }),
})

export const Route = createFileRoute('/forgot-password')({
  validateSearch: forgotPasswordSearchSchema,
  beforeLoad: ({ context }) => {
    if (context.user) {
      throw redirect({ to: '/' })
    }
  },
  head: () => ({ meta: [{ title: 'Esqueci minha senha · Zora' }] }),
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const search = Route.useSearch()
  const hydrated = useHydrated()
  const [formError, setFormError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: search.email ?? '' },
    validators: { onSubmit: forgotPasswordSchema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const email = value.email.trim()
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) {
        setFormError(
          authErrorMessage(error, 'Não foi possível enviar o link agora. Tente novamente.'),
        )
        return
      }
      setSentTo(email)
    },
  })

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm shadow-2xl shadow-black/15 dark:shadow-black">
        <CardHeader>
          <CardTitle>Recuperar senha</CardTitle>
          <CardDescription>
            {sentTo
              ? 'Confira sua caixa de entrada e a pasta de spam.'
              : 'Informe seu e-mail para receber um link de redefinição.'}
          </CardDescription>
        </CardHeader>

        {sentTo ? (
          <>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground leading-relaxed">
                Se existir uma conta cadastrada com{' '}
                <strong className="text-foreground">{sentTo}</strong>, enviamos um link para criar
                uma nova senha. Ele vale por 1 hora.
              </p>
            </CardContent>
            <CardFooter className="mt-4 flex flex-col gap-3">
              <Button asChild className="w-full">
                <Link to="/sign-in" search={{ email: sentTo }}>
                  Voltar para entrar
                </Link>
              </Button>
              <button
                type="button"
                onClick={() => setSentTo(null)}
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
              >
                Usar outro e-mail
              </button>
            </CardFooter>
          </>
        ) : (
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
                    {isSubmitting ? 'Enviando…' : 'Enviar link de recuperação'}
                  </Button>
                )}
              </form.Subscribe>
              <p className="text-muted-foreground text-sm">
                Lembrou a senha?{' '}
                <Link
                  to="/sign-in"
                  search={{ email: search.email }}
                  className="text-foreground underline underline-offset-4"
                >
                  Entrar
                </Link>
              </p>
            </CardFooter>
          </form>
        )}
      </Card>
    </AuthLayout>
  )
}
