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

/** Seats held for a customer, not yet paid for. */
export interface SeatReservation {
  bookingId: string
  /** The backend's own handle for the customer on this booking, if it has one. */
  contactToken: string | null
  orderId: string | null
}

/** Seats paid for and confirmed. */
export interface SeatBooking {
  bookingId: string
  orderId: string | null
  status: string
  receiptUrl: string | null
}

export interface WorkshopProvider {
  /** Returns active workshops with availableCapacity > 0, sorted by startAt ascending */
  listWorkshops(): Promise<Workshop[]>
  /** Returns a single workshop by id (or null). Does NOT apply the capacity filter. */
  getWorkshop(id: string): Promise<Workshop | null>

  /**
   * Hold seats for a customer. Nothing is charged.
   * Throws SeatBookingError (phase 'reserve') when the seats can't be held.
   */
  reserveSeats(params: {
    scheduleId: string
    /** ISO start of the occurrence being booked */
    startAt: string
    seats: number
    customer: { givenName: string; familyName: string; email: string }
  }): Promise<SeatReservation>

  /**
   * Charge for a reservation and confirm it, as one step: both happen or
   * neither does. `idempotencyKey` makes a repeat safe.
   * Throws SeatBookingError (phase 'pay'): `refused` means nothing was
   * charged, `no_answer` means we don't know.
   */
  payForSeats(params: {
    reservation: SeatReservation
    scheduleId: string
    paymentToken: string
    verificationToken?: string
    idempotencyKey: string
    /** Used only if the reservation carries no contact token. */
    fallbackCustomerId?: string
  }): Promise<SeatBooking>

  /** Let held seats go, after a refused payment. Throws if the backend won't. */
  releaseSeats(bookingId: string): Promise<void>
}
