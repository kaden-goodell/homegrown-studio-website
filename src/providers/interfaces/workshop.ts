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
  /** Returns active workshops with availableCapacity > 0, sorted by startAt ascending */
  listWorkshops(): Promise<Workshop[]>
  /** Returns a single workshop by id (or null). Does NOT apply the capacity filter. */
  getWorkshop(id: string): Promise<Workshop | null>
}
