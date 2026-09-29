/**
 * Pure builders for the emails sent on signing / RSVP — split out of
 * `@lib/email` so subject/body assembly is testable without SMTP.
 *
 *  - `buildAgreementCopy` (HOM-216): the signer's "here's your copy" with the
 *    full agreement text (the drop-off terms are §4b of it).
 *  - `buildDropOffDetails`: sent after any RSVP to a drop-off event — when,
 *    the pickup-code rule, authorized pickups, the posted late fee.
 *
 * Both include the studio's contact info in the footer.
 */
import { waiverContent, serializeAgreement, type WaiverSection } from '@config/waiver-content'
import { lateFeeLine } from '@config/dropoff.config'
import { siteConfig } from '@config/site.config'
import { formatCalendarDate, formatWhen } from '@lib/studio-time'
import type { WaiverRecord } from '@lib/waiver-store'
import type { StudioEvent } from '@lib/events'

export interface BuildAgreementCopyInput {
  record: WaiverRecord
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function ageFromDob(dob: string, now: Date): number {
  const d = new Date(`${dob}T00:00:00`)
  let years = now.getFullYear() - d.getFullYear()
  const anniversary = new Date(d)
  anniversary.setFullYear(now.getFullYear())
  if (now < anniversary) years--
  return years
}

const P = 'margin:0 0 8px;font-size:14px;color:#3d3630;line-height:1.55'
const MUTED = 'margin:0 0 8px;font-size:12px;color:#8a7f75;line-height:1.5'
const EYEBROW = 'margin:0 0 2px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7a4a2e;font-weight:700'

function renderSectionsHtml(sections: WaiverSection[]): string {
  return sections
    .map(
      (s) => `
  <h3 style="font-size:14px;font-weight:700;color:#3d3630;margin:16px 0 4px;">${esc(s.heading)}</h3>
  ${s.body.map((p) => `<p style="${P}">${esc(p)}</p>`).join('')}`,
    )
    .join('')
}

/** "Alice Test" (signer) and every minor with their age, e.g. "Bobby Test (7)". */
function coveredList(record: WaiverRecord, now: Date): { name: string; age?: number }[] {
  return [
    { name: `${record.adult.firstName} ${record.adult.lastName}`.trim() },
    ...record.minors.map((m) => ({ name: m.name, age: ageFromDob(m.dob, now) })),
  ]
}

const footerText = () =>
  `Keep this email — it's your copy. Questions: ${siteConfig.contactEmail} / ${siteConfig.contactPhone}.`

export function buildAgreementCopy(input: BuildAgreementCopyInput): { subject: string; html: string; text: string } {
  const { record } = input
  const now = new Date()
  const firstName = record.adult.firstName

  const signedDate = formatCalendarDate(record.signedAt)
  const validDate = formatCalendarDate(record.validUntil)
  const subject = 'Your Hometown Studio participation agreement'
  const covered = coveredList(record, now)
  const coveredHtml = covered
    .map((c) => `<p style="margin:0 0 3px;font-size:14px;color:#3d3630;">${esc(c.name)}${c.age != null ? ` (${c.age})` : ''}</p>`)
    .join('')
  const coveredText = covered.map((c) => `  • ${c.name}${c.age != null ? ` (${c.age})` : ''}`).join('\n')

  const html = `
<div style="max-width:600px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="${EYEBROW}">Hometown Studio</p>
  <h1 style="margin:0 0 10px;font-size:20px;color:#3d3630;">Your participation agreement</h1>
  <p style="${P}">Hi ${esc(firstName)}, here's your copy to keep.</p>
  <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7a4a2e;">This covers</p>
  ${coveredHtml}
  <p style="${P}">Signed ${esc(signedDate)} &middot; Valid through ${esc(validDate)} &middot; Agreement ${esc(record.agreementVersion)}</p>
  ${renderSectionsHtml(waiverContent.legalSections)}
  <p style="${MUTED}">Record ID ${esc(record.id)}</p>
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:18px 0 10px;" />
  <p style="${MUTED}">${esc(footerText())}</p>
</div>`

  const text = [
    `Your participation agreement`,
    `Hi ${firstName}, here's your copy to keep.`,
    ``,
    `This covers:`,
    coveredText,
    ``,
    `Signed ${signedDate} · Valid through ${validDate} · Agreement ${record.agreementVersion}`,
    ``,
    serializeAgreement(),
    ``,
    `Record ID ${record.id}`,
    ``,
    footerText(),
  ].join('\n')

  return { subject, html, text }
}

export interface BuildDropOffDetailsInput {
  record: WaiverRecord
  event: StudioEvent
  /** Person ids ('adult' | 'child:N') actually attending; null/absent = everyone. */
  attending?: string[] | null
  /** Authorized pickup names given on THIS RSVP (returning path), else the signature's. */
  authorizedPickup?: { name: string; phone?: string }[]
}

/** "Drop-off details" — sent after any RSVP to a drop-off event. */
export function buildDropOffDetails(input: BuildDropOffDetailsInput): { subject: string; html: string; text: string } {
  const { record, event } = input
  const attending = input.attending ?? null
  const kids = record.minors
    .filter((_, i) => !attending || attending.includes(`child:${i}`))
    .map((m) => m.name.split(' ')[0])
  const kidsLabel = kids.length === 0 ? 'your child' : kids.length === 1 ? kids[0] : `${kids.slice(0, -1).join(', ')} and ${kids[kids.length - 1]}`
  const digits = record.adult.phone.replace(/\D/g, '')
  const phoneHint = digits.length >= 2 ? `••${digits.slice(-2)}` : 'your phone'
  const pickups = (input.authorizedPickup ?? record.authorizedPickup).map((p) => p.name).filter(Boolean)
  const signedDate = formatCalendarDate(record.signedAt)

  const lines = [
    `When: ${formatWhen(event.startIso)}`,
    'Check your child in with our crew at the door.',
    `We'll text a pickup code to the phone ending ${phoneHint} at drop-off. Whoever collects ${kidsLabel} needs that code, and photo ID if we don't know them.`,
    ...(pickups.length ? [`Authorized pickup: ${pickups.join(', ')}.`] : []),
    lateFeeLine(),
    "We don't give medication.",
    `These terms are Section 4b of the participation agreement you signed on ${signedDate}.`,
  ]

  const subject = `Drop-off details for ${event.title}`
  const html = `
<div style="max-width:600px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="${EYEBROW}">Hometown Studio</p>
  <h1 style="margin:0 0 10px;font-size:20px;color:#3d3630;">${esc(subject)}</h1>
  <p style="${P}">Hi ${esc(record.adult.firstName)},</p>
  ${lines.map((l) => `<p style="${P}">${esc(l)}</p>`).join('\n  ')}
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:18px 0 10px;" />
  <p style="${MUTED}">${esc(footerText())}</p>
</div>`
  const text = [`Hi ${record.adult.firstName},`, '', ...lines, '', footerText()].join('\n')
  return { subject, html, text }
}
