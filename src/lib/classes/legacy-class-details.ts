/**
 * What /admin shows for a class still run from Square (Kaden, 17 Nov 2026:
 * "if it's a square class it still needs to get the right info, just for now
 * until those go away"): seats booked of the class's size, seats left, the
 * price per seat, and who is booked with their waiver status.
 *
 * Read only, the same sources /staff and the class-day waiver reminder use:
 * the event (Square's seats left, the class's own capacity setting) and our
 * seat records re-checked with Square. A seat added in the Square dashboard
 * alone isn't in our records, so the list can be shorter than "booked".
 *
 * Every part is optional: a read that fails just leaves that part out.
 *
 * Server only. LEGACY: goes when the last Square class has run.
 */
import { findWorkshop, getEvent } from '@lib/events'
import { squareClassFamilies, type SquareClassFamily } from '@lib/waiver-reminders'
import { getEventMeta } from '@lib/event-meta'
import { getClass } from '@lib/classes/class-store'

export interface LegacyClassCounts {
  /** Seats taken (capacity − seats left). Only when both are known. */
  booked?: number
  /** How many seats the class holds. */
  capacity?: number
  /** Seats Square still offers. */
  remaining?: number
  /** Price of one seat, before tax. */
  priceCents?: number
  /** Its remaining seats now sell on our own system (event-meta movedTo): that class's id and name. */
  movedTo?: { id: string; name: string }
}

export type { SquareClassFamily } from '@lib/waiver-reminders'

/**
 * Who is booked on this Square class and whether each family has signed, by
 * the class-day reminder's own rules (src/lib/waiver-reminders.ts). Null when
 * the class can't be found. Throws when the seat records can't be read.
 */
export async function legacyFamilies(scheduleId: string, now: Date = new Date()): Promise<SquareClassFamily[] | null> {
  const w = await findWorkshop(scheduleId)
  if (!w) return null
  return squareClassFamilies(w, now)
}

/** The counts for one Square class (its class schedule id). Never throws. */
export async function legacyClassCounts(scheduleId: string): Promise<LegacyClassCounts> {
  const event = await getEvent('workshop', scheduleId).catch(() => null)
  if (!event) return {}
  const capacity = typeof event.capacity === 'number' ? event.capacity : undefined
  const remaining = typeof event.seats === 'number' ? Math.max(0, event.seats) : undefined
  const out: LegacyClassCounts = {}
  if (capacity !== undefined) out.capacity = capacity
  if (remaining !== undefined) out.remaining = remaining
  if (capacity !== undefined && remaining !== undefined) out.booked = Math.max(0, capacity - remaining)
  if (typeof event.priceCents === 'number') out.priceCents = event.priceCents
  const to = (await getEventMeta('workshop', scheduleId).catch(() => null))?.movedTo
  if (to) {
    const cls = await getClass(to).catch(() => null)
    out.movedTo = { id: to, name: cls?.content.name ?? 'the new class' }
  }
  return out
}
