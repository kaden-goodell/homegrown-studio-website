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
import { bookingIdFor, CLASS_TAX_PERCENT, soldOutMessage } from './checkout'
import { quote, type BookingRequest, type Quote } from './pricing'
import { confirm, getLedger, hold, seatsTaken, type HoldInput, type LedgerLine } from './seat-ledger'
import type { ScheduledClass } from './types'
import { newId } from './validate'

export type DoorSeatMode = 'comp' | 'door-counter'

export type DoorSeatResult =
  | {
    ok: true; bookingId: string; lines: LedgerLine[]; quote: Quote; dueCents: number
    /** the fullest session it went over on, after adding: "5 of 4" */
    over: { sold: number; capacity: number } | null
    /** a retry of the same sheet (same attempt): the seats already added, nothing new */
    replayed?: true
  }
  | { ok: false; status: number; error: string; code?: 'sold_out' }

export async function addDoorSeats(input: {
  cls: ScheduledClass
  mode: DoorSeatMode
  request: BookingRequest
  customer: NonNullable<LedgerLine['customer']>
  by: By
  /** the crew chose to seat them on a full session */
  overCapacity?: boolean
  /** the sheet's token for this add, the same on a retry: a lost reply never adds the seats twice */
  attempt?: string
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
  const bookingId = input.attempt ? bookingIdFor(`door:${cls.id}:${input.attempt}`) : newId('bkg')
  const overOf = async (sessionIds: string[]) => {
    const ledger = await getLedger(cls.id)
    let worst: { sold: number; capacity: number } | null = null
    for (const s of cls.sessions.filter((x) => sessionIds.includes(x.id))) {
      const sold = seatsTaken(ledger, s.id, now)
      if (sold > s.capacity && (!worst || sold - s.capacity > worst.sold - worst.capacity)) worst = { sold, capacity: s.capacity }
    }
    return worst
  }
  const holdInput: HoldInput = {
    bookingId, passId: input.request.passId, source: mode, customer: input.customer, ttlMinutes: 10, by: input.by,
    ...(input.request.seats ? { seats: input.request.seats } : {}),
    ...(input.overCapacity ? { allowOverCapacity: true } : {}),
  }
  const square = { orderId: null, paymentId: null, ...(mode === 'comp' ? { chargedCents: 0 } : {}) }
  /**
   * A retry of the same attempt (N2). Only CONFIRMED seats count as added. A
   * hold still running from a try that failed before confirming is confirmed
   * now; a hold that ran out is no seat at all (null: hold afresh).
   */
  const replay = async (): Promise<DoorSeatResult | null> => {
    const mine = (await getLedger(cls.id)).lines.filter((l) => l.bookingId === bookingId)
    let done = mine.filter((l) => l.state === 'confirmed' || l.state === 'refunded')
    if (!done.length) {
      const live = mine.some((l) => l.state === 'held' && !!l.holdExpiresAt && Date.parse(l.holdExpiresAt) > now.getTime())
      if (!live) return null
      done = await confirm(cls.id, bookingId, square, { cls, quote: q, input: holdInput }, now)
      if (!done.length) return null
    }
    const due = mode === 'comp' ? 0 : done.reduce((a, l) => a + l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents, 0)
    return { ok: true, bookingId, lines: done, quote: q, dueCents: due, over: await overOf(done[0].sessionIds), replayed: true }
  }
  if (input.attempt) {
    const again = await replay()
    if (again) return again
  }
  let held
  try {
    held = await hold(cls, q, holdInput, now)
  } catch (e) {
    // The same add landing twice at once: answer with the seats already there.
    if (input.attempt && e instanceof Error && /already has seats/.test(e.message)) {
      const again = await replay()
      if (again) return again
    }
    throw e
  }
  if (!held.ok) return { ok: false, status: 409, code: 'sold_out', error: soldOutMessage(cls, held.sessionId, held.left).replace(' Nothing was charged.', '') }
  const lines = await confirm(cls.id, bookingId, square, { cls, quote: q, input: holdInput }, now)
  return { ok: true, bookingId, lines, quote: q, dueCents: mode === 'comp' ? 0 : q.totalCents, over: await overOf(q.sessionIds) }
}
