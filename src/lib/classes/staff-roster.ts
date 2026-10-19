/**
 * The /staff roster's extra parts for one day of one of our own classes:
 * that day's seats, the seat summary the family cards read, and the day's
 * bookings (who, what kind of seat, refunds) for the refund and naming
 * buttons. Server only.
 */
import { eventOnDay, type StudioEvent } from '@lib/events'
import type { RosterChoices } from '@lib/seat-choices'
import { groupBookings, type BookingView } from './admin-actions'
import { getClass } from './class-store'
import { describeRequest } from './refunds'
import { isWaiting, listRefundRequests } from './refund-requests'
import { getLedger, setNames, type Ledger, type LedgerLine } from './seat-ledger'
import { COUNTER_SALE_NO_NAME, holdsSeat, ownRosterChoices, sessionsOn } from './staff-view'

export type WaitingRefund = ReturnType<typeof describeRequest>

export interface RosterBooking extends BookingView {
  /** "Ada Lovelace", or "Counter sale, no name yet" */
  name: string
  /** seats on this day's session */
  seatsToday: number
  /** a refund on this booking still waiting for someone to check Square (R29) */
  waiting: WaitingRefund | null
}

export interface OwnRoster {
  event: StudioEvent
  choices: RosterChoices
  bookings: RosterBooking[]
  /** ticket type id → label ("Adult"), for the refund panel */
  ticketLabels: Record<string, string>
}

const fullName = (c: LedgerLine['customer']) => (c ? `${c.givenName} ${c.familyName}`.trim() : '')

export async function ownRoster(event: StudioEvent, day: string, signerEmails: string[], now = new Date()): Promise<OwnRoster | null> {
  const cls = await getClass(event.id)
  if (!cls) return null
  const ledger: Ledger = await getLedger(cls.id)
  const today = new Set(sessionsOn(cls, day).map((s) => s.id))
  const onDay = (l: LedgerLine) => l.sessionIds.some((id) => today.has(id))
  const views = groupBookings(ledger, now).filter((b) => b.sessionIds.some((id) => today.has(id)))
  const bookings = await Promise.all(views.map(async (b): Promise<RosterBooking> => {
    const lines = ledger.lines.filter((l) => l.bookingId === b.bookingId)
    const waitingReq = b.paidHere ? (await listRefundRequests(cls.id, b.bookingId).catch(() => [])).find(isWaiting) : undefined
    return {
      ...b,
      name: fullName(b.customer) || COUNTER_SALE_NO_NAME,
      seatsToday: lines.filter((l) => onDay(l) && holdsSeat(l)).length,
      waiting: waitingReq ? describeRequest(waitingReq, ledger, cls) : null,
    }
  }))
  return {
    event: eventOnDay(event, day),
    choices: ownRosterChoices(cls, ledger, day, signerEmails, now),
    bookings,
    ticketLabels: Object.fromEntries(cls.content.ticketTypes.map((t) => [t.id, t.label])),
  }
}

/**
 * Puts a name on a booking's unnamed seats (a counter sale, or a door seat
 * taken before a name was given), from the waiver of the family at the door.
 * Seats that already carry a name keep it. Returns how many were named.
 */
export async function nameSeatsFromWaiver(
  classId: string, bookingId: string, adult: { firstName: string; lastName: string; email: string; phone: string },
): Promise<number> {
  const ledger = await getLedger(classId)
  const unnamed = ledger.lines.filter((l) => l.bookingId === bookingId && !l.customer && l.state !== 'released')
  if (!unnamed.length) return 0
  await setNames(classId, unnamed.map((l) => l.id), {
    givenName: adult.firstName.trim(), familyName: adult.lastName.trim(), email: adult.email.trim(), phone: adult.phone.trim(),
  })
  return unnamed.length
}
