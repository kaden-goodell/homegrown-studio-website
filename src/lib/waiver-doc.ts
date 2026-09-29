/**
 * Pure generator for `docs/WAIVER.md` — the human-readable mirror of the
 * legal text customers actually sign (`src/config/waiver-content.ts`).
 *
 * `scripts/gen-waiver-doc.ts` writes this function's output to disk.
 * `tests/config/waiver-hashes.test.ts` asserts the file on disk still
 * equals it, so a hand edit to `docs/WAIVER.md` — or a `legalSections`
 * change that forgot to re-run `npm run gen:waiver` —
 * fails CI (HOM-219).
 *
 * Deliberately pure and deterministic: no dates, no randomness, nothing
 * but `waiver-content.ts` in, markdown out — that's what makes
 * `npm run gen:waiver` idempotent.
 */
import { createHash } from 'node:crypto'
import {
  waiverContent,
  serializeAgreement,
  type WaiverSection,
} from '@config/waiver-content'

const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

function renderSection(s: WaiverSection): string {
  return `### ${s.heading}\n\n${s.body.join('\n\n')}`
}

export function generateWaiverDoc(): string {
  const agreementHash = sha256(serializeAgreement())

  const parts: string[] = [
    '# Hometown Studio — Participation Agreement',
    '*Generated from `src/config/waiver-content.ts` — do not edit; run `npm run gen:waiver`.*',
    "Canonical text of the studio's liability waiver. The live copy is rendered by the app from " +
      '`src/config/waiver-content.ts` (the `/waiver` page and the booking flows) — this file is a ' +
      'generated, human-readable mirror of exactly that text. To change what customers sign, edit ' +
      'the config (bumping `version` on any change to `legalSections`) and run `npm run gen:waiver` ' +
      '— never edit this file by hand.',
    "Written to Alabama enforceability: the adult release names ordinary negligence expressly, is " +
      'conspicuous, and carves out willful/wanton conduct; minors are handled through parental ' +
      "indemnification (a parent cannot waive a child's own claims in Alabama — *J.T. v. Monster " +
      'Mountain*, 754 F. Supp. 2d 1323 (M.D. Ala. 2010)). Counsel review is tracked in HOM-98; see ' +
      '*For counsel* at the bottom.',
    `**Agreement version:** \`${waiverContent.version}\` · **SHA-256:** \`${agreementHash}\``,
    '---',
    ...waiverContent.legalSections.map(renderSection),
    '### Photo & media release (optional — does not affect participation)\n\n' +
      'Collected as a separate yes/no on the form: whether the Studio may use photos or video that ' +
      "include the signer's household (first names at most) on its website and social media.",
    '### Collected alongside the signature\n\n' +
      'Adult signer (name, DOB, email, phone) · each minor (name, DOB) · emergency contact (name, ' +
      'phone, relationship) · allergies/medical conditions · photo consent · typed-name signature · ' +
      'timestamp, IP, and agreement version hash (stored with each record).',
    '---',
    '## For counsel',
    ...waiverContent.counselNotes,
  ]

  return parts.join('\n\n') + '\n'
}
