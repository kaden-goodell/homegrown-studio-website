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
  /**
   * Returns active workshops that have not started yet, sorted by startAt
   * ascending — this is the public listing (the /workshops page,
   * /api/workshops.json). Sold-out workshops (availableCapacity 0) are
   * INCLUDED, so pages can show them as "Sold out"; they leave the list when
   * their start time passes. Callers that need seats must check
   * availableCapacity themselves. A class that already started must not appear
   * here even though `listAllWorkshops`/`getWorkshop` can still resolve it for
   * staff.
   */
  listWorkshops(): Promise<Workshop[]>
  /**
   * Returns a single workshop by scheduleId OR instance id (or null). Does NOT
   * apply the future-only filter, and sold out or not makes no difference —
   * staff surfaces resolve an event by its classScheduleId, and a SOLD-OUT or
   * already-STARTED class is exactly the one that still needs a roster, a
   * print sheet and a check-in gate.
   */
  getWorkshop(id: string): Promise<Workshop | null>
  /**
   * Optional: every active workshop the provider currently has on hand, with
   * the future-only filter NOT applied — for staff surfaces (`@lib/events`
   * listEvents) that need to see an in-progress or multi-day-in-the-past class
   * in a day's listing, not just resolve one by id. Providers that don't
   * implement it are treated as if every workshop they hand back is already
   * such a list (falls back to `listWorkshops()`).
   */
  listAllWorkshops?(): Promise<Workshop[]>

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
