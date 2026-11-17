import { SIGNUP_NOT_ALLOWED_MESSAGE } from './allowlist'

/** Better Auth's error codes the sign-in and sign-up pages can hit, in Portuguese. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_EMAIL: 'Informe um e-mail válido.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail. Entre com ela.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Já existe uma conta com este e-mail. Entre com ela.',
  PASSWORD_TOO_SHORT: 'A senha é curta demais.',
  PASSWORD_TOO_LONG: 'A senha é longa demais.',
}

/**
 * The message to show for a failed Better Auth client call. Better Auth's own
 * messages are in English, so known codes are translated, the allowlist
 * message (ours) passes through, and anything else gets `fallback`.
 */
export function authErrorMessage(
  error: { code?: string; message?: string; status?: number },
  fallback: string,
): string {
  if (error.code && error.code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[error.code]!
  }
  if (error.message === SIGNUP_NOT_ALLOWED_MESSAGE) return error.message
  if (error.status === 429) {
    return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'
  }
  return fallback
}
