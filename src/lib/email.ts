/**
 * Transactional email via Gmail SMTP. Gated on GMAIL_USER + GMAIL_APP_PASSWORD
 * (Google account → Security → 2-Step Verification → App passwords). When
 * unset, sends are skipped and callers get { sent: false } — the UI must not
 * promise an email it can't verify was attempted.
 */
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'

const logger = createLogger('email')

function creds() {
  const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const user = env.GMAIL_USER || process.env.GMAIL_USER || ''
  const pass = env.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || ''
  return user && pass ? { user, pass } : null
}

let _transport: any = null

export async function sendEmail(input: { to: string; subject: string; html: string; text: string }): Promise<{ sent: boolean }> {
  const c = creds()
  if (!c) {
    logger.warn('Email not configured — skipping send', { subject: input.subject })
    return { sent: false }
  }
  try {
    if (!_transport) {
      const nm = await import('nodemailer')
      _transport = (nm.default ?? nm).createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: c.user, pass: c.pass },
      })
    }
    await _transport.sendMail({
      from: `"${siteConfig.email.fromName}" <${c.user}>`,
      to: input.to, subject: input.subject, html: input.html, text: input.text,
    })
    return { sent: true }
  } catch (err) {
    logger.error('Email send failed', { error: err instanceof Error ? err.message : String(err) })
    return { sent: false }
  }
}

export async function sendPartyConfirmationEmail(input: {
  to: string; hostName: string; craftName: string; slotLabel: string
  hostPageUrl: string; inviteUrl: string; totalChargedCents: number; receiptUrl: string | null
}): Promise<{ sent: boolean }> {
  const fee = `$${(input.totalChargedCents / 100).toFixed(2).replace(/\.00$/, '')}`
  const text = [
    `You're booked! ${input.craftName} · ${input.slotLabel}`,
    ``,
    `Studio fee paid today: ${fee}. Crafts are paid at the studio based on who comes.`,
    ``,
    `Your party page (manage details + see who's RSVP'd — keep this link):`,
    input.hostPageUrl,
    ``,
    `Invitation link to share with your guests:`,
    input.inviteUrl,
    ...(input.receiptUrl ? [``, `Receipt: ${input.receiptUrl}`] : []),
    ``,
    `Homegrown Studio · 525 Hughes Rd Ste F, Madison, AL`,
  ].join('\n')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = text
    .split('\n')
    .map((l) => (l.startsWith('http') ? `<p><a href="${esc(l)}">${esc(l)}</a></p>` : `<p>${esc(l) || '&nbsp;'}</p>`))
    .join('')
  const safeCraftName = input.craftName.replace(/[\r\n]+/g, ' ')
  return sendEmail({ to: input.to, subject: `You're booked — ${safeCraftName} at Homegrown Studio`, html, text })
}
