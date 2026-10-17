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

/** "Label\n  answer" for every answer given, in order. */
export function answerLines(lines: [string, string][]): string[] {
  return lines.filter(([, v]) => v).map(([k, v]) => `${k}\n  ${v.replace(/\n/g, '\n  ')}`)
}

/**
 * Every owner gets the plain-text copy (photos attached); Reply goes to
 * `replyTo`, the person who sent it. True when at least one went.
 */
export async function emailOwnersCopy({ subject, text, photos = [], replyTo }: { subject: string; text: string; photos?: Buffer[]; replyTo?: string }): Promise<boolean> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<pre style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(text)}</pre>`
  const attachments = photoAttachments(photos)
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
