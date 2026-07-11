import type { Workshop } from '@providers/interfaces/workshop'
import type { WorkshopData } from './WorkshopExplorer'

/**
 * Build the UI view-model from a domain Workshop.
 * All derived fields (date string, endTime, etc.) are computed in this
 * single place — components consume WorkshopData directly.
 */
export function toWorkshopData(w: Workshop): WorkshopData {
  const start = new Date(w.startAt)
  const end = new Date(start.getTime() + w.durationMinutes * 60_000)
  // TODO(timezone): w.startAt is UTC ISO. `.split('T')[0]` returns the UTC
  // date string, but WorkshopCard parses it as
  // local midnight. For a late-evening local time whose UTC equivalent
  // crosses midnight, the rendered date can be off by one day. Pre-existing
  // bug carried over from workshops.astro; resolve in the workshops-launch plan.
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    category: 'workshop',
    date: w.startAt.split('T')[0],
    startTime: w.startAt,
    endTime: end.toISOString(),
    duration: w.durationMinutes,
    price: w.priceCents,
    currency: w.priceCurrency,
    remainingSeats: w.availableCapacity,
    classScheduleId: w.scheduleId,
    classScheduleInstanceId: w.id,
    teamMemberId: w.teamMemberId,
    imageUrl: w.imageUrl,
    flyerUrl: w.flyerUrl,
  }
}
