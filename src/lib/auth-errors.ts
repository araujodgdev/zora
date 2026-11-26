/** Better Auth's error codes the app can hit, in Portuguese. */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  INVALID_EMAIL: 'Informe um e-mail válido.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com este e-mail. Entre com ela.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    'Já existe uma conta com este e-mail. Entre com ela.',
  PASSWORD_TOO_SHORT: 'A senha é curta demais.',
  PASSWORD_TOO_LONG: 'A senha é longa demais.',
  INVALID_TOKEN: 'Este link de redefinição expirou ou já foi usado. Peça um novo link.',
  EXPIRED_TOKEN: 'Este link de redefinição expirou. Peça um novo link.',
  TOKEN_EXPIRED: 'Este link de redefinição expirou. Peça um novo link.',
  // Organization plugin (workspaces, members, invitations).
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: 'Essa pessoa já faz parte do workspace.',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: 'Essa pessoa já tem um convite pendente.',
  YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION:
    'Só donos e admins podem convidar pessoas.',
  YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER: 'Você não pode remover este membro.',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER:
    'O workspace precisa de pelo menos um dono.',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER:
    'O workspace precisa de pelo menos um dono.',
  INVITATION_NOT_FOUND: 'Este convite não existe mais, expirou ou já foi usado.',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
    'Este convite foi enviado para outro e-mail.',
  INVITATION_LIMIT_REACHED: 'Limite de convites pendentes atingido.',
  ORGANIZATION_MEMBERSHIP_LIMIT_REACHED: 'O workspace atingiu o limite de membros.',
  ORGANIZATION_SLUG_ALREADY_TAKEN: 'Já existe um workspace com esse endereço. Tente outro nome.',
  ORGANIZATION_ALREADY_EXISTS: 'Já existe um workspace com esse endereço. Tente outro nome.',
  USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION: 'Você não faz parte deste workspace.',
  MEMBER_NOT_FOUND: 'Membro não encontrado.',
}

/**
 * The message to show for a failed Better Auth client call. Better Auth's own
 * messages are in English, so known codes are translated and anything else gets
 * `fallback`.
 */
export function authErrorMessage(
  error: { code?: string; message?: string; status?: number },
  fallback: string,
): string {
  if (error.code && error.code in AUTH_ERROR_MESSAGES) {
    return AUTH_ERROR_MESSAGES[error.code]!
  }
  if (error.status === 429) {
    return 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'
  }
  return fallback
}
