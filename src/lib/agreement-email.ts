/**
 * Pure builder for the "here's your copy" email sent on signing (HOM-216) —
 * split out of `@lib/email` so the subject/body assembly is testable without
 * SMTP. `@lib/email`'s `sendAgreementCopyEmail` is the thin wrapper that
 * calls `sendEmail` with what this returns.
 *
 * Two shapes, driven by `returning`:
 *  - Fresh signature (`returning` unset/false): full agreement text, always;
 *    the Drop-off Program Addendum text too when one was accepted at signing.
 *  - Returning-household RSVP that just accepted the addendum for the first
 *    time (`returning: true`): addendum text ONLY — the base agreement is
 *    unchanged and already on file, so it isn't re-sent.
 *
 * Always includes the record id (so a signer can quote it if they ever ask
 * for the original) and the studio's contact info in the footer.
 */
import { waiverContent, serializeAgreement, dropOffAddendum, serializeAddendum, type WaiverSection } from '@config/waiver-content'
import { siteConfig } from '@config/site.config'
import { formatCalendarDate } from '@lib/studio-time'
import type { WaiverRecord } from '@lib/waiver-store'
import type { StudioEvent } from '@lib/events'

export interface AgreementCopyAddendum {
  /** `dropOffAddendum.version` at acceptance time. */
  version: string
  /** When the addendum was accepted — the signature's `signedAt` on a fresh
   *  sign, or the RSVP's `at` on a returning re-affirmation. */
  acceptedAt: string
}

export interface BuildAgreementCopyInput {
  record: WaiverRecord
  /** Present when a Drop-off Program Addendum was accepted alongside this
   *  signature/RSVP. `null`/absent when none was required. */
  addendum?: AgreementCopyAddendum | null
  /** The party/workshop this signature or RSVP is tied to, when any —
   *  needed for "Accepted {date} for {event title}" and the returning-only
   *  addendum subject. */
  event?: StudioEvent | null
  /** True for a returning household's RSVP that just accepted the addendum
   *  — sends the addendum text only (see module doc). Never set when
   *  `addendum` is absent; callers only send this email on the returning
   *  path when an addendum was accepted. */
  returning?: boolean
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
  const { record, addendum, event, returning } = input
  const now = new Date()
  const firstName = record.adult.firstName
  const eventTitle = event?.title ?? 'your visit'

  if (returning && addendum) {
    // Returning-household RSVP that just accepted the addendum: addendum
    // text only — the base agreement is unchanged and already on file.
    const acceptedDate = formatCalendarDate(addendum.acceptedAt)
    const signedDate = formatCalendarDate(record.signedAt)
    const subject = `Your Drop-off Addendum for ${eventTitle}`
    const unchangedLine = `Your participation agreement signed ${signedDate} is unchanged.`

    const html = `
<div style="max-width:600px;margin:0 auto;padding:8px 4px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <p style="${EYEBROW}">Hometown Studio</p>
  <h1 style="margin:0 0 10px;font-size:20px;color:#3d3630;">${esc(dropOffAddendum.title)}</h1>
  <p style="${P}">Hi ${esc(firstName)},</p>
  <p style="${P}">Accepted ${esc(acceptedDate)} for ${esc(eventTitle)} &middot; Addendum ${esc(addendum.version)}</p>
  ${renderSectionsHtml(dropOffAddendum.sections)}
  <p style="${P}"><strong>${esc(unchangedLine)}</strong></p>
  <p style="${MUTED}">Record ID ${esc(record.id)}</p>
  <hr style="border:none;border-top:1px solid #e8e0d8;margin:18px 0 10px;" />
  <p style="${MUTED}">${esc(footerText())}</p>
</div>`

    const text = [
      `${dropOffAddendum.title}`,
      `Hi ${firstName},`,
      ``,
      `Accepted ${acceptedDate} for ${eventTitle} · Addendum ${addendum.version}`,
      ``,
      serializeAddendum(),
      ``,
      unchangedLine,
      ``,
      `Record ID ${record.id}`,
      ``,
      footerText(),
    ].join('\n')

    return { subject, html, text }
  }

  // Fresh signature: full agreement text, always; addendum text too when one
  // was accepted at signing.
  const signedDate = formatCalendarDate(record.signedAt)
  const validDate = formatCalendarDate(record.validUntil)
  const subject = addendum
    ? 'Your Hometown Studio participation agreement + Drop-off Addendum'
    : 'Your Hometown Studio participation agreement'
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
  ${
    addendum
      ? `<h2 style="font-size:16px;font-weight:700;color:#3d3630;margin:22px 0 4px;">${esc(dropOffAddendum.title)}</h2>
  <p style="${P}">Accepted ${esc(formatCalendarDate(addendum.acceptedAt))} for ${esc(eventTitle)} &middot; Addendum ${esc(addendum.version)}</p>
  ${renderSectionsHtml(dropOffAddendum.sections)}`
      : ''
  }
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
    ...(addendum
      ? [
          ``,
          dropOffAddendum.title,
          `Accepted ${formatCalendarDate(addendum.acceptedAt)} for ${eventTitle} · Addendum ${addendum.version}`,
          ``,
          serializeAddendum(),
        ]
      : []),
    ``,
    `Record ID ${record.id}`,
    ``,
    footerText(),
  ].join('\n')

  return { subject, html, text }
}
