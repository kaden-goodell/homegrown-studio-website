import type { Workshop } from '@providers/interfaces/workshop'
import type { WorkshopData } from './WorkshopExplorer'

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
    remainingSeats: w.availableCapacity,
    classScheduleId: w.scheduleId,
    classScheduleInstanceId: w.id,
    teamMemberId: w.teamMemberId,
    imageUrl: w.imageUrl,
    flyerUrl: w.flyerUrl,
  }
}
