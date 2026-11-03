/**
 * Checkout helpers for our own classes: the pieces of the booking endpoint
 * (src/pages/api/classes/book.json.ts) that need no network, plus what the
 * customer reads when a booking doesn't finish.
 *
 * Server only.
 */
import { idFor } from '@lib/booking-core/ids'
import { formatMoney } from '@lib/money'
import type { CheckoutErrorCode } from '@lib/checkout-attempt'
import { workshopMessages } from '@lib/checkout-messages'
import { cutoffClosedMessage } from '@lib/seat-options'
import { formatDay } from '@lib/studio-time'
import { ticketSummary } from '@lib/ticket-types'
import type { Quote } from './pricing'
import type { LedgerLine } from './seat-ledger'
import { paidOn, seatFreed } from './seat-status'
import { posPricesNow } from './square-catalog'
import type { ScheduledClass } from './types'

/**
 * The class's Square tax rate is not kept here. Square applies the catalog tax
 * itself; this is the same 9% so the quote matches the order to the cent.
 * A class marked not taxable is quoted at 0 by `quote` itself.
 */
export const CLASS_TAX_PERCENT = 9

/** How long a seat is held, the drift rule (R14), the unclear-charge hold (R15): shared with parties. */
export { HOLD_MINUTES, PRICE_DRIFT_TOLERANCE_CENTS, UNCLEAR_HOLD_HOURS } from '@lib/booking-core/charge'

/**
 * Final review C2: the same person (by email) on the same class, a few
 * minutes apart, with a different attempt. Usually the panel was closed or
 * the page reloaded while the first payment was going through, and the new
 * try would charge again. A live hold of theirs → "still going through"; a
 * booking of theirs from the last few minutes → ask before booking again
 * (they may really want more seats: `confirmRepeat` lets that through).
 */
export const RECENT_BOOKING_MINUTES = 10
export const STILL_GOING_THROUGH_MESSAGE =
  'Your last payment for this class is still going through. Give it a minute, then check your email before trying again. Nothing was charged this time.'
export const RECENT_CLASS_BOOKING_MESSAGE =
  'You booked this class a few minutes ago. Check your email for the confirmation. Nothing was charged this time. Book more seats only if you meant to.'

/**
 * N4: a hold of theirs younger than this is a payment going through right
 * now. An older live hold is one kept after an unclear answer (a day, R15):
 * then Square is asked about it (`unclear`) instead of refusing for a day.
 */
export const LIVE_HOLD_MINUTES = 30

export type SamePersonAnswer = 'held' | 'booked' | { unclear: { bookingId: string; orderId: string | null } } | null

export function recentSamePerson(lines: LedgerLine[], bookingId: string, email: string, now: Date): SamePersonAnswer {
  const who = email.trim().toLowerCase()
  if (!who) return null
  const since = now.getTime() - RECENT_BOOKING_MINUTES * 60_000
  let found: SamePersonAnswer = null
  for (const l of lines) {
    if (l.bookingId === bookingId || l.customer?.email?.trim().toLowerCase() !== who) continue
    if (l.state === 'held' && l.holdExpiresAt && Date.parse(l.holdExpiresAt) > now.getTime()) {
      if (now.getTime() - Date.parse(l.at) < LIVE_HOLD_MINUTES * 60_000) return 'held'
      if (!found || typeof found === 'string') found = { unclear: { bookingId: l.bookingId, orderId: l.square?.orderId ?? null } }
      continue
    }
    // Run 3 (scenario 52): only a booking that really holds a paid seat counts; a declined, released,
    // lapsed or freed try never makes someone "already booked".
    if (l.state === 'confirmed' && !seatFreed(l) && Date.parse(l.at) >= since && found === null) found = 'booked'
  }
  return found
}

/** N4: Square shows their earlier unclear payment went through: never a second charge. */
export const LAST_PAYMENT_WENT_THROUGH =
  'Square shows your last payment for this class went through. Check your email for your confirmation. Nothing was charged this time.'

/**
 * More answers than the shared codes: a try with this attempt is still
 * running; a code that doesn't work (stage 4); the total went up since the
 * page showed it (stage 4, review I2: nothing charged, the new total sent).
 */
export type ClassCheckoutCode = CheckoutErrorCode | 'in_progress' | 'promo' | 'price_changed' | 'recent_booking' | 'class_cancelled'

export const classMessages: Record<ClassCheckoutCode, string> = {
  ...workshopMessages,
  already_booked: 'You already have a seat in this class. Check your email for the confirmation.',
  not_open: 'This class isn’t open for booking. Nothing was charged.',
  in_progress: 'We’re still finishing your last try. Give it a minute, then check your email before trying again.',
  promo: 'That code isn\'t valid. Nothing was charged.',
  price_changed: 'The price changed. Nothing was charged. Check the new total, then try again.',
  recent_booking: 'You booked this class a few minutes ago. Check your email for the confirmation. Nothing was charged this time. Book more seats only if you meant to.',
  // I-5: paid in the same moment an owner cancelled the class. The owners refund it from To decide.
  class_cancelled: 'We’re sorry. This class was cancelled just as you booked it. You’ll be refunded in full, and we’ll be in touch.',
}

/** I-5: what the panel says when the payment landed on a class cancelled meanwhile. */
export function cancelledAsBookedMessage(cents: number, emailed: boolean): string {
  return `We’re sorry. This class was cancelled just as you booked it. You’ll be refunded the full ${formatMoney(cents)}${emailed ? ', and we’ve emailed you about it' : ''}. You don’t need to do anything.`
}

/**
 * Review I2: the page's total was lower than the price now (an early-bird or
 * a code ended, a price changed). Said with the new total; nothing charged.
 */
export function priceChangedMessage(newTotalCents: number, earlyBirdEnded: boolean): string {
  const total = `$${(newTotalCents / 100).toFixed(2)}`
  return earlyBirdEnded
    ? `The price changed to ${total} because the early-bird ended. Nothing was charged.`
    : `The price changed to ${total}. Nothing was charged.`
}

export const PRICE_MISMATCH_MESSAGE = 'We couldn’t price your booking. Nothing was charged. Please try again in a few minutes.'

/**
 * Our booking id for one checkout attempt. A retry with the same attempt id
 * addresses the same booking, so the ledger can tell a retry from a new sale.
 */
export function bookingIdFor(attemptId: string): string {
  return idFor('bkg', attemptId)
}

/** Hours before the first session that sign-ups close. */
export function classCutoffHours(cls: ScheduledClass): number {
  const r = cls.content.rules
  return r.signupCutoffHours ?? (r.madeToOrder || cls.content.questions.length > 0 ? 24 : 0)
}

/**
 * The refusal when sign-ups for the first of these sessions have closed, else
 * null. A class that doesn't take people partway (R28) closes as a whole: the
 * cutoff counts from its first session, whichever days are asked for.
 */
export function cutoffRefusal(cls: ScheduledClass, sessionIds: string[], now: Date): string | null {
  const asked = cls.sessions.filter((s) => sessionIds.includes(s.id))
  const counted = asked.length && !cls.content.rules.joinPartway ? cls.sessions : asked
  const starts = counted.map((s) => Date.parse(s.startIso))
  if (!starts.length) return null
  const hours = classCutoffHours(cls)
  return now.getTime() >= Math.min(...starts) - hours * 3_600_000 ? cutoffClosedMessage(hours) : null
}

export type OrderLine = { catalogObjectId: string; quantity: 1; note: string }
/** Stage 4 (S4-R1): money off one order line (index into `lines`), as a LINE_ITEM-scoped fixed amount. */
export type OrderLineDiscount = { line: number; name: string; cents: number }

/**
 * Square order lines for a quote, in quote order (the order's totals follow
 * the same order), and the discounts on them, one per discount per line,
 * in the order they came off. `missing` names the first line the POS item
 * doesn't carry.
 *
 * D4: the POS item's seat prices follow the current price, so while the
 * early-bird runs the catalog line already costs the early-bird price. The
 * discounts sent are only what takes the CATALOG price down to the quote's
 * net: the part of the early-bird the catalog already carries is left out
 * (never taken twice). Only the early-bird is ever absorbed that way, never a
 * code (M1). `short` is how much a line's recorded catalog price was under
 * the line's price after the early-bird (the POS hadn't caught up with an
 * early-bird that just ended); Square's lower total is then charged (R14).
 */
export function orderLinesFor(
  cls: ScheduledClass,
  q: Quote,
  seats?: { answers?: Record<string, string> }[],
): { ok: true; lines: OrderLine[]; discounts: OrderLineDiscount[]; shortCents: number } | { ok: false; missing: string } {
  const lines: OrderLine[] = []
  const discounts: OrderLineDiscount[] = []
  const onPos = posPricesNow(cls)
  let shortCents = 0
  for (const l of q.lines) {
    const id = l.variationKey ? cls.square.variations[l.variationKey] : undefined
    if (!id) return { ok: false, missing: l.variationKey ?? l.label }
    const answers = l.kind === 'seat'
      ? cls.content.questions.map((qu) => seats?.[l.seat]?.answers?.[qu.id] ? `${qu.label} ${seats[l.seat].answers![qu.id]}` : '').filter(Boolean)
      : []
    const list = l.listCents ?? l.cents
    const catalog = l.variationKey && typeof onPos[l.variationKey] === 'number' ? onPos[l.variationKey] : list
    // Already off on the POS item (the early-bird it carries); comes off this line's early-bird only.
    // M1: never a code's discount. If our record of the POS price is behind Square's (Square written, the
    // class record not), a code absorbed here would be left off the order and charged above the Pay button.
    let carried = Math.max(0, list - catalog)
    for (const d of l.discounts ?? []) {
      // D6: the waitlist's agreed-price discount is a price too (taken off after the early-bird), so it may absorb what's left.
      const absorbed = d.kind !== 'promo' ? Math.min(carried, d.cents) : 0
      carried -= absorbed
      const cents = d.cents - absorbed
      if (cents > 0) discounts.push({ line: lines.length, name: d.name, cents })
    }
    shortCents += carried
    lines.push({ catalogObjectId: id, quantity: 1, note: [`Seat ${l.seat + 1}`, l.label, ...answers].join(' · ').slice(0, 500) })
  }
  return { ok: true, lines, discounts, shortCents }
}

/** "2 Adults, 1 Kid" on a class with ticket types; "2 seats" on one with a single kind of seat. */
export function seatsLabelFor(cls: ScheduledClass, seats: { ticketTypeId: string }[]): string {
  if (cls.content.ticketTypes.length <= 1) return `${seats.length} seat${seats.length === 1 ? '' : 's'}`
  const label = (id: string) => cls.content.ticketTypes.find((t) => t.id === id)?.label ?? 'Seat'
  return ticketSummary(seats.map((s) => ({ typeId: s.ticketTypeId, label: label(s.ticketTypeId) })))
}

/** What a paid line came to, seat and its extras, tax included. */
export const paidCentsOf = (l: LedgerLine) => paidOn(l)

/** "Only 1 seat is left on Sat, Oct 17." — said before anything is held or charged. */
export function soldOutMessage(cls: ScheduledClass, sessionId: string, left: number): string {
  const s = cls.sessions.find((x) => x.id === sessionId)
  const day = s ? ` on ${formatDay(s.startIso)}` : ''
  if (left <= 0) return `That class is full${day}. Nothing was charged.`
  return `Only ${left} seat${left === 1 ? ' is' : 's are'} left${day}. Nothing was charged.`
}

/** Seats with only this class's own question answers (other keys dropped) and add-on counts. */
export function cleanSeats(cls: ScheduledClass, seats: unknown[]): { answers?: Record<string, string>; addOns?: Record<string, number> }[] {
  const ids = new Set(cls.content.questions.map((q) => q.id))
  return seats.map((raw) => {
    const seat = (raw && typeof raw === 'object' ? raw : {}) as { answers?: unknown; addOns?: unknown }
    const answers: Record<string, string> = {}
    if (seat.answers && typeof seat.answers === 'object') {
      for (const [k, v] of Object.entries(seat.answers as Record<string, unknown>)) if (ids.has(k) && typeof v === 'string') answers[k] = v
    }
    const addOns = seat.addOns && typeof seat.addOns === 'object' && !Array.isArray(seat.addOns) ? (seat.addOns as Record<string, number>) : undefined
    return { answers, ...(addOns ? { addOns } : {}) }
  })
}

/** The quote as the booking panel shows it (no catalog ids). */
export function publicQuote(q: Quote) {
  return {
    lines: q.lines.map((l) => ({ kind: l.kind, seat: l.seat, ticketTypeId: l.ticketTypeId, label: l.label, listCents: l.listCents, discounts: l.discounts, cents: l.cents, taxCents: l.taxCents })),
    sessionIds: q.sessionIds, seats: q.seats, subtotalCents: q.subtotalCents, taxCents: q.taxCents, totalCents: q.totalCents,
    discountCents: q.discountCents, promo: q.promo,
  }
}
