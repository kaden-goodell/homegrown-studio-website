/**
 * The customer's quote link, by text and by email. The email is its own
 * short inline-styled shell in the brand look of the party payment emails
 * (brown pill button). Server only.
 */
import { sendEmail } from '@lib/email'
import { siteConfig } from '@config/site.config'

const ADDRESS = '525 Hughes Rd, Suite F, Madison, AL 35758'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The text with the link. */
export function quoteLinkText(givenName: string, url: string): string {
  return `Hi ${givenName || 'there'}! Your Hometown Studio event ideas are ready: ${url}`
}

/** The email with the link. `expiresLabel` reads like "Tue, Dec 1". */
export function sendQuoteLinkEmail(input: { to: string; givenName: string; url: string; expiresLabel: string }): Promise<{ sent: boolean }> {
  const hi = input.givenName ? `Hi ${input.givenName},` : 'Hi,'
  const lines = [
    'Your event ideas are ready. We put together a few packages for you to look over.',
    'Pick the one you like and reserve your date with a deposit.',
    `Kindly reply by ${input.expiresLabel}.`,
  ]
  const button = 'See your event ideas'
  const phone = siteConfig.contactPhone
  const tail = phone ? [`Questions? Text us at ${phone}.`] : []
  const text = [
    hi, '',
    ...lines.flatMap((l) => [l, '']),
    `${button}  ${input.url}`, '',
    ...tail.flatMap((l) => [l, '']),
    `Hometown Studio · ${ADDRESS}`,
  ].join('\n')
  const P = 'margin:0 0 10px;font-size:15px;color:#3d3630;line-height:1.55'
  const html = `
<div style="max-width:560px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 12px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">Hometown Studio</p>
  <p style="${P}">${esc(hi)}</p>
  ${lines.map((l) => `<p style="${P}">${esc(l)}</p>`).join('\n  ')}
  <p style="margin:18px 0;"><a href="${esc(input.url)}" style="display:inline-block;background:#7a4a2e;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 22px;border-radius:999px;">${esc(button)}</a></p>
  ${tail.map((l) => `<p style="${P}">${esc(l)}</p>`).join('\n  ')}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:20px 0 10px;" />
  <p style="margin:0;font-size:12px;color:#6f635b;">Hometown Studio &middot; ${esc(ADDRESS)}</p>
</div>`
  return sendEmail({ to: input.to, subject: 'Your event ideas from Hometown Studio', html, text })
}
