/**
 * Outside artists asking to teach a class (/teach, Kaden 15 Oct 2026).
 *
 * An application is checked here, stored with its photos (Netlify Blobs in
 * prod, .data/ in dev), emailed to the owners with the photos attached, and
 * listed on the owner-only /admin page with a status the owners set.
 */
import { randomUUID } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { sendEmail } from '@lib/email'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('artist-applications')
const kv = makeKvStore('artist-applications', 'artist-applications')

export const MAX_PHOTOS = 6
/** Per photo, after the phone has shrunk it (about 1600px JPEG). */
export const MAX_PHOTO_BYTES = 1_200_000
export const STATUSES = ['new', 'talking', 'booked', 'not-now'] as const
export type ApplicationStatus = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<ApplicationStatus, string> = { new: 'New', talking: 'Talking', booked: 'Booked', 'not-now': 'Not now' }

export interface ArtistApplication {
  id: string
  at: string
  status: ApplicationStatus
  statusAt?: string
  about: { name: string; business: string; email: string; phone: string; city: string }
  links: { instagram: string; website: string; tiktok: string; etsy: string; video: string }
  classIdea: {
    what: string
    takeHome: string
    audience: 'kids' | 'adults' | 'both' | ''
    dropOffOk: 'yes' | 'no' | ''
    length: string
    groupMin: string
    groupMax: string
    price: string
    suppliesCost: string
    needs: string
  }
  experience: string
  when: { days: string; howOften: 'one-time' | 'monthly' | 'series' | '' }
  photos: number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | '' => (allowed.includes(v as T) ? (v as T) : '')

export type Checked =
  | { ok: true; value: Omit<ArtistApplication, 'id' | 'at' | 'status' | 'photos'>; photos: Buffer[] }
  | { ok: false; field: string; error: string }

/** Read what the form sent. Only name, email, phone, the class idea and one photo are required. */
export function checkApplication(body: any): Checked {
  const about = {
    name: str(body?.about?.name, 80),
    business: str(body?.about?.business, 120),
    email: str(body?.about?.email, 160),
    phone: str(body?.about?.phone, 30),
    city: str(body?.about?.city, 80),
  }
  if (!about.name) return { ok: false, field: 'name', error: 'Add your name.' }
  if (!EMAIL_RE.test(about.email)) return { ok: false, field: 'email', error: 'That email doesn’t look right. Check for typos.' }
  const digits = about.phone.replace(/\D/g, '')
  if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) {
    return { ok: false, field: 'phone', error: 'Add a 10-digit phone number.' }
  }
  const classIdea = {
    what: str(body?.classIdea?.what, 1500),
    takeHome: str(body?.classIdea?.takeHome, 300),
    audience: oneOf(body?.classIdea?.audience, ['kids', 'adults', 'both'] as const),
    dropOffOk: oneOf(body?.classIdea?.dropOffOk, ['yes', 'no'] as const),
    length: str(body?.classIdea?.length, 40),
    groupMin: str(body?.classIdea?.groupMin, 10),
    groupMax: str(body?.classIdea?.groupMax, 10),
    price: str(body?.classIdea?.price, 40),
    suppliesCost: str(body?.classIdea?.suppliesCost, 40),
    needs: str(body?.classIdea?.needs, 800),
  }
  if (!classIdea.what) return { ok: false, field: 'what', error: 'Tell us what you’d teach.' }

  const raw: unknown[] = Array.isArray(body?.photos) ? body.photos : []
  if (raw.length === 0) return { ok: false, field: 'photos', error: 'Add at least one photo of your work.' }
  if (raw.length > MAX_PHOTOS) return { ok: false, field: 'photos', error: `Up to ${MAX_PHOTOS} photos.` }
  const photos: Buffer[] = []
  for (const p of raw) {
    const m = typeof p === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p) : null
    if (!m) return { ok: false, field: 'photos', error: 'One of the photos couldn’t be read. Try a different one.' }
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return { ok: false, field: 'photos', error: 'One of the photos is too large. Try a different one.' }
    photos.push(bytes)
  }

  return {
    ok: true,
    photos,
    value: {
      about,
      links: {
        instagram: str(body?.links?.instagram, 200),
        website: str(body?.links?.website, 200),
        tiktok: str(body?.links?.tiktok, 200),
        etsy: str(body?.links?.etsy, 200),
        video: str(body?.links?.video, 300),
      },
      classIdea,
      experience: str(body?.experience, 1500),
      when: { days: str(body?.when?.days, 400), howOften: oneOf(body?.when?.howOften, ['one-time', 'monthly', 'series'] as const) },
    },
  }
}

const appKey = (id: string) => `app-${id}`
const photoKey = (id: string, n: number) => `photo-${id}-${n}`

export async function saveApplication(value: Omit<ArtistApplication, 'id' | 'at' | 'status' | 'photos'>, photos: Buffer[], now = new Date()): Promise<ArtistApplication> {
  const app: ArtistApplication = { ...value, id: `${now.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`, at: now.toISOString(), status: 'new', photos: photos.length }
  // Photos first: an application never points at a photo that isn't there.
  for (let n = 0; n < photos.length; n++) await kv.set(photoKey(app.id, n), JSON.stringify(photos[n].toString('base64')))
  await kv.set(appKey(app.id), JSON.stringify(app))
  logger.info('Artist application saved', { id: app.id, photos: photos.length })
  return app
}

export async function listApplications(): Promise<ArtistApplication[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith('app-'))
  const apps = await Promise.all(keys.map(async (k) => {
    const raw = await kv.get(k)
    return raw ? (JSON.parse(raw) as ArtistApplication) : null
  }))
  return apps.filter((a): a is ArtistApplication => a !== null).sort((a, b) => b.at.localeCompare(a.at))
}

export async function getApplication(id: string): Promise<ArtistApplication | null> {
  if (!/^[0-9-]{10}-[0-9a-f]{8}$/.test(id)) return null
  const raw = await kv.get(appKey(id))
  return raw ? (JSON.parse(raw) as ArtistApplication) : null
}

export async function getApplicationPhoto(id: string, n: number): Promise<Buffer | null> {
  if (!/^[0-9-]{10}-[0-9a-f]{8}$/.test(id) || !Number.isInteger(n) || n < 0 || n >= MAX_PHOTOS) return null
  const raw = await kv.get(photoKey(id, n))
  return raw ? Buffer.from(JSON.parse(raw) as string, 'base64') : null
}

export async function setApplicationStatus(id: string, status: ApplicationStatus, now = new Date()): Promise<ArtistApplication | null> {
  const app = await getApplication(id)
  if (!app || !STATUSES.includes(status)) return null
  const next = { ...app, status, statusAt: now.toISOString() }
  await kv.set(appKey(id), JSON.stringify(next))
  return next
}

const AUDIENCE: Record<string, string> = { kids: 'Kids & teens', adults: 'Adults', both: 'Both' }
const OFTEN: Record<string, string> = { 'one-time': 'One-time', monthly: 'Monthly', series: 'A series' }

/** The owners' email: every answer, in the form's order, blanks left out. */
export function ownerEmailText(app: ArtistApplication, adminUrl: string): string {
  const c = app.classIdea
  const lines: [string, string][] = [
    ['Name', app.about.name], ['Business', app.about.business], ['Email', app.about.email], ['Phone', app.about.phone], ['City', app.about.city],
    ['Instagram', app.links.instagram], ['Website', app.links.website], ['TikTok', app.links.tiktok], ['Etsy', app.links.etsy], ['Video', app.links.video],
    ['Class idea', c.what], ['Takes home', c.takeHome], ['For', AUDIENCE[c.audience] ?? ''], ['Drop-off OK', c.dropOffOk === 'yes' ? 'Yes' : c.dropOffOk === 'no' ? 'No' : ''],
    ['Length', c.length], ['Group size', [c.groupMin, c.groupMax].filter(Boolean).join(' to ')], ['Price per person', c.price], ['Supplies per person', c.suppliesCost],
    ['Needs from us', c.needs], ['Teaching experience', app.experience], ['Days and times', app.when.days], ['How often', OFTEN[app.when.howOften] ?? ''],
  ]
  return [
    ...lines.filter(([, v]) => v).map(([k, v]) => `${k}\n  ${v.replace(/\n/g, '\n  ')}`),
    '',
    `${app.photos} photo${app.photos === 1 ? '' : 's'} attached.`,
    `All applications: ${adminUrl}`,
  ].join('\n')
}

export async function emailOwners(app: ArtistApplication, photos: Buffer[], adminUrl: string): Promise<boolean> {
  const text = ownerEmailText(app, adminUrl)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = `<pre style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(text)}</pre>`
  const subject = `Teach a class: ${app.about.name}${app.about.business ? ` (${app.about.business})` : ''}`
  const attachments = photos.map((p, n) => ({ filename: `photo-${n + 1}.jpg`, content: p.toString('base64'), contentType: 'image/jpeg', encoding: 'base64' }))
  const sent = await Promise.all(siteConfig.ownerEmails.map((to) => sendEmail({ to, subject, text, html, attachments }).then((r) => r.sent).catch(() => false)))
  return sent.some(Boolean)
}

/** The artist's copy: short, and no promised timeline (Kaden). */
export async function emailArtist(app: ArtistApplication): Promise<boolean> {
  const first = app.about.name.split(/\s+/)[0]
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
  return (await sendEmail({ to: app.about.email, subject: 'Thanks for wanting to teach at Hometown Studio', text, html }).catch(() => ({ sent: false }))).sent
}
