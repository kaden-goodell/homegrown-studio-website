/**
 * "Email me this class": for the visitor who likes a class but isn't ready to
 * book (late at night, checking with a friend). One email, sent once, with
 * the class and a button back to it. Nothing follows it.
 *
 * Lives in its own file (not email.ts) so it doesn't collide with the
 * own-booking-system rewrite of email.ts.
 */
import { sendEmail } from '@lib/email'
import { siteConfig } from '@config/site.config'
import { withUtm } from '@lib/utm'
import { formatDayAndSpan, formatDay, formatTimeSpan } from '@lib/studio-time'
import { formatMoney } from '@lib/money'

export interface ClassForEmail {
  id: string
  name: string
  description: string
  startAt: string
  durationMinutes: number
  priceCents: number
  imageUrl?: string
  flyerUrl?: string
  /** Our own classes: their own page (/classes/<id>), so a link-only class works too. Default: /workshops?w=<id>. */
  path?: string
  /** Our own classes: the price as the card says it ("$35", "$20 child · $30 adult", "From $35"). Default: "$X a seat". */
  priceLabel?: string
  /** Our own classes that meet more than once: "4 sessions · starts Sat Oct 24", after the first date. */
  sessionsLabel?: string
}

const ADDRESS_SHORT = '525 Hughes Rd, Madison'
const ADDRESS_FULL = '525 Hughes Rd, Suite F, Madison, AL 35758'

export function classLinkUrl(siteUrl: string, classId: string, path?: string): string {
  return withUtm(`${siteUrl.replace(/\/$/, '')}${path ?? `/workshops?w=${encodeURIComponent(classId)}`}`, {
    source: 'email', medium: 'email', campaign: 'class_link',
  })
}

export function buildClassLinkEmail(c: ClassForEmail, siteUrl: string): { subject: string; html: string; text: string } {
  const end = new Date(new Date(c.startAt).getTime() + c.durationMinutes * 60_000).toISOString()
  const when = [formatDayAndSpan(c.startAt, end), c.sessionsLabel].filter(Boolean).join(' · ')
  const url = classLinkUrl(siteUrl, c.id, c.path)
  const price = c.priceLabel ?? (c.priceCents > 0 ? `${formatMoney(c.priceCents)} a seat` : '')
  const factLine = price ? `${price} · ${ADDRESS_SHORT}` : ADDRESS_SHORT
  const paragraphs = c.description.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
  const photo = c.imageUrl ?? c.flyerUrl
  const phone = siteConfig.contactPhone
  const why = 'You asked for this at ourhometownstudio.com. This is the only email you will get about it.'
  const subject = `${c.name} · ${formatDay(c.startAt)}, ${formatTimeSpan(c.startAt, end)}`

  const text = [
    c.name,
    when,
    ``,
    ...paragraphs.flatMap((p) => [p, ``]),
    factLine,
    ``,
    `Book your seat: ${url}`,
    ``,
    ...(phone ? [`Questions? Text us at ${phone}.`, ``] : []),
    why,
    ``,
    `Hometown Studio · ${ADDRESS_FULL}`,
  ].join('\n')

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const P = 'margin:0 0 10px;font-size:15px;color:#3d3630;line-height:1.55'
  const MUTED = 'margin:0 0 6px;font-size:13px;color:#6f635b;line-height:1.5'
  const BUTTON =
    'display:inline-block;margin:6px 0 0;padding:12px 22px;border-radius:9999px;background:#7a4a2e;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none'
  const html = `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Hometown Studio</p>
  <h1 style="margin:0 0 4px;font-size:22px;color:#3d3630;">${esc(c.name)}</h1>
  <p style="${P};font-weight:600;">${esc(when)}</p>
  ${photo ? `<img src="${esc(photo)}" alt="${esc(c.name)}" width="552" style="display:block;width:100%;max-width:552px;height:auto;border-radius:12px;margin:0 0 14px;" />` : ''}
  ${paragraphs.map((p) => `<p style="${P}">${esc(p)}</p>`).join('\n  ')}
  <p style="${P};font-weight:600;">${esc(factLine)}</p>
  <a href="${esc(url)}" style="${BUTTON}">Book your seat</a>
  ${phone ? `<p style="${P};margin-top:18px;">Questions? Text us at <strong>${esc(phone)}</strong>.</p>` : ''}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="${MUTED}">${esc(why)}</p>
  <p style="margin:0;font-size:12px;color:#6f635b;">Hometown Studio &middot; ${esc(ADDRESS_FULL)}</p>
</div>`
  return { subject, html, text }
}

export async function sendClassLinkEmail(to: string, c: ClassForEmail, siteUrl: string): Promise<{ sent: boolean }> {
  return sendEmail({ to, ...buildClassLinkEmail(c, siteUrl) })
}
