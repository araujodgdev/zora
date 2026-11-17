/**
 * Sign-up allowlist. `ALLOWED_SIGNUP_EMAILS` is a comma-separated list of
 * emails, compared case-insensitively. An empty list allows nobody.
 */

export const SIGNUP_NOT_ALLOWED_MESSAGE =
  'O cadastro é restrito à equipe do Zora. Peça a um administrador para liberar o seu e-mail.'

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseAllowlist(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(normalizeEmail)
      .filter((email) => email.length > 0),
  )
}

export function isEmailAllowed(
  email: string,
  allowlist: ReadonlySet<string>,
): boolean {
  return allowlist.has(normalizeEmail(email))
}
