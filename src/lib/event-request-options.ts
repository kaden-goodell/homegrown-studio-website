/**
 * The choices on the private event request form (/private-events). Client-safe:
 * the form, /admin and the server all read these, so a label changes in one place.
 */
import { formatCalendarDay } from '@lib/studio-time'

export const MAX_PHOTOS = 4
export const MAX_GUESTS = 500

export const KINDS = [
  ['birthday', 'Birthday'],
  ['team', 'Team building'],
  ['church', 'Church or youth group'],
  ['school', 'School or field trip'],
  ['scouts', 'Scouts'],
  ['shower', 'Shower'],
  ['reunion', 'Family reunion'],
  ['other', 'Something else'],
] as const
export const CRAFTERS = [['kids', 'Kids'], ['adults', 'Adults'], ['both', 'Both']] as const
export const PLACES = [['studio', 'At the studio'], ['yours', 'At your place']] as const
export const SETTINGS = [['indoors', 'Indoors'], ['outdoors', 'Outdoors']] as const
export const YES_NO = [['yes', 'Yes'], ['no', 'No']] as const
export const CRAFT_PICKS = [['ours', 'One of your crafts'], ['custom', 'Something custom'], ['unsure', 'Not sure, help us pick']] as const
export const EXTRAS = [
  ['food', 'Food'],
  ['drinks', 'Drinks'],
  ['dessert', 'Cake or dessert'],
  ['decor', 'Decorations or a theme setup'],
  ['tableware', 'Plates, cups and napkins'],
  ['favors', 'Party favors or goodie bags'],
] as const
/** Who handles an extra: the studio, the customer, or nobody. */
export const EXTRA_CHOICES = [['studio', 'Please provide'], ['guest', 'I’ll bring it'], ['none', 'Not needed']] as const
export const BUDGETS = [['under-1000', 'Under $1,000'], ['1000-2500', '$1,000 to $2,500'], ['2500-plus', '$2,500 or more']] as const
export const CONTACT_BY = [['text', 'Text'], ['call', 'Call'], ['email', 'Email']] as const

export type Values<T extends readonly (readonly [string, string])[]> = T[number][0]
export type ExtraKey = Values<typeof EXTRAS>

export const STATUSES = ['new', 'quoted', 'booked', 'not-now'] as const
export type RequestStatus = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<RequestStatus, string> = { new: 'New', quoted: 'Quoted', booked: 'Booked', 'not-now': 'Not this time' }

export interface EventRequest {
  id: string
  at: string
  status: RequestStatus
  statusAt?: string
  event: {
    kind: Values<typeof KINDS> | ''
    kindOther: string
    /** YYYY-MM-DD, studio calendar. */
    date: string
    backupDate: string
    flexible: boolean
    /** HH:MM, 24-hour. */
    startTime: string
    length: string
    guests: number
    crafters: Values<typeof CRAFTERS> | ''
    youngest: string
  }
  where: {
    place: Values<typeof PLACES>
    address: string
    setting: Values<typeof SETTINGS> | ''
    tables: Values<typeof YES_NO> | ''
    sink: Values<typeof YES_NO> | ''
    setupFrom: string
    access: string
  }
  craft: { pick: Values<typeof CRAFT_PICKS> | ''; vision: string; theme: string; personalized: string; link: string }
  extras: Record<ExtraKey, Values<typeof EXTRA_CHOICES> | ''>
  allergies: string
  budget: Values<typeof BUDGETS> | ''
  about: { name: string; email: string; phone: string; org: string; contactBy: Values<typeof CONTACT_BY> | ''; heard: string }
  notes: string
  photos: number
}

// ── Words for people ────────────────────────────────────────────────────────

export const label = <T extends readonly (readonly [string, string])[]>(list: T, v: string) => list.find(([k]) => k === v)?.[1] ?? ''

/** "16:30" → "4:30 PM". */
export function clock12(hhmm: string): string {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function kindLabel(r: EventRequest): string {
  return r.event.kind === 'other' ? r.event.kindOther || 'Something else' : label(KINDS, r.event.kind)
}

/** "Sat Nov 21 at 2:00 PM" (or without the time). */
export function whenLabel(r: EventRequest): string {
  return `${formatCalendarDay(r.event.date)}${r.event.startTime ? ` at ${clock12(r.event.startTime)}` : ''}`
}

export function crafterLabel(r: EventRequest): string {
  const who = label(CRAFTERS, r.event.crafters)
  return who && r.event.youngest ? `${who}, youngest ${r.event.youngest}` : who
}

/** Every extra with an answer: "Food: please provide". */
export function extrasLines(r: EventRequest): [string, string][] {
  return EXTRAS.filter(([k]) => r.extras[k]).map(([k, l]) => [l, label(EXTRA_CHOICES, r.extras[k])])
}
