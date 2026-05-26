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
  /** Reserved for the workshops-launch feature. Square's class API does not
   *  provide images; this will be populated by an image-linker from
   *  public/images/workshops/ in the next plan. Stays undefined for now. */
  imageUrl?: string
}

export interface WorkshopProvider {
  /** Returns active workshops with availableCapacity > 0, sorted by startAt ascending */
  listWorkshops(): Promise<Workshop[]>
  /** Returns a single workshop by id (or null). Does NOT apply the capacity filter. */
  getWorkshop(id: string): Promise<Workshop | null>
}
