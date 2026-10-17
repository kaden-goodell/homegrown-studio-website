/**
 * What the public forms (/teach, /private-events, /contact) share once a
 * submission has been checked: storage with its photos (Netlify Blobs in prod,
 * .data/ in dev), the owners' copy by email, and the sender's short "got it".
 * Each form keeps its own checks and its own words.
 */
import { randomUUID } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { sendEmail } from '@lib/email'
import { photoAttachments } from '@lib/form-photos'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('submissions')

export interface Submission<S extends string> {
  id: string
  at: string
  status: S
  statusAt?: string
  photos: number
}

/** "2026-10-17-abcdef12": the day it came in, then 8 random hex digits. */
const ID_RE = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/

/**
 * One form's submissions. `prefix` names each record's key ("app-<id>");
 * photos are kept beside it as "photo-<id>-<n>".
 */
export function submissionStore<S extends string, T extends Submission<S>>({ store, prefix, maxPhotos, statuses }: {
  store: string
  prefix: string
  maxPhotos: number
  statuses: readonly S[]
}) {
  const kv = makeKvStore(store, store)
  const key = (id: string) => `${prefix}-${id}`
  const photoKey = (id: string, n: number) => `photo-${id}-${n}`

  async function get(id: string): Promise<T | null> {
    if (!ID_RE.test(id)) return null
    const raw = await kv.get(key(id))
    return raw ? (JSON.parse(raw) as T) : null
  }

  return {
    async save(value: Omit<T, keyof Submission<S>>, photos: Buffer[] = [], now = new Date()): Promise<T> {
      const record = { ...value, id: `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`, at: now.toISOString(), status: statuses[0], photos: photos.length } as T
      // Photos first: a record never points at a photo that isn't there.
      for (let n = 0; n < photos.length; n++) await kv.set(photoKey(record.id, n), JSON.stringify(photos[n].toString('base64')))
      await kv.set(key(record.id), JSON.stringify(record))
      logger.info('Submission saved', { store, id: record.id, photos: photos.length })
      return record
    },

    /** Newest first. */
    async list(): Promise<T[]> {
      const keys = (await kv.list()).filter((k) => k.startsWith(`${prefix}-`))
      const all = await Promise.all(keys.map(async (k) => {
        const raw = await kv.get(k)
        return raw ? (JSON.parse(raw) as T) : null
      }))
      return all.filter((x): x is Awaited<T> => x !== null).sort((a, b) => b.at.localeCompare(a.at))
    },

    get,

    async getPhoto(id: string, n: number): Promise<Buffer | null> {
      if (!ID_RE.test(id) || !Number.isInteger(n) || n < 0 || n >= maxPhotos) return null
      const raw = await kv.get(photoKey(id, n))
      return raw ? Buffer.from(JSON.parse(raw) as string, 'base64') : null
    },

    async setStatus(id: string, status: S, now = new Date()): Promise<T | null> {
      const record = await get(id)
      if (!record || !statuses.includes(status)) return null
      const next = { ...record, status, statusAt: now.toISOString() }
      await kv.set(key(id), JSON.stringify(next))
      return next
    },
  }
}

/** One part of the owners' email: a heading and its answers. Blank answers are left out. */
export interface EmailSection {
  title: string
  rows: [string, string][]
}

/** The owners' email for one submission, written once and sent as both text and HTML. */
export interface OwnerEmail {
  /** Small label above the name: "Private event request". */
  kicker: string
  /** The person, and their business if they gave one. */
  title: string
  /** One line under the title: "Team building · Sat Nov 21 at 2:00 PM · 18 guests". */
  summary?: string
  person: { name: string; email: string; phone: string }
  sections: EmailSection[]
  /** "2 inspiration photos attached." */
  photosNote?: string
  adminUrl: string
  /** "All requests" */
  adminLabel: string
}

/** "Label\n  answer" for every answer given, in order. */
export function answerLines(lines: [string, string][]): string[] {
  return lines.filter(([, v]) => v).map(([k, v]) => `${k}\n  ${v.replace(/\n/g, '\n  ')}`)
}

const filled = (e: OwnerEmail) => e.sections.map((s) => ({ ...s, rows: s.rows.filter(([, v]) => v) })).filter((s) => s.rows.length > 0)

export function ownerEmailTextOf(e: OwnerEmail): string {
  return [
    e.kicker.toUpperCase(),
    e.title,
    ...(e.summary ? [e.summary] : []),
    '',
    ...answerLines([['Email', e.person.email], ['Phone', e.person.phone ? prettyPhone(e.person.phone) : '']]),
    ...filled(e).flatMap((s) => ['', s.title.toUpperCase(), ...answerLines(s.rows)]),
    '',
    ...(e.photosNote ? [e.photosNote] : []),
    'Hit Reply to answer them.',
    `${e.adminLabel}: ${e.adminUrl}`,
  ].join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const digitsOf = (phone: string) => phone.replace(/[^\d+]/g, '')
/** "4029802907" → "(402) 980-2907"; anything else as typed. */
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone
}

/**
 * The same email, laid out: who it is, one-tap Reply / Text / Call, then each
 * section as label and answer. Brand brown #7a4a2e; email-safe (inline styles,
 * tables, no CSS variables), and it reads on a phone.
 */
export function ownerEmailHtmlOf(e: OwnerEmail): string {
  const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const LABEL = 'margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#7a4a2e;font-weight:700;'
  const BUTTON = 'display:inline-block;margin:0 6px 8px 0;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;'
  const first = e.person.name.split(/\s+/)[0]
  const value = (v: string) => esc(v).replace(/\n/g, '<br />')
  const section = (s: EmailSection) => `
  <div style="margin:0 0 18px;padding:16px 18px;background:#ffffff;border:1px solid #eadfd4;border-radius:12px;">
    <p style="${LABEL}">${esc(s.title)}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      ${s.rows.map(([k, v]) => `<tr>
        <td valign="top" style="padding:6px 12px 6px 0;width:38%;font-size:13px;color:#6f635b;border-top:1px solid #f1ebe4;">${esc(k)}</td>
        <td valign="top" style="padding:6px 0;font-size:14px;color:#3d3229;border-top:1px solid #f1ebe4;line-height:1.45;word-break:break-word;overflow-wrap:anywhere;">${value(v)}</td>
      </tr>`).join('')}
    </table>
  </div>`
  return `
<div style="background:#faf8f5;padding:20px 12px;font-family:${FONT};">
  <div style="max-width:600px;margin:0 auto;">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a4a2e;font-weight:700;">${esc(e.kicker)}</p>
    <h1 style="margin:0 0 4px;font-size:22px;line-height:1.25;color:#3d3229;">${esc(e.title)}</h1>
    ${e.summary ? `<p style="margin:0 0 14px;font-size:15px;font-weight:600;color:#4a403a;">${esc(e.summary)}</p>` : ''}
    <div style="margin:0 0 6px;">
      <a href="mailto:${esc(e.person.email)}" style="${BUTTON}background:#7a4a2e;color:#ffffff;">Reply to ${esc(first)}</a>
      ${e.person.phone ? `<a href="sms:${esc(digitsOf(e.person.phone))}" style="${BUTTON}background:#ffffff;color:#7a4a2e;border:1px solid #7a4a2e;">Text</a>
      <a href="tel:${esc(digitsOf(e.person.phone))}" style="${BUTTON}background:#ffffff;color:#7a4a2e;border:1px solid #7a4a2e;">Call</a>` : ''}
    </div>
    <p style="margin:0 0 18px;font-size:13px;color:#6f635b;word-break:break-word;">${esc(e.person.email)}${e.person.phone ? ` &middot; ${esc(prettyPhone(e.person.phone))}` : ''}</p>
    ${filled(e).map(section).join('')}
    ${e.photosNote ? `<p style="margin:0 0 14px;font-size:13px;color:#6f635b;">&#128206; ${esc(e.photosNote)}</p>` : ''}
    <a href="${esc(e.adminUrl)}" style="${BUTTON}background:#3d3229;color:#ffffff;">Open in admin &rarr;</a>
    <p style="margin:14px 0 0;font-size:12px;color:#6f635b;">Hit Reply to answer them. Hometown Studio &middot; ${esc(e.adminLabel)} live at ${esc(e.adminUrl.replace(/^https?:\/\//, ''))}</p>
  </div>
</div>`
}

/**
 * Every owner gets the email (photos attached); Reply goes to the person who
 * sent it. True when at least one went.
 */
export async function emailOwnersCopy({ subject, email, photos = [] }: { subject: string; email: OwnerEmail; photos?: Buffer[] }): Promise<boolean> {
  const text = ownerEmailTextOf(email)
  const html = ownerEmailHtmlOf(email)
  const attachments = photoAttachments(photos)
  const replyTo = email.person.email
  const sent = await Promise.all(siteConfig.ownerEmails.map((to) => sendEmail({ to, subject, text, html, attachments, replyTo }).then((x) => x.sent).catch(() => false)))
  return sent.some(Boolean)
}

/** The sender's copy: short, and no promised timeline (Kaden). */
export async function emailGotIt({ to, name, subject }: { to: string; name: string; subject: string }): Promise<boolean> {
  const first = name.split(/\s+/)[0]
  const text = [
    `Hi ${first},`,
    '',
    'Thanks, we got it. We’ll be in touch.',
    '',
    'Hometown Studio',
    '525 Hughes Rd, Suite F, Madison, AL 35758',
  ].join('\n')
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#3d3630;line-height:1.55;max-width:520px">
  <p>Hi ${first.replace(/[<>&]/g, '')},</p><p>Thanks, we got it. We’ll be in touch.</p>
  <p style="font-size:12px;color:#6f635b">Hometown Studio &middot; 525 Hughes Rd, Suite F, Madison, AL 35758</p></div>`
  return (await sendEmail({ to, subject, text, html }).catch(() => ({ sent: false }))).sent
}
