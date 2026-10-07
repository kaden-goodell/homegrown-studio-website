/**
 * What each seat picked when it was booked (spec C): the structured record
 * behind the roster totals, the family's "Picks" line and the print sheet.
 * Square only ever gets a booking note.
 *
 * Written once, after the charge succeeds. Never edited afterwards: "you
 * pick what you get", and a swap is noted in the family's History by hand.
 *
 * Netlify Blobs in prod, `.data/seat-choices/` on disk in dev.
 */
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'
import type { SeatPick } from '@lib/seat-options'

const logger = createLogger('seat-choices')
const kv = makeKvStore('seat-choices', 'seat-choices')

export interface SeatChoiceRecord {
  eventKind: 'workshop'
  /** Square class schedule id. */
  eventId: string
  bookingId: string
  orderId: string | null
  customer: { givenName: string; familyName: string; email: string; phone: string }
  seats: number
  picks: SeatPick[]
  at: string
  attemptId: string
}

const prefix = (eventId: string) => `seat-choices-workshop:${eventId}-`

export function seatChoiceKey(eventId: string, bookingId: string): string {
  return `${prefix(eventId)}${bookingId}`
}

/** Same booking id → same key, so a retried save replaces rather than doubles. */
export async function saveSeatChoices(record: SeatChoiceRecord): Promise<void> {
  await kv.set(seatChoiceKey(record.eventId, record.bookingId), JSON.stringify(record))
  logger.info('Seat choices saved', { eventId: record.eventId, bookingId: record.bookingId, seats: record.seats })
}

export async function listSeatChoicesByEvent(_kind: 'workshop', eventId: string): Promise<SeatChoiceRecord[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith(prefix(eventId)))
  const records = await Promise.all(keys.map(async (k) => {
    const json = await kv.get(k)
    return json ? (JSON.parse(json) as SeatChoiceRecord) : null
  }))
  return records.filter((r): r is SeatChoiceRecord => r !== null).sort((a, b) => a.at.localeCompare(b.at))
}

export async function hasSeatChoices(_kind: 'workshop', eventId: string): Promise<boolean> {
  return (await kv.list()).some((k) => k.startsWith(prefix(eventId)))
}
