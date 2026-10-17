/**
 * Outside artists asking to teach a class (/teach, Kaden 15 Oct 2026).
 *
 * An application is checked here, stored with its photos (Netlify Blobs in
 * prod, .data/ in dev), emailed to the owners with the photos attached, and
 * listed on the owner-only /admin page with a status the owners set.
 */
import { decodePhotos, MAX_PHOTO_BYTES } from '@lib/form-photos'
import { submissionStore, ownerEmailTextOf, emailOwnersCopy, emailGotIt, type OwnerEmail } from '@lib/submissions'

export const MAX_PHOTOS = 6
export { MAX_PHOTO_BYTES }
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

  const decoded = decodePhotos(body?.photos, MAX_PHOTOS, { required: true })
  if (!decoded.ok) return { ok: false, field: 'photos', error: decoded.error }
  const photos = decoded.photos

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

const store = submissionStore<ApplicationStatus, ArtistApplication>({ store: 'artist-applications', prefix: 'app', maxPhotos: MAX_PHOTOS, statuses: STATUSES })

export const saveApplication = (value: Omit<ArtistApplication, 'id' | 'at' | 'status' | 'photos'>, photos: Buffer[], now = new Date()) => store.save(value, photos, now)
export const listApplications = () => store.list()
export const getApplication = (id: string) => store.get(id)
export const getApplicationPhoto = (id: string, n: number) => store.getPhoto(id, n)
export const setApplicationStatus = (id: string, status: ApplicationStatus, now = new Date()) => store.setStatus(id, status, now)

const AUDIENCE: Record<string, string> = { kids: 'Kids & teens', adults: 'Adults', both: 'Both' }
const OFTEN: Record<string, string> = { 'one-time': 'One-time', monthly: 'Monthly', series: 'A series' }

/** The owners' email: every answer, grouped like the form, blanks left out. */
export function ownerEmail(app: ArtistApplication, adminUrl: string): OwnerEmail {
  const c = app.classIdea
  const idea = c.what.replace(/\s+/g, ' ').trim()
  return {
    kicker: 'Teacher application',
    title: `${app.about.name}${app.about.business ? ` · ${app.about.business}` : ''}`,
    summary: idea.length > 90 ? `${idea.slice(0, 87).trimEnd()}…` : idea,
    person: { name: app.about.name, email: app.about.email, phone: app.about.phone },
    sections: [
      { title: 'About them', rows: [['City', app.about.city], ['Instagram', app.links.instagram], ['Website', app.links.website], ['TikTok', app.links.tiktok], ['Etsy', app.links.etsy]] },
      {
        title: 'The class',
        rows: [
          ['Class idea', c.what], ['Takes home', c.takeHome], ['For', AUDIENCE[c.audience] ?? ''], ['Drop-off OK', c.dropOffOk === 'yes' ? 'Yes' : c.dropOffOk === 'no' ? 'No' : ''],
          ['Length', c.length], ['Group size', [c.groupMin, c.groupMax].filter(Boolean).join(' to ')], ['Price per person', c.price], ['Supplies per person', c.suppliesCost],
          ['Needs from us', c.needs],
        ],
      },
      { title: 'Their work', rows: [['Video', app.links.video], ['Teaching experience', app.experience]] },
      { title: 'When', rows: [['Days and times', app.when.days], ['How often', OFTEN[app.when.howOften] ?? '']] },
    ],
    photosNote: `${app.photos} photo${app.photos === 1 ? '' : 's'} of their work attached.`,
    adminUrl,
    adminLabel: 'All applications',
  }
}

export const ownerEmailText = (app: ArtistApplication, adminUrl: string) => ownerEmailTextOf(ownerEmail(app, adminUrl))

export function emailOwners(app: ArtistApplication, photos: Buffer[], adminUrl: string): Promise<boolean> {
  const subject = `Teach a class: ${app.about.name}${app.about.business ? ` (${app.about.business})` : ''}`
  return emailOwnersCopy({ subject, email: ownerEmail(app, adminUrl), photos })
}

/** The artist's copy: short, and no promised timeline (Kaden). */
export function emailArtist(app: ArtistApplication): Promise<boolean> {
  return emailGotIt({ to: app.about.email, name: app.about.name, subject: 'Thanks for wanting to teach at Hometown Studio' })
}
