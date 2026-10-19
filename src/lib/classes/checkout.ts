/**
 * Checkout helpers for our own classes: the pieces of the booking endpoint
 * (src/pages/api/classes/book.json.ts) that need no network, plus what the
 * customer reads when a booking doesn't finish.
 *
 * Server only (node:crypto).
 */
import { createHash } from 'node:crypto'
import type { CheckoutErrorCode } from '@lib/checkout-attempt'
import { workshopMessages } from '@lib/checkout-messages'
import { cutoffClosedMessage } from '@lib/seat-options'
import { formatDay } from '@lib/studio-time'
import { ticketSummary } from '@lib/ticket-types'
import type { Quote } from './pricing'
import type { LedgerLine } from './seat-ledger'
import type { ScheduledClass } from './types'

/**
 * The class's Square tax rate is not kept here. Square applies the catalog tax
 * itself; this is the same 9% so the quote matches the order to the cent.
 * A class marked not taxable is quoted at 0 by `quote` itself.
 */
export const CLASS_TAX_PERCENT = 9

/** How long a seat is held while the card is charged. */
export const HOLD_MINUTES = 10

/** A charge with no answer keeps its seats this long, for a person to settle. */
export const UNCLEAR_HOLD_HOURS = 24

/** One more answer than the shared codes: a try with this attempt is still running. */
export type ClassCheckoutCode = CheckoutErrorCode | 'in_progress'

export const classMessages: Record<ClassCheckoutCode, string> = {
  ...workshopMessages,
  already_booked: 'You already have a seat in this class. Check your email for the confirmation.',
  not_open: 'This class isn’t open for booking. Nothing was charged.',
  in_progress: 'We’re still finishing your last try. Give it a minute, then check your email before trying again.',
}

export const PRICE_MISMATCH_MESSAGE = 'We couldn’t price your booking. Nothing was charged. Please try again in a few minutes.'

/**
 * Square's order total is what is charged; our quote is for display. Square a
 * little higher (rounding) is charged and the owners get an email; more than
 * this over the quote is refused.
 */
export const PRICE_DRIFT_TOLERANCE_CENTS = 100

/**
 * Our booking id for one checkout attempt. A retry with the same attempt id
 * addresses the same booking, so the ledger can tell a retry from a new sale.
 */
export function bookingIdFor(attemptId: string): string {
  return `bkg_${createHash('sha256').update(attemptId).digest('hex').slice(0, 16)}`
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

/**
 * Square order lines for a quote, in quote order (the order's totals follow
 * the same order). `missing` names the first line the POS item doesn't carry.
 */
export function orderLinesFor(
  cls: ScheduledClass,
  q: Quote,
  seats?: { answers?: Record<string, string> }[],
): { ok: true; lines: OrderLine[] } | { ok: false; missing: string } {
  const lines: OrderLine[] = []
  for (const l of q.lines) {
    const id = l.variationKey ? cls.square.variations[l.variationKey] : undefined
    if (!id) return { ok: false, missing: l.variationKey ?? l.label }
    const answers = l.kind === 'seat'
      ? cls.content.questions.map((qu) => seats?.[l.seat]?.answers?.[qu.id] ? `${qu.label} ${seats[l.seat].answers![qu.id]}` : '').filter(Boolean)
      : []
    lines.push({ catalogObjectId: id, quantity: 1, note: [`Seat ${l.seat + 1}`, l.label, ...answers].join(' · ').slice(0, 500) })
  }
  return { ok: true, lines }
}

/** "2 Adults, 1 Kid" on a class with ticket types; "2 seats" on one with a single kind of seat. */
export function seatsLabelFor(cls: ScheduledClass, seats: { ticketTypeId: string }[]): string {
  if (cls.content.ticketTypes.length <= 1) return `${seats.length} seat${seats.length === 1 ? '' : 's'}`
  const label = (id: string) => cls.content.ticketTypes.find((t) => t.id === id)?.label ?? 'Seat'
  return ticketSummary(seats.map((s) => ({ typeId: s.ticketTypeId, label: label(s.ticketTypeId) })))
}

/** What a paid line came to, seat and its extras, tax included. */
export const paidCentsOf = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents

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
