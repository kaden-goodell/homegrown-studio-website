export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public isInternal: boolean = false,
    public originalError?: unknown,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export class CapacityUnavailableError extends ProviderError {
  constructor(provider: string) {
    super('Capacity data unavailable', provider, true)
    this.name = 'CapacityUnavailableError'
  }
}

export class PaymentFailedError extends ProviderError {
  constructor(provider: string, public reason: string) {
    super(`Payment failed: ${reason}`, provider)
    this.name = 'PaymentFailedError'
  }
}

export class BookingConflictError extends ProviderError {
  constructor(provider: string) {
    super('Booking slot no longer available', provider)
    this.name = 'BookingConflictError'
  }
}

/**
 * A seat booking (workshop) that the backend did not complete.
 *
 *  - `refused`   → the backend answered "no". Nothing was charged.
 *  - `no_answer` → it never answered (dropped connection, timeout, its own
 *                  failure). At the `pay` step that means the charge MAY have
 *                  gone through: never tell the customer "not charged".
 *
 * `raw` is whatever the backend said, for the server log only.
 */
export class SeatBookingError extends ProviderError {
  constructor(
    provider: string,
    public phase: 'reserve' | 'pay',
    public kind: 'refused' | 'no_answer',
    public raw: string,
    public status?: number,
  ) {
    super(`Seat booking ${phase} ${kind}`, provider)
    this.name = 'SeatBookingError'
  }
}

/**
 * Read an unknown error as a SeatBookingError, by shape rather than by class.
 * `instanceof` breaks when the class is loaded twice (separate bundles, test
 * module resets), and misreading a refusal as "no answer" would be wrong.
 */
export function asSeatBookingError(err: unknown): SeatBookingError | null {
  const e = err as Partial<SeatBookingError> | null
  if (!e || e.name !== 'SeatBookingError') return null
  if (e.kind !== 'refused' && e.kind !== 'no_answer') return null
  return e as SeatBookingError
}
