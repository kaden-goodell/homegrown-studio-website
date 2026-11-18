/**
 * The seat records one day of a class has, in the shape guest-links.ts reads,
 * for our own classes (the seat ledger) and Square-era ones (seat-choices).
 * Shared by the roster and the "With Shelby" route so the button and the
 * check agree. Server only.
 */
import type { StudioEvent } from '@lib/events'
import { listSeatChoicesByEvent, type SeatChoiceRecord } from '@lib/seat-choices'
import { getClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { dayRecords } from '@lib/classes/staff-view'
import { guestSeatView, listGuestLinks, type GuestSeatView } from '@lib/guest-links'

export async function seatRecordsForDay(event: StudioEvent, day: string): Promise<SeatChoiceRecord[]> {
  if (event.own) {
    const cls = await getClass(event.id)
    return cls ? dayRecords(cls, await getLedger(cls.id), day) : []
  }
  return listSeatChoicesByEvent('workshop', event.id)
}

export async function guestViewFor(
  eventId: string,
  records: SeatChoiceRecord[],
  households: { recordId: string; email: string; signer: string }[],
): Promise<GuestSeatView> {
  return guestSeatView(records, households, await listGuestLinks(eventId))
}
