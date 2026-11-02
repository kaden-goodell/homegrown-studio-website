/**
 * How a booking on one of our classes is said at the door and on paper.
 * Pure and browser-safe, so the roster screen and the printed roster agree.
 */
import type { LedgerLine } from './seat-ledger'

export interface BookingWordsInput {
  source: LedgerLine['source']
  /** a Square payment is on it */
  paidHere: boolean
  /** a door seat an owner marked paid at the counter (no sale matched it) */
  paidAtCounter?: boolean
  /** D3: booked online or on the iPad for $0 (a code or a $0 early-bird): no Square payment, nothing to refund */
  free?: boolean
  overCapacity: boolean
  /** a reader sale still waiting for the Square app (a hold) reads "Waiting on the reader" */
  state?: string
}

/** Seats the crew chose to add at the door (comp, counter, iPad, reader). */
export const crewSeat = (source: LedgerLine['source']) => source === 'comp' || source === 'door-counter' || source === 'door-card' || source === 'door-reader'

/** "Paid online", "Comped", "Not paid yet" (a pay-at-the-counter seat never rung up)… */
export function paidWay(b: BookingWordsInput): string {
  switch (b.source) {
    case 'online': return b.free ? 'Free booking' : 'Paid online'
    case 'door-card': return b.free ? 'Free booking' : 'Paid on the iPad'
    case 'door-counter': return b.paidHere || b.paidAtCounter ? 'Paid at the counter' : 'Not paid yet'
    case 'comp': return 'Comped'
    case 'pos': return 'Counter sale'
    case 'door-reader': return b.state === 'held' ? 'Waiting on the reader' : 'Paid on the reader'
    default: return ''
  }
}

/** A pay-at-the-counter seat nobody has rung up yet: no money has come in. */
export const unpaidCounter = (b: Pick<BookingWordsInput, 'source' | 'paidHere' | 'paidAtCounter'>) => b.source === 'door-counter' && !b.paidHere && !b.paidAtCounter

/**
 * The money a booking has actually brought in, less refunds: 0 for a comp and
 * for a counter seat not rung up yet (its price is only what it will cost).
 * /admin's "taken so far" and Past totals add these up.
 */
export function takenCents(b: Pick<BookingWordsInput, 'source' | 'paidHere' | 'paidAtCounter' | 'state'> & { paidCents: number; refundedCents: number }): number {
  if (b.source === 'comp' || unpaidCounter(b)) return 0
  // A reader sale still waiting on the Square app has brought nothing in yet.
  if (b.source === 'door-reader' && b.state === 'held') return 0
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
