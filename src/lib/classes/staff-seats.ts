/**
 * Seats the crew add at the door on one of our own classes (/staff "Comp a
 * seat" and "Sell a seat, pay at the counter"). Written straight to the seat
 * ledger (hold, then confirm): no Square dashboard, no charge here.
 *
 * - comp: a free seat. Recorded at $0, so there is nothing to refund.
 * - door-counter: the money is taken at the register. The seat carries the
 *   class price; when the POS sale of that class item comes in, it pays this
 *   seat instead of adding another (seat-ledger recordPos).
 *
 * Priced as a door sale: a session stays open until it ends, and the online
 * sign-up cutoff doesn't apply. Full sessions refuse unless the crew squeeze
 * one more in on purpose (overCapacity), which marks the seat "41 of 40".
 * Server only.
 */
import type { By } from '@lib/staff-auth'
import { CLASS_TAX_PERCENT, soldOutMessage } from './checkout'
import { quote, type BookingRequest, type Quote } from './pricing'
import { confirm, hold, type HoldInput, type LedgerLine } from './seat-ledger'
import type { ScheduledClass } from './types'
import { newId } from './validate'

export type DoorSeatMode = 'comp' | 'door-counter'

export type DoorSeatResult =
  | { ok: true; bookingId: string; lines: LedgerLine[]; quote: Quote; dueCents: number }
  | { ok: false; status: number; error: string; code?: 'sold_out' }

export async function addDoorSeats(input: {
  cls: ScheduledClass
  mode: DoorSeatMode
  request: BookingRequest
  customer: NonNullable<LedgerLine['customer']>
  by: By
  /** the crew chose to seat them on a full session */
  overCapacity?: boolean
  now?: Date
}): Promise<DoorSeatResult> {
  const { cls, mode } = input
  const now = input.now ?? new Date()
  if (cls.status !== 'open' && cls.status !== 'closed') return { ok: false, status: 409, error: 'That class isn’t running.' }
  const priced = quote(cls, input.request, now, CLASS_TAX_PERCENT, { door: true })
  if (!priced.ok) return { ok: false, status: priced.field ? 400 : 409, error: priced.error }
  // A comp is a $0 seat: nothing to refund and nothing owed.
  const q: Quote = mode === 'comp'
    ? { ...priced.value, lines: priced.value.lines.map((l) => ({ ...l, cents: 0, taxCents: 0 })), subtotalCents: 0, taxCents: 0, totalCents: 0 }
    : priced.value
  const bookingId = newId('bkg')
  const holdInput: HoldInput = {
    bookingId, passId: input.request.passId, source: mode, customer: input.customer, ttlMinutes: 10, by: input.by,
    ...(input.request.seats ? { seats: input.request.seats } : {}),
    ...(input.overCapacity ? { allowOverCapacity: true } : {}),
  }
  const held = await hold(cls, q, holdInput, now)
  if (!held.ok) return { ok: false, status: 409, code: 'sold_out', error: soldOutMessage(cls, held.sessionId, held.left).replace(' Nothing was charged.', '') }
  const lines = await confirm(cls.id, bookingId, { orderId: null, paymentId: null, ...(mode === 'comp' ? { chargedCents: 0 } : {}) }, { cls, quote: q, input: holdInput }, now)
  return { ok: true, bookingId, lines, quote: q, dueCents: mode === 'comp' ? 0 : q.totalCents }
}
