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
