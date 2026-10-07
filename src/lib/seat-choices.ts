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
import { choiceTotals, type SeatOption, type SeatPick } from '@lib/seat-options'

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

export interface RosterChoices {
  /** optionId → choice → seats. */
  totals: Record<string, Record<string, number>>
  /** Lower-cased booking email → that family's picks (all their bookings). */
  byEmail: Record<string, SeatPick[]>
  /** Paid bookings whose email matches no signed agreement for this class. */
  unmatched: { name: string; email: string; seats: number; picks: SeatPick[] }[]
  /** Seats Square says are sold (capacity − left), or null when unknown. */
  seatsSold: number | null
}

/** Roll a class's records up for the roster and the print sheet (spec D). */
export function summarizeChoices(
  options: SeatOption[],
  records: SeatChoiceRecord[],
  signerEmails: string[],
  seatsSold: number | null,
): RosterChoices {
  const signed = new Set(signerEmails.map((e) => e.trim().toLowerCase()))
  const byEmail: Record<string, SeatPick[]> = {}
  const unmatched: RosterChoices['unmatched'] = []
  for (const r of records) {
    const email = r.customer.email.trim().toLowerCase()
    byEmail[email] = [...(byEmail[email] ?? []), ...r.picks]
    if (!signed.has(email)) {
      unmatched.push({ name: `${r.customer.givenName} ${r.customer.familyName}`.trim(), email, seats: r.seats, picks: r.picks })
    }
  }
  return { totals: choiceTotals(options, records.flatMap((r) => r.picks)), byEmail, unmatched, seatsSold }
}
