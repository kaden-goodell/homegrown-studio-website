/** How /admin names a class's price, status, bookings and library runs. Browser-safe. */
import type { ClassBooking, LibraryRun } from '@lib/classes/admin-actions'
import type { ClassContent, ClassStatus, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { ownPriceLabel } from '@lib/classes/public-class'
import { paidWay, takenCents } from '@lib/classes/booking-words'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import { dayLabel } from './dates'

/** "$30", "$20 adult · $15 kid", "From $15". */
export const priceOf = (c: ClassContent) => ownPriceLabel(c as unknown as Parameters<typeof ownPriceLabel>[0])

export const latestOf = (l: LibraryClass) => l.versions[l.versions.length - 1]

/** "Oct 23" */
export const shortDay = (iso: string) => dayLabel(localDate(iso)).replace(/^\w+ /, '')

/** "Last ran Oct 23", "First runs Oct 30", or "Not run yet". */
export function ranText(run?: LibraryRun): string {
  if (run?.lastIso) return `Last ran ${shortDay(run.lastIso)}`
  if (run?.nextIso) return `First runs ${shortDay(run.nextIso)}`
  return 'Not run yet'
}

export const STATUS_TAG: Record<ClassStatus, string | null> = { open: null, draft: 'Draft', closed: 'Sign-ups closed', cancelled: 'Cancelled' }

/** Every date has ended. */
export const isPast = (c: Pick<ScheduledClass, 'sessions'>, now = Date.now()) => c.sessions.length > 0 && c.sessions.every((s) => Date.parse(s.endIso) <= now)

/** The date to show for a class: the next one that hasn't ended, or the last. */
export function nextSession(c: Pick<ScheduledClass, 'sessions'>, now = Date.now()) {
  return c.sessions.find((s) => Date.parse(s.endIso) > now) ?? c.sessions[c.sessions.length - 1]
}

export const nameOf = (b: Pick<ClassBooking, 'customer'>) => (b.customer ? `${b.customer.givenName} ${b.customer.familyName}`.trim() : '') || 'No name yet'

/**
 * How a booking paid, in /staff's words (paidWay), with the money when some
 * came in: "Paid online · $76.30", "Comped", "Not paid yet" (I3).
 */
export function moneyWords(b: Pick<ClassBooking, 'source' | 'paidHere' | 'paidCents' | 'refundedCents'> & { paidAtCounter?: boolean }): string {
  const way = paidWay({ source: b.source, paidHere: b.paidHere, paidAtCounter: b.paidAtCounter, overCapacity: false })
  const money = takenCents(b) > 0 || b.refundedCents > 0 ? b.paidCents : 0
  return money ? `${way} · ${formatMoney(money)}` : way
}

/** Seats a booking still holds (a freed seat no longer counts): the server's seat-status count (R43). */
export const seatsHeld = (b: Pick<ClassBooking, 'seatsComing'>) => b.seatsComing

/** The booking is coming to the class: at least one seat not freed, and not just someone paying right now. */
export const isComingBooking = (b: Pick<ClassBooking, 'state' | 'seatsComing'>) => b.state !== 'held' && b.seatsComing > 0
