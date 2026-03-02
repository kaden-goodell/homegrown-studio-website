import { describe, it, expect } from 'vitest'
import {
  ProviderError,
  CapacityUnavailableError,
  PaymentFailedError,
  BookingConflictError,
} from '@lib/errors'

describe('typed errors', () => {
  it('ProviderError has provider and isInternal fields', () => {
    const err = new ProviderError('fail', 'square', true)
    expect(err.message).toBe('fail')
    expect(err.provider).toBe('square')
    expect(err.isInternal).toBe(true)
    expect(err).toBeInstanceOf(Error)
  })

  it('CapacityUnavailableError defaults to internal', () => {
    const err = new CapacityUnavailableError('square')
    expect(err.isInternal).toBe(true)
    expect(err.name).toBe('CapacityUnavailableError')
  })

  it('PaymentFailedError includes reason', () => {
    const err = new PaymentFailedError('square', 'card declined')
    expect(err.reason).toBe('card declined')
    expect(err.message).toContain('card declined')
  })

  it('BookingConflictError is not internal by default', () => {
    const err = new BookingConflictError('square')
    expect(err.isInternal).toBe(false)
  })
})
