import type { Workshop } from '@providers/interfaces/workshop'
import type { WorkshopData } from './WorkshopExplorer'
import { canBeBooked } from '@lib/workshop-rules'
import { formatTimeRange } from '@components/calendar/calendar-view-model'

/**
 * Build the UI view-model from a domain Workshop.
 * All derived fields (date string, endTime, etc.) are computed in this
 * single place — components consume WorkshopData directly.
 */
const STUDIO_TZ = 'America/Chicago'

/** YYYY-MM-DD of an instant as seen on the studio's wall calendar. */
export function studioDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: STUDIO_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

/**
 * "19:00": an instant as the studio's wall clock reads it, 24h. A visitor in
 * another time zone still sees studio times. Empty when it is not a time.
 */
export function studioClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: STUDIO_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

/** "Fri, Oct 16 · 7–9 PM": the studio day (no year) and the time range in studio time. */
export function whenLabel(w: Pick<WorkshopData, 'date' | 'startTime' | 'endTime'>): string {
  // `date` is already the studio's calendar day; noon UTC keeps it that day while it is formatted.
  const day = new Date(`${w.date}T12:00:00Z`)
  const dayLabel = Number.isNaN(day.getTime())
    ? ''
    : day.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
  return [dayLabel, formatTimeRange(studioClock(w.startTime), studioClock(w.endTime))].filter(Boolean).join(' · ')
}

/** Date order, then start time. Sold-out and coming-soon workshops sort with the rest. */
export function byStart(a: Pick<WorkshopData, 'date' | 'startTime'>, b: Pick<WorkshopData, 'date' | 'startTime'>): number {
  return a.date.localeCompare(b.date) || (Date.parse(a.startTime) || 0) - (Date.parse(b.startTime) || 0)
}

export function toWorkshopData(w: Workshop): WorkshopData {
  const start = new Date(w.startAt)
  const end = new Date(start.getTime() + w.durationMinutes * 60_000)
  // `date` is the STUDIO-LOCAL calendar day (America/Chicago). w.startAt is
  // UTC; a 7pm CDT class is 00:00Z the next day, so slicing the UTC string
  // would show every evening class a day late.
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    category: 'workshop',
    date: studioDate(start),
    startTime: w.startAt,
    endTime: end.toISOString(),
    duration: w.durationMinutes,
    price: w.priceCents,
    currency: w.priceCurrency,
    comingSoon: !canBeBooked(w.priceCents),
    remainingSeats: w.availableCapacity,
    classScheduleId: w.scheduleId,
    classScheduleInstanceId: w.id,
    teamMemberId: w.teamMemberId,
    imageUrl: w.imageUrl,
    flyerUrl: w.flyerUrl,
  }
}
