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
import {
  authPageSearchSchema,
  isOAuthContinuation,
  safeRedirectPath,
} from '@/lib/redirect'

const signInSchema = z.object({
  email: z.email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Enter your password.' }),
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: authPageSearchSchema,
  beforeLoad: ({ context, search, location }) => {
    if (context.user && !isOAuthContinuation(location.searchStr)) {
      throw redirect({ href: safeRedirectPath(search.redirect) })
    }
  },
  head: () => ({ meta: [{ title: 'Sign in · Zora' }] }),
  component: SignInPage,
})

function SignInPage() {
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
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: signInSchema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      const { data, error } = await authClient.signIn.email(value)
      if (error) {
        setFormError(error.message ?? 'Sign-in failed. Please try again.')
        return
      }
      // Signing in for an MCP client: the auth client follows the redirect.
      if (data.redirect) return
      await router.invalidate()
      await router.navigate({ href: safeRedirectPath(search.redirect) })
    },
  })

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm shadow-2xl shadow-black">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
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
              {oauthSearch ? (
                <a href={`/sign-up${oauthSearch}`} className="text-foreground underline underline-offset-4">
                  Create an account
                </a>
              ) : (
                <Link
                  to="/sign-up"
                  search={{ redirect: search.redirect }}
                  className="text-foreground underline underline-offset-4"
                >
                  Create an account
                </Link>
              )}
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  )
}
