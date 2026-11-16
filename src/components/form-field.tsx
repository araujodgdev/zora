import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/** First readable message from TanStack Form field errors (strings or Standard Schema issues). */
export function firstErrorMessage(errors: Array<unknown>): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message)
    }
  }
  return undefined
}

/** Label + control + error message, for use inside `form.Field`. */
export function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  )
}
