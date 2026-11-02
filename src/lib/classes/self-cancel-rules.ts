/**
 * D2: which seats of a class booking a customer can cancel themselves from
 * the "Can't make it?" link, and for how much. Pure (reads the class and the
 * booking's ledger lines only), so the page, the route and the tests agree.
 *
 * The rules (Kaden, 1 Nov, D2 revised):
 *   self     48+ hours (policy workshopRefundHours) before the booking's first
 *            session: pick seats → "Cancel and refund $X", exactly what those
 *            seats paid (price + tax; Square's own line totals when kept),
 *            never more than the booking has left (what Square charged less
 *            refunds). A booking for several dates (a series or a pass) is
 *            cancelled whole, never some of its seats.
 *   free     a booking that came to $0 (a code or a $0 early-bird): the seat
 *            is freed, nothing to refund, any time before it starts.
 *   request  everything else that isn't over: inside 48 hours, a seat that
 *            was a gift (comp), paid at the studio (counter, register, card
 *            reader), already partly refunded, or started → "Send us a note";
 *            an owner decides in /admin › To decide.
 *   none     nothing left to cancel (all cancelled), the class is over, or
 *            cancelled by the studio.
 * Classes still run in Square (legacy) never get a link: their confirmation
 * comes from Square's own flow.
 */
import type { Ledger, LedgerLine } from './seat-ledger'
import { isComing, isPaidLine, leftOn, seatFreed } from './seat-status'
import type { Cents, ScheduledClass } from './types'

export type CancelMode = 'self' | 'free' | 'request' | 'none'
export type CancelSeatState = 'booked' | 'cancelled' | 'cancelling'

export interface CancelSeat {
  lineId: string
  seat: number
  /** "Adult", "Seat" */
  label: string
  /** what cancelling this seat gives back (0 for a free one) */
  cents: Cents
  state: CancelSeatState
  /** it can be ticked in "self" or "free" mode */
  canPick: boolean
}

export interface CancelOptions {
  mode: CancelMode
  /** why it isn't self-serve (customer words), or null */
  why: string | null
  seats: CancelSeat[]
  /** a booking for several dates: all of its seats go together */
  wholeOnly: boolean
  firstStartIso: string | null
  /** hours from now to the first session (negative once it started) */
  hoursLeft: number
  /**
   * F9: the same by the studio's wall clock (Chicago), which the 48-hour policy is read by: across a clock
   * change, "Sat 12:30 PM before a Mon 1:00 PM class" is 48½ hours, as it looks to the customer.
   */
  policyHoursLeft: number
}

/** Chicago wall-clock time of an instant, as if it were UTC (so two of them subtract to clock hours). */
function wallMs(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
}

/** Hours between two instants by the studio's wall clock (F9). */
export function wallHoursBetween(fromMs: number, toIso: string): number {
  return (wallMs(Date.parse(toIso)) - wallMs(fromMs)) / 3_600_000
}

/** Seat sources a customer can't cancel and get refunded online (the money isn't a card payment we took online). */
const STUDIO_PAID = new Set<LedgerLine['source']>(['door-counter', 'pos', 'door-reader'])

export const CANCEL_WHY = {
  inside: (hours: number) => `Your class is less than ${hours} hours away, so it can’t be cancelled and refunded online. Inside ${hours} hours we offer studio credit for the full amount, or a free seat transfer to someone else or to another date of this class. Send us a note and we’ll sort it out with you.`,
  comp: 'This seat was a gift from the studio, so we sort out changes with you. Send us a note and we’ll take care of it.',
  studio: 'This booking was paid at the studio, so a refund goes back the same way. Send us a note and we’ll sort it out with you.',
  partly: 'Part of this booking was already refunded, so we sort out the rest with you. Send us a note and we’ll take care of it.',
  started: 'Your class has already started, so we sort this one out with you. Send us a note and we’ll take care of it.',
  noPayment: 'We couldn’t find the card payment for this booking, so we sort this one out with you. Send us a note and we’ll take care of it.',
  over: 'This class is over, so there’s nothing to cancel.',
  classCancelled: 'This class was cancelled by the studio. We’ll be in touch about your booking.',
} as const

/** A $0 online booking: no order, no payment (D3). Mirrors refunds.ts isFreeBooking. */
const isFree = (l: Pick<LedgerLine, 'source' | 'square'>) =>
  (l.source === 'online' || l.source === 'door-card') && !l.square.paymentId && !l.square.orderId && l.square.chargedCents === 0

/** What the booking can still give back: what Square charged less refunds (null = no charged total recorded). */
function capOf(lines: LedgerLine[]): Cents | null {
  const charged = lines.find((l) => typeof l.square.chargedCents === 'number')?.square.chargedCents
  if (typeof charged !== 'number') return null
  return Math.max(0, charged - lines.reduce((s, l) => s + l.refunds.reduce((a, r) => a + r.cents, 0), 0))
}

/**
 * Each seat's amount if these seats are cancelled together: its full
 * remaining (price + tax + its extras, Square's numbers when kept), cut down
 * in seat order to what the booking has left. The same split the refund
 * runner's planRefund makes for a "custom" refund of these seats.
 */
export function cancelSplit(bookingLines: LedgerLine[], lineIds: string[]): { lineId: string; cents: Cents }[] {
  let room = capOf(bookingLines) ?? Infinity
  return bookingLines
    .filter((l) => lineIds.includes(l.id))
    .sort((a, b) => a.seat - b.seat)
    .map((l) => {
      const cents = Math.max(0, Math.min(leftOn(l), room))
      room -= cents
      return { lineId: l.id, cents }
    })
}

export function bookingLinesOf(ledger: Ledger, bookingId: string): LedgerLine[] {
  return ledger.lines.filter((l) => l.bookingId === bookingId && isPaidLine(l)).sort((a, b) => a.seat - b.seat)
}

export function cancelOptions(
  cls: Pick<ScheduledClass, 'status' | 'sessions' | 'content'>,
  bookingLines: LedgerLine[],
  now: Date,
  opts: { policyHours: number; cancelling?: ReadonlySet<string> },
): CancelOptions {
  const lines = bookingLines.filter(isPaidLine).sort((a, b) => a.seat - b.seat)
  const sessionIds = new Set(lines.flatMap((l) => l.sessionIds))
  const sessions = cls.sessions.filter((s) => sessionIds.has(s.id)).sort((a, b) => a.startIso.localeCompare(b.startIso))
  const first = sessions[0]
  const last = sessions[sessions.length - 1]
  const firstStartIso = first?.startIso ?? null
  const hoursLeft = first ? (Date.parse(first.startIso) - now.getTime()) / 3_600_000 : 0
  const policyHoursLeft = first ? wallHoursBetween(now.getTime(), first.startIso) : 0
  const label = (l: LedgerLine) => cls.content.ticketTypes.find((t) => t.id === l.ticketTypeId)?.label ?? 'Seat'
  const cancelling = opts.cancelling ?? new Set<string>()
  // A seat that can still be cancelled: coming, with nothing refunded on it yet.
  const open = lines.filter((l) => isComing(l) && l.refunds.length === 0 && !cancelling.has(l.id))
  const split = new Map(cancelSplit(lines, open.map((l) => l.id)).map((x) => [x.lineId, x.cents]))
  const seatsWith = (canPick: boolean): CancelSeat[] => lines.map((l) => {
    const state: CancelSeatState = seatFreed(l) ? 'cancelled' : cancelling.has(l.id) ? 'cancelling' : 'booked'
    const pickable = canPick && open.includes(l)
    return { lineId: l.id, seat: l.seat, label: label(l), cents: pickable ? split.get(l.id) ?? 0 : 0, state, canPick: pickable }
  })
  const wholeOnly = lines.some((l) => l.sessionIds.length > 1)
  const base = { firstStartIso, hoursLeft, policyHoursLeft, wholeOnly }
  const answer = (mode: CancelMode, why: string | null): CancelOptions => ({ ...base, mode, why, seats: seatsWith(mode === 'self' || mode === 'free') })

  if (!lines.length || !first) return answer('none', null)
  if (cls.status === 'cancelled') return answer('none', CANCEL_WHY.classCancelled)
  if (last && Date.parse(last.endIso) <= now.getTime()) return answer('none', CANCEL_WHY.over)
  if (!open.length) {
    // F5: seats still coming, each with a goodwill refund on it already: not a dead end, a note for the owners.
    if (lines.some((l) => isComing(l) && !cancelling.has(l.id))) return answer('request', CANCEL_WHY.partly)
    return answer('none', null)
  }
  if (hoursLeft <= 0) return answer('request', CANCEL_WHY.started)
  if (open.some((l) => l.source === 'comp')) return answer('request', CANCEL_WHY.comp)
  if (open.some((l) => STUDIO_PAID.has(l.source))) return answer('request', CANCEL_WHY.studio)
  // A series or pass booking with some of it already refunded or freed: never part of a pass online.
  if (wholeOnly && open.length < lines.length) return answer('request', CANCEL_WHY.partly)
  if (open.every(isFree)) return answer('free', null)
  if (open.some((l) => !l.square.paymentId || l.square.paymentId !== open[0].square.paymentId)) return answer('request', CANCEL_WHY.noPayment)
  if (policyHoursLeft < opts.policyHours) return answer('request', CANCEL_WHY.inside(opts.policyHours))
  return answer('self', null)
}

/**
 * The seats a customer may cancel in one go: refused (null) unless every one
 * is pickable, and, for a booking over several dates, unless they are all of
 * them.
 */
export function pickedSeats(opts: CancelOptions, lineIds: unknown): string[] | null {
  if (!Array.isArray(lineIds)) return null
  const ids = [...new Set(lineIds.filter((x): x is string => typeof x === 'string'))]
  if (!ids.length) return null
  const pickable = opts.seats.filter((s) => s.canPick).map((s) => s.lineId)
  if (ids.some((id) => !pickable.includes(id))) return null
  if (opts.wholeOnly && ids.length !== pickable.length) return null
  return ids
}
