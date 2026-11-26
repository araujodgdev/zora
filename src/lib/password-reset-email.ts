import type { OutgoingEmail } from './mailer.server'

const PASSWORD_RESET_SENDER = {
  email: 'zora@notify.lume.software',
  name: 'Zora',
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Password recovery email sent via Cloudflare Email Sending (`notify.lume.software`).
 */
export function passwordResetEmail(input: {
  to: string
  name?: string | null
  url: string
}): OutgoingEmail {
  const { to, name, url } = input
  const greeting = name?.trim() ? `Oi, ${name.trim()}.` : 'Oi.'
  const subject = 'Redefinir sua senha no Zora'
  const text = [
    greeting,
    '',
    'Recebemos um pedido para redefinir a senha da sua conta no Zora.',
    '',
    'Abra o link abaixo para criar uma nova senha (vale por 1 hora):',
    url,
    '',
    'Se você não pediu isso, pode ignorar este e-mail com segurança.',
  ].join('\n')

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:32px 16px;background:#f2f2f0;font-family:Helvetica,Arial,sans-serif;color:#111">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px">
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-size:22px;font-weight:700;font-style:italic">Zora</p>
        <p style="margin:0 0 12px;font-size:16px;line-height:1.5">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5">
          Recebemos um pedido para redefinir a senha da sua conta no Zora.
        </p>
        <p style="margin:0 0 24px">
          <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#a7f175;color:#0e1318;font-weight:600;text-decoration:none">Criar nova senha</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#555">O link vale por 1 hora. Se o botão não funcionar, copie este endereço:</p>
        <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${escapeHtml(url)}" style="color:#111">${escapeHtml(url)}</a></p>
        <p style="margin:0;font-size:13px;color:#555">Se você não pediu isso, pode ignorar este e-mail com segurança.</p>
      </td></tr>
    </table>
  </body>
</html>`

  return { to, from: PASSWORD_RESET_SENDER, subject, text, html }
}
