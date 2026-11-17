/**
 * The workspace invitation email. Sent from Cloudflare Email Sending on
 * `notify.lume.software`, the domain onboarded for sending on the account.
 */

export const INVITATION_EMAIL_SENDER = {
  email: 'zora@notify.lume.software',
  name: 'Zora',
}

/** Shown when the invitation was saved but its email could not be sent. */
export const INVITATION_EMAIL_FAILED_MESSAGE =
  'O convite foi criado, mas o e-mail não pôde ser enviado. Copie o link em "Convites pendentes" e envie você mesmo.'

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function invitationEmail(input: {
  to: string
  workspaceName: string
  inviterName: string
  url: string
}) {
  const { to, workspaceName, inviterName, url } = input
  const subject = `${inviterName} convidou você para ${workspaceName} no Zora`
  const text = [
    `${inviterName} convidou você para o workspace ${workspaceName} no Zora.`,
    '',
    'Abra o link para aceitar (vale por 7 dias):',
    url,
    '',
    'Se você não esperava este convite, ignore este e-mail.',
  ].join('\n')
  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:32px 16px;background:#f2f2f0;font-family:Helvetica,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-size:22px;font-weight:700;font-style:italic">Zora</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5">
          <strong>${escapeHtml(inviterName)}</strong> convidou você para o workspace
          <strong>${escapeHtml(workspaceName)}</strong> no Zora.
        </p>
        <p style="margin:0 0 24px">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#c6f432;color:#111;font-weight:600;text-decoration:none">Aceitar convite</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#555">O link vale por 7 dias. Se o botão não funcionar, copie este endereço:</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(url)}" style="color:#111">${escapeHtml(url)}</a></p>
        <p style="margin:0;font-size:13px;color:#555">Se você não esperava este convite, ignore este e-mail.</p>
      </td></tr>
    </table>
  </body>
</html>`
  return { to, from: INVITATION_EMAIL_SENDER, subject, text, html }
}
