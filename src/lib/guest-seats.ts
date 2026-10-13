/**
 * Seats 2+ on a class booking, as their own attendees in Square.
 *
 * Square's classes count one person per booking, so a family's extra seats
 * have to be added one by one or the class's "seats left" is wrong. Each
 * extra seat gets a name-only guest customer ("Maxie Gardner (guest 2 of 3)")
 * and is added with Square's own Add attendee (the saved dashboard sign-in).
 *
 * Used by the online booking (money already taken on the first booking, so
 * each guest seat's order is settled at $0) and by staff Comp / Sell a seat
 * (orders left as they are: comped, or paid at the register).
 *
 * Never cancels anything. Stops at the first seat Square won't add and says
 * how many went in, so a person can add the rest.
 */
import { providers } from '@config/providers'
import { addClassAttendee, classBookingOrderId } from '@lib/square-dashboard'
import { createLogger } from '@lib/logger'

const logger = createLogger('guest-seats')

export interface GuestSeatsResult {
  /** Square booking ids of the guest seats that went in, in seat order. */
  bookingIds: string[]
  /** Why adding stopped early; null when every guest seat went in. */
  stopped: { kind: 'signed_out' | 'refused' | 'no_answer' | 'guest_customer'; status?: number; detail: string } | null
  /** Guest seats that went in but whose Square order still shows money owed. */
  unsettled: string[]
}

export const guestSeatName = (familyName: string, seat: number, of: number) => `${familyName} (guest ${seat} of ${of})`

export interface GuestSeatParams {
  scheduleId: string
  startAt: string
  className: string
  holder: { givenName: string; familyName: string; email: string }
  totalSeats: number
  /** e.g. "Online seat", "Comped seat". Goes in each guest's Square note. */
  what: string
  /** When set, each guest seat's order is taken to $0 under this label. */
  settleAs?: string
}

export type OneGuestSeat =
  | { ok: true; bookingId: string; settled: boolean }
  | { ok: false; stopped: NonNullable<GuestSeatsResult['stopped']> }

/** Add guest seat number `seat` (2 or more) of `totalSeats`. */
export async function addOneGuestSeat(params: GuestSeatParams & { seat: number }): Promise<OneGuestSeat> {
  const { scheduleId, startAt, className, holder, totalSeats, what, settleAs, seat } = params
  let customerId: string
  try {
    customerId = (await providers.customer.createGuest({
      givenName: holder.givenName,
      familyName: guestSeatName(holder.familyName, seat, totalSeats),
      note: `${what} ${seat} of ${totalSeats} with ${holder.givenName} ${holder.familyName} <${holder.email}>, ${className}.`,
    })).id
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 200) : String(err)
    logger.error('Could not create a guest customer', { scheduleId, seat, detail })
    return { ok: false, stopped: { kind: 'guest_customer', detail } }
  }
  const added = await addClassAttendee({ scheduleId, startAt, customerId })
  if (!added.ok) {
    logger.error('Square did not add a guest seat', { scheduleId, seat, kind: added.kind, status: added.status, detail: added.detail })
    return { ok: false, stopped: { kind: added.kind, ...(added.status ? { status: added.status } : {}), detail: added.detail } }
  }
  if (!settleAs) return { ok: true, bookingId: added.bookingId, settled: false }
  const settled = await settleGuestSeatOrder(scheduleId, added.bookingId, added.orderId, settleAs)
  return { ok: true, bookingId: added.bookingId, settled }
}

/** Take a guest seat's Square order to $0. False (logged) when it can't. */
export async function settleGuestSeatOrder(scheduleId: string, bookingId: string, orderId: string | null, label: string): Promise<boolean> {
  try {
    const id = orderId ?? (await classBookingOrderId(scheduleId, bookingId))
    if (!id) throw new Error('Square did not say which order the seat opened')
    await providers.workshop.settleGuestSeat({ orderId: id, label })
    return true
  } catch (err) {
    logger.error('Guest seat added but its order not settled', { scheduleId, bookingId, error: err instanceof Error ? err.message : String(err) })
    return false
  }
}

/** Seats `firstSeat`..`totalSeats`, one after another; stops at the first Square won't add. */
export async function addGuestSeats(params: GuestSeatParams & { firstSeat: number }): Promise<GuestSeatsResult> {
  const result: GuestSeatsResult = { bookingIds: [], stopped: null, unsettled: [] }
  for (let seat = params.firstSeat; seat <= params.totalSeats; seat++) {
    const one = await addOneGuestSeat({ ...params, seat })
    if (!one.ok) {
      result.stopped = one.stopped
      break
    }
    result.bookingIds.push(one.bookingId)
    if (params.settleAs && !one.settled) result.unsettled.push(one.bookingId)
  }
  return result
}
