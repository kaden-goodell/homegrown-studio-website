/**
 * The seat rules, said once (R43). Every screen and count that asks "is this
 * person coming?" or "does this line take a seat?" uses these, so the print
 * sheet, the cancel list, Text everyone, /staff and the seats-left numbers
 * can never disagree. Pure and browser-safe (types only).
 *
 *   coming      a seat someone has: confirmed, or refunded with the seat kept
 *               (a goodwill refund). A freed seat is not coming.
 *   takesSeat   what seats-left counts: coming, plus holds still running
 *               (someone is paying right now).
 */
import type { LedgerLine } from './seat-ledger'

type Line = Pick<LedgerLine, 'state' | 'refunds' | 'holdExpiresAt'>
/** Stage 4: Square's own per-line totals for the seat, when the booking path kept them. */
type SquareTotals = { square?: Pick<LedgerLine['square'], 'lineNetCents' | 'lineTaxCents'> }
type Money = Pick<LedgerLine, 'priceCents' | 'taxCents' | 'addOnCents' | 'addOnTaxCents' | 'refunds'> & SquareTotals

/** Paid for (or comped / rung up): confirmed or refunded. Holds and released lines are not. */
export const isPaidLine = (l: Pick<LedgerLine, 'state'>): boolean => l.state === 'confirmed' || l.state === 'refunded'

/** Any refund on the line freed its seat. */
export const seatFreed = (l: Pick<LedgerLine, 'refunds'>): boolean => l.refunds.some((r) => r.freedSeat)

/** The person is coming: confirmed, or refunded with the seat kept. */
export const isComing = (l: Pick<LedgerLine, 'state' | 'refunds'>): boolean => isPaidLine(l) && !seatFreed(l)

/** A hold whose time ran out (or that never had one). */
export const isExpiredHold = (l: Pick<LedgerLine, 'state' | 'holdExpiresAt'>, now: Date): boolean =>
  l.state === 'held' && (!l.holdExpiresAt || Date.parse(l.holdExpiresAt) <= now.getTime())

/** A hold still running: someone is paying for this seat right now. */
export const isLiveHold = (l: Pick<LedgerLine, 'state' | 'holdExpiresAt'>, now: Date): boolean =>
  l.state === 'held' && !isExpiredHold(l, now)

/** The line takes a seat off seats-left: someone coming, or a hold still running. */
export const takesSeat = (l: Line, now: Date): boolean => isComing(l) || isLiveHold(l, now)

/**
 * What the seat cost: price, tax and its add-ons. Square's own numbers for the
 * seat's lines when kept (stage 4: money we record = money Square computed).
 */
export const paidOn = (l: Pick<LedgerLine, 'priceCents' | 'taxCents' | 'addOnCents' | 'addOnTaxCents'> & SquareTotals): number =>
  typeof l.square?.lineNetCents === 'number' && typeof l.square?.lineTaxCents === 'number'
    ? l.square.lineNetCents + l.square.lineTaxCents
    : l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents

/** Given back so far. */
export const refundedOn = (l: Pick<LedgerLine, 'refunds'>): number => l.refunds.reduce((s, r) => s + r.cents, 0)

/** Still to give back. */
export const leftOn = (l: Money): number => paidOn(l) - refundedOn(l)
