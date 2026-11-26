import { useForm } from '@tanstack/react-form'
import { Link, createFileRoute, useHydrated, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
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

const resetPasswordSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
})

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, { message: 'Use pelo menos 8 caracteres.' })
      .max(128, { message: 'Use no máximo 128 caracteres.' }),
    confirmPassword: z.string().min(1, { message: 'Confirme sua nova senha.' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As senhas não conferem.',
    path: ['confirmPassword'],
  })

export const Route = createFileRoute('/reset-password')({
  validateSearch: resetPasswordSearchSchema,
  head: () => ({ meta: [{ title: 'Nova senha · Zora' }] }),
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const search = Route.useSearch()
  const router = useRouter()
  const hydrated = useHydrated()
  const [formError, setFormError] = useState<string | null>(null)

  const token = search.token?.trim() || null
  const tokenInvalid = Boolean(search.error) || !token

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: { onSubmit: resetPasswordSchema },
    onSubmit: async ({ value }) => {
      if (!token) return
      setFormError(null)
      const { error } = await authClient.resetPassword({
        newPassword: value.password,
        token,
      })
      if (error) {
        setFormError(
          authErrorMessage(
            error,
            'Não foi possível redefinir a senha. O link pode ter expirado.',
          ),
        )
        return
      }
      toast.success('Senha redefinida! Agora você pode entrar com sua nova senha.')
      await router.navigate({ to: '/sign-in' })
    },
  })

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm shadow-2xl shadow-black/15 dark:shadow-black">
        <CardHeader>
          <CardTitle>Criar nova senha</CardTitle>
          <CardDescription>
            {tokenInvalid
              ? 'Este link expirou ou é inválido.'
              : 'Escolha uma senha nova com pelo menos 8 caracteres.'}
          </CardDescription>
        </CardHeader>

        {tokenInvalid ? (
          <>
            <CardContent>
              <Alert variant="destructive">
                <AlertDescription>
                  O link de redefinição expirou ou já foi usado. Solicite um novo link para
                  continuar.
                </AlertDescription>
              </Alert>
            </CardContent>
            <CardFooter className="mt-4 flex flex-col gap-3">
              <Button asChild className="w-full">
                <Link to="/forgot-password">Pedir novo link</Link>
              </Button>
              <Link
                to="/sign-in"
                className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
              >
                Voltar para entrar
              </Link>
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
                <form.Field name="password">
                  {(field) => (
                    <FormField
                      id={field.name}
                      label="Nova senha"
                      error={firstErrorMessage(field.state.meta.errors)}
                    >
                      <Input
                        id={field.name}
                        name={field.name}
                        type="password"
                        autoComplete="new-password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                      />
                    </FormField>
                  )}
                </form.Field>
                <form.Field name="confirmPassword">
                  {(field) => (
                    <FormField
                      id={field.name}
                      label="Confirmar nova senha"
                      error={firstErrorMessage(field.state.meta.errors)}
                    >
                      <Input
                        id={field.name}
                        name={field.name}
                        type="password"
                        autoComplete="new-password"
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
                    {isSubmitting ? 'Salvando…' : 'Salvar nova senha'}
                  </Button>
                )}
              </form.Subscribe>
            </CardFooter>
          </form>
        )}
      </Card>
    </AuthLayout>
  )
}
