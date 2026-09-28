export interface Workshop {
  /** classScheduleInstanceId — stable per occurrence */
  id: string
  /** classScheduleId — stable per workshop type */
  scheduleId: string
  name: string
  description: string
  descriptionHtml: string
  /** ISO 8601 */
  startAt: string
  durationMinutes: number
  priceCents: number
  priceCurrency: string
  availableCapacity: number
  staffName: string
  teamMemberId: string
  /** Card image (16:9), resolved from the paired catalog item's image with caption "card". */
  imageUrl?: string
  /** Flyer image (taller, more detailed), resolved from the paired catalog item's image with caption "flyer". */
  flyerUrl?: string
}

export interface WorkshopProvider {
  /**
   * Returns active, FUTURE workshops with availableCapacity > 0, sorted by
   * startAt ascending — this is the public listing (the /workshops page,
   * /api/workshops.json, availability checks). A class that already started
   * must not appear here even though `listAllWorkshops`/`getWorkshop` can
   * still resolve it for staff.
   */
  listWorkshops(): Promise<Workshop[]>
  /**
   * Returns a single workshop by scheduleId OR instance id (or null). Does NOT
   * apply the capacity or future-only filter — staff surfaces resolve an event
   * by its classScheduleId, and a SOLD-OUT or already-STARTED class is exactly
   * the one that still needs a roster, a print sheet and a check-in gate.
   */
  getWorkshop(id: string): Promise<Workshop | null>
  /**
   * Optional: every active workshop the provider currently has on hand, with
   * NEITHER the capacity nor the future-only filter applied — for staff
   * surfaces (`@lib/events` listEvents) that need to see an in-progress or
   * multi-day-in-the-past class in a day's listing, not just resolve one by
   * id. Providers that don't implement it are treated as if every workshop
   * they hand back is already such a list (falls back to `listWorkshops()`).
   */
  listAllWorkshops?(): Promise<Workshop[]>
}
