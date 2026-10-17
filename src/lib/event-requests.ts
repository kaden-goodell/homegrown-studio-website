/**
 * Private event requests (/private-events, Kaden 17 Oct 2026): a day or time
 * we're not normally open, at the studio or at the customer's place. Priced by
 * the event, so this is a request, not a booking.
 *
 * A request is checked here, stored with any inspiration photos (Netlify Blobs
 * in prod, .data/ in dev), emailed to the owners with the photos attached, and
 * listed on the owner-only /admin page with a status the owners set.
 */
import { decodePhotos } from '@lib/form-photos'
import { submissionStore, answerLines, emailOwnersCopy, emailGotIt } from '@lib/submissions'
import { studioDate, formatCalendarDay } from '@lib/studio-time'
import {
  MAX_PHOTOS, MAX_GUESTS, KINDS, CRAFTERS, PLACES, SETTINGS, YES_NO, CRAFT_PICKS, EXTRAS, EXTRA_CHOICES, BUDGETS, CONTACT_BY, STATUSES, STATUS_LABEL,
  type ExtraKey, type RequestStatus, type Values, type EventRequest,
  label, clock12, kindLabel, whenLabel, crafterLabel, extrasLines,
} from '@lib/event-request-options'


export { MAX_PHOTOS, MAX_GUESTS, KINDS, CRAFTERS, PLACES, SETTINGS, YES_NO, CRAFT_PICKS, EXTRAS, EXTRA_CHOICES, BUDGETS, CONTACT_BY, STATUSES, STATUS_LABEL }
export { clock12, kindLabel, whenLabel, crafterLabel, extrasLines }
export type { ExtraKey, RequestStatus, EventRequest }

type NewRequest = Omit<EventRequest, 'id' | 'at' | 'status' | 'photos'>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const oneOf = <T extends readonly (readonly [string, string])[]>(v: unknown, list: T): Values<T> | '' =>
  (list.some(([k]) => k === v) ? (v as Values<T>) : '')

/** A real calendar day, written YYYY-MM-DD. */
function realDay(ymd: string): boolean {
  if (!YMD_RE.test(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export type Checked =
  | { ok: true; value: NewRequest; photos: Buffer[] }
  | { ok: false; field: string; error: string }

/**
 * Read what the form sent. Required: the date, how many guests, where, and
 * name, email and phone (plus the address when it's at their place).
 * Problems come back top to bottom, in the form's order.
 */
export function checkRequest(body: any, now = new Date()): Checked {
  const today = studioDate(now.toISOString())
  const e = body?.event ?? {}
  const date = str(e.date, 10)
  if (!realDay(date)) return { ok: false, field: 'date', error: 'Pick a date.' }
  if (date < today) return { ok: false, field: 'date', error: 'That date has already passed.' }
  const backupDate = str(e.backupDate, 10)
  // The first number they typed: "about 25" is 25, "20 to 25" is 20.
  const guestsRaw = /\d{1,6}/.exec(String(e.guests ?? ''))?.[0] ?? ''
  const guests = Number(guestsRaw)
  if (!guestsRaw || guests < 1) return { ok: false, field: 'guests', error: 'About how many guests? A rough number is fine.' }
  if (guests > MAX_GUESTS) return { ok: false, field: 'guests', error: `For more than ${MAX_GUESTS}, put a rough number here and tell us more in the notes.` }

  const w = body?.where ?? {}
  const place = oneOf(w.place, PLACES)
  if (!place) return { ok: false, field: 'place', error: 'Pick where the event is.' }
  const address = place === 'yours' ? str(w.address, 300) : ''
  if (place === 'yours' && !address) return { ok: false, field: 'address', error: 'Add the address, so we can plan the trip.' }

  const a = body?.about ?? {}
  const about = {
    name: str(a.name, 80),
    email: str(a.email, 160),
    phone: str(a.phone, 30),
    org: str(a.org, 120),
    contactBy: oneOf(a.contactBy, CONTACT_BY),
    heard: str(a.heard, 200),
  }
  if (!about.name) return { ok: false, field: 'name', error: 'Add your name.' }
  if (!EMAIL_RE.test(about.email)) return { ok: false, field: 'email', error: 'That email doesn’t look right. Check for typos.' }
  const digits = about.phone.replace(/\D/g, '')
  if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith('1')))) {
    return { ok: false, field: 'phone', error: 'Add a 10-digit phone number.' }
  }

  const decoded = decodePhotos(body?.photos, MAX_PHOTOS)
  if (!decoded.ok) return { ok: false, field: 'photos', error: decoded.error }

  const x = body?.extras ?? {}
  const c = body?.craft ?? {}
  const startTime = str(e.startTime, 5)
  return {
    ok: true,
    photos: decoded.photos,
    value: {
      event: {
        kind: oneOf(e.kind, KINDS),
        kindOther: e.kind === 'other' ? str(e.kindOther, 120) : '',
        date,
        backupDate: realDay(backupDate) && backupDate >= today ? backupDate : '',
        flexible: e.flexible === true,
        startTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) ? startTime : '',
        length: str(e.length, 40),
        guests,
        crafters: oneOf(e.crafters, CRAFTERS),
        youngest: e.crafters === 'kids' || e.crafters === 'both' ? str(String(e.youngest ?? ''), 3).replace(/[^\d]/g, '') : '',
      },
      where: {
        place,
        address,
        setting: place === 'yours' ? oneOf(w.setting, SETTINGS) : '',
        tables: place === 'yours' ? oneOf(w.tables, YES_NO) : '',
        sink: place === 'yours' ? oneOf(w.sink, YES_NO) : '',
        setupFrom: place === 'yours' ? str(w.setupFrom, 80) : '',
        access: place === 'yours' ? str(w.access, 300) : '',
      },
      craft: {
        pick: oneOf(c.pick, CRAFT_PICKS),
        vision: str(c.vision, 2000),
        theme: str(c.theme, 200),
        personalized: str(c.personalized, 300),
        link: str(c.link, 300),
      },
      extras: Object.fromEntries(EXTRAS.map(([k]) => [k, oneOf(x[k], EXTRA_CHOICES)])) as EventRequest['extras'],
      allergies: str(body?.allergies, 400),
      budget: oneOf(body?.budget, BUDGETS),
      about,
      notes: str(body?.notes, 2000),
    },
  }
}

const store = submissionStore<RequestStatus, EventRequest>({ store: 'event-requests', prefix: 'req', maxPhotos: MAX_PHOTOS, statuses: STATUSES })

export const saveRequest = (value: NewRequest, photos: Buffer[], now = new Date()) => store.save(value, photos, now)
export const listRequests = () => store.list()
export const getRequest = (id: string) => store.get(id)
export const getRequestPhoto = (id: string, n: number) => store.getPhoto(id, n)
export const setRequestStatus = (id: string, status: RequestStatus, now = new Date()) => store.setStatus(id, status, now)

// ── Words for the owners ────────────────────────────────────────────────────

/** The owners' email: every answer, in the form's order, blanks left out. */
export function ownerEmailText(r: EventRequest, adminUrl: string): string {
  const e = r.event
  const w = r.where
  const c = r.craft
  const lines: [string, string][] = [
    ['Name', r.about.name], ['Email', r.about.email], ['Phone', r.about.phone], ['Business, school or church', r.about.org],
    ['Best way to reach them', label(CONTACT_BY, r.about.contactBy)],
    ['Kind of event', kindLabel(r)],
    ['Date', whenLabel(r)],
    ['Backup date', e.backupDate ? formatCalendarDay(e.backupDate) : ''],
    ['Flexible on the date', e.flexible ? 'Yes' : ''],
    ['How long', e.length],
    ['Guests', String(e.guests)],
    ['Who’s crafting', crafterLabel(r)],
    ['Where', label(PLACES, w.place)],
    ['Address', w.address],
    ['Indoors or outdoors', label(SETTINGS, w.setting)],
    ['Tables and chairs there', label(YES_NO, w.tables)],
    ['Sink nearby', label(YES_NO, w.sink)],
    ['Can set up from', w.setupFrom],
    ['Getting in', w.access],
    ['Craft', label(CRAFT_PICKS, c.pick)],
    ['Their vision', c.vision],
    ['Theme or colors', c.theme],
    ['Personalized', c.personalized],
    ['Inspiration link', c.link],
    ...extrasLines(r),
    ['Food allergies', r.allergies],
    ['Budget', label(BUDGETS, r.budget)],
    ['How they heard about us', r.about.heard],
    ['Anything else', r.notes],
  ]
  return [
    ...answerLines(lines),
    '',
    ...(r.photos ? [`${r.photos} inspiration photo${r.photos === 1 ? '' : 's'} attached.`] : []),
    `All requests: ${adminUrl}`,
  ].join('\n')
}

/** The owners' text: who, what, when, how many, where. */
export function ownerText(r: EventRequest, adminUrl: string): string {
  const what = kindLabel(r)
  return `New private event request: ${r.about.name}${what ? `, ${what.toLowerCase()}` : ''}, ${whenLabel(r)}, ${r.event.guests} guest${r.event.guests === 1 ? '' : 's'}, ${r.where.place === 'yours' ? 'at their place' : 'at the studio'}. Details in your email and at ${adminUrl.replace(/^https?:\/\//, '')}.`
}

export function emailOwners(r: EventRequest, photos: Buffer[], adminUrl: string): Promise<boolean> {
  return emailOwnersCopy({ subject: `Private event: ${r.about.name}, ${whenLabel(r)}`, text: ownerEmailText(r, adminUrl), photos, replyTo: r.about.email })
}

/** The customer's copy: short, and no promised timeline (Kaden). */
export function emailCustomer(r: EventRequest): Promise<boolean> {
  return emailGotIt({ to: r.about.email, name: r.about.name, subject: 'Your private event request at Hometown Studio' })
}
