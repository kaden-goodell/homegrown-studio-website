/**
 * How a booking on one of our classes is said at the door and on paper.
 * Pure and browser-safe, so the roster screen and the printed roster agree.
 */
import type { LedgerLine } from './seat-ledger'

export interface BookingWordsInput {
  source: LedgerLine['source']
  /** a Square payment is on it */
  paidHere: boolean
  overCapacity: boolean
}

/** Seats the crew chose to add at the door (comp, counter, iPad). */
export const crewSeat = (source: LedgerLine['source']) => source === 'comp' || source === 'door-counter' || source === 'door-card'

/** "Paid online", "Comped", "Not paid yet" (a pay-at-the-counter seat never rung up)… */
export function paidWay(b: BookingWordsInput): string {
  switch (b.source) {
    case 'online': return 'Paid online'
    case 'door-card': return 'Paid on the iPad'
    case 'door-counter': return b.paidHere ? 'Paid at the counter' : 'Not paid yet'
    case 'comp': return 'Comped'
    case 'pos': return 'Counter sale'
    default: return ''
  }
}

/** A pay-at-the-counter seat nobody has rung up yet: no money has come in. */
export const unpaidCounter = (b: Pick<BookingWordsInput, 'source' | 'paidHere'>) => b.source === 'door-counter' && !b.paidHere

/**
 * The money a booking has actually brought in, less refunds: 0 for a comp and
 * for a counter seat not rung up yet (its price is only what it will cost).
 * /admin's "taken so far" and Past totals add these up.
 */
export function takenCents(b: Pick<BookingWordsInput, 'source' | 'paidHere'> & { paidCents: number; refundedCents: number }): number {
  if (b.source === 'comp' || unpaidCounter(b)) return 0
  return Math.max(0, b.paidCents - b.refundedCents)
}

/** The over-capacity note: the crew's own choice reads as such; anything else is for an owner. */
export function overCapacityNote(b: BookingWordsInput): string | null {
  if (!b.overCapacity) return null
  return crewSeat(b.source) ? 'Added over capacity on purpose.' : 'Over capacity. An owner decides on /admin.'
}

/** One line for the printed roster: "Dora Door · 1 seat · Not paid yet · Over capacity". */
export function printLine(b: BookingWordsInput & { name: string; seatsToday: number }): string {
  return [b.name, `${b.seatsToday} seat${b.seatsToday === 1 ? '' : 's'}`, paidWay(b), b.overCapacity ? 'Over capacity' : '']
    .filter(Boolean).join(' · ')
}
