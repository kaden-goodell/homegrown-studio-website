/**
 * Our own classes as the /staff console sees them: one StudioEvent per class
 * (kind 'workshop', id = the cls_ id), its days from its sessions, and seats
 * counted from the seat ledger per session, so a class that meets on three
 * days shows each day's own seats. Server only.
 *
 * Seats "booked" on a session are seatsTaken (paid, comped, counter, a
 * refund that kept the seat, and holds still running): the same count the
 * shop sells against. Over capacity shows as it is ("41 of 40").
 */
import { studioDate } from '@lib/studio-time'
import { choiceTotals, prepOptions, type PrepOption, type SeatOption, type SeatPick } from '@lib/seat-options'
import { summarizeChoices, type RosterChoices, type SeatChoiceRecord } from '@lib/seat-choices'
import { seatsTaken, type Ledger, type LedgerLine } from './seat-ledger'
import type { ScheduledClass, Session } from './types'

export const isOwnClassId = (id: string) => id.startsWith('cls_')

/** Shown to staff: open or closed (sign-ups stopped). Drafts and cancelled classes are not on the console. */
export const onStaffConsole = (cls: ScheduledClass) => cls.status === 'open' || cls.status === 'closed'

/** The name staff see on a counter sale until a waiver puts a name on it. */
export const COUNTER_SALE_NO_NAME = 'Counter sale, no name yet'

export interface OwnSessionView {
  id: string
  /** studio-local YYYY-MM-DD */
  day: string
  startIso: string
  endIso: string
  capacity: number
  /** seats taken on this session (may be more than capacity) */
  sold: number
}

export function sessionViews(cls: ScheduledClass, ledger: Ledger, now: Date): OwnSessionView[] {
  return [...cls.sessions]
    .sort((a, b) => a.startIso.localeCompare(b.startIso))
    .map((s) => ({ id: s.id, day: studioDate(s.startIso), startIso: s.startIso, endIso: s.endIso, capacity: s.capacity, sold: seatsTaken(ledger, s.id, now) }))
}

/** The sessions on one studio day (usually one). */
export function sessionsOn(cls: ScheduledClass, day: string): Session[] {
  return cls.sessions.filter((s) => studioDate(s.startIso) === day).sort((a, b) => a.startIso.localeCompare(b.startIso))
}

/** A seat that is someone's (paid, comped, counter, or refunded but kept): what a roster and prep count. */
export function holdsSeat(l: LedgerLine): boolean {
  if (l.state === 'confirmed') return true
  if (l.state === 'refunded') return !l.refunds.some((r) => r.freedSeat)
  return false
}

/** Seats sitting in this day's session(s). */
export function linesOnDay(cls: ScheduledClass, ledger: Ledger, day: string): LedgerLine[] {
  const ids = new Set(sessionsOn(cls, day).map((s) => s.id))
  return ledger.lines.filter((l) => holdsSeat(l) && l.sessionIds.some((id) => ids.has(id)))
}

export const questionsAsOptions = (cls: ScheduledClass): SeatOption[] =>
  cls.content.questions.map((q) => ({ id: q.id, label: q.label, choices: [...q.choices] }))

const picksOf = (lines: LedgerLine[]): SeatPick[] =>
  lines.flatMap((l) => Object.entries(l.answers).filter(([, v]) => !!v).map(([optionId, choice]) => ({ seat: l.seat, optionId, choice })))

/**
 * The day's bookings in the shape the roster already reads (seat-choices), so
 * the family cards, the prep totals and "Paid or comped, not signed in yet"
 * work for our classes as they do for Square's. A counter sale with no name
 * yet is listed by that name.
 */
export function dayRecords(cls: ScheduledClass, ledger: Ledger, day: string): SeatChoiceRecord[] {
  const byBooking = new Map<string, LedgerLine[]>()
  for (const l of linesOnDay(cls, ledger, day)) byBooking.set(l.bookingId, [...(byBooking.get(l.bookingId) ?? []), l])
  return [...byBooking.values()].map((lines) => {
    lines.sort((a, b) => a.seat - b.seat)
    const first = lines[0]
    const named = lines.find((l) => l.customer)?.customer
    return {
      eventKind: 'workshop' as const,
      eventId: cls.id,
      bookingId: first.bookingId,
      orderId: first.square.orderId,
      customer: named ?? { givenName: COUNTER_SALE_NO_NAME, familyName: '', email: '', phone: '' },
      seats: lines.length,
      picks: picksOf(lines),
      at: first.at,
      attemptId: first.bookingId,
      ...(first.source === 'comp' ? { comped: true as const } : {}),
      // Only a door seat not yet rung up is still to pay ("Not paid yet").
      ...(first.source === 'door-counter' && !first.square.orderId && !first.paidAtCounter ? { payAtRegister: true as const } : {}),
      ...(first.by ? { by: first.by } : {}),
    }
  })
}

/** The roster's seat summary for one day of one of our classes. */
export function ownRosterChoices(cls: ScheduledClass, ledger: Ledger, day: string, signerEmails: string[], now: Date): RosterChoices {
  const records = dayRecords(cls, ledger, day)
  const sold = sessionsOn(cls, day).reduce((m, s) => Math.max(m, seatsTaken(ledger, s.id, now)), 0)
  return summarizeChoices(questionsAsOptions(cls), records, signerEmails, sold)
}

/** "Lavender 3 · Black 2" for one day of one of our classes; nothing when it asks no questions. */
export function ownPrep(cls: ScheduledClass, ledger: Ledger, day: string, now: Date): PrepOption[] | undefined {
  const options = questionsAsOptions(cls)
  if (!options.length) return undefined
  const lines = linesOnDay(cls, ledger, day)
  const sold = sessionsOn(cls, day).reduce((m, s) => Math.max(m, seatsTaken(ledger, s.id, now)), 0)
  return prepOptions(options, choiceTotals(options, picksOf(lines)), sold)
}

/** Lowest price of one seat, for the "Sell a seat" line. */
export function lowestSeatCents(cls: ScheduledClass): number | undefined {
  const all = Object.values(cls.content.prices).flatMap((row) => Object.values(row))
  return all.length ? Math.min(...all) : undefined
}
