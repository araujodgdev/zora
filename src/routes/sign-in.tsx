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
import { authPageSearchSchema, safeRedirectPath } from '@/lib/redirect'

const signInSchema = z.object({
  email: z.email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Enter your password.' }),
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: authPageSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.user) throw redirect({ href: safeRedirectPath(search.redirect) })
  },
  head: () => ({ meta: [{ title: 'Sign in · Zora' }] }),
  component: SignInPage,
})

function SignInPage() {
  const search = Route.useSearch()
  const router = useRouter()
  const hydrated = useHydrated()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const { error } = await authClient.signIn.email(value)
      if (error) {
        setFormError(error.message ?? 'Sign-in failed. Please try again.')
        return
      }
      await router.invalidate()
      await router.navigate({ href: safeRedirectPath(search.redirect) })
    },
  })

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Zora</CardTitle>
          <CardDescription>Plan and manage the launch content.</CardDescription>
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
                    label="Email"
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
                    label="Password"
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
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-sm">
              New to the team?{' '}
              <Link
                to="/sign-up"
                search={{ redirect: search.redirect }}
                className="text-foreground underline underline-offset-4"
              >
                Create an account
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  )
}
