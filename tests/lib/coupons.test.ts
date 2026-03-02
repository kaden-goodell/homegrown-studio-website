import { describe, it, expect } from 'vitest'
import { validateCoupon } from '@lib/coupons'

describe('coupon validation', () => {
  it('validates a valid percent coupon', () => {
    const result = validateCoupon('WELCOME10')
    expect(result.valid).toBe(true)
    expect(result.discount?.type).toBe('percent')
    expect(result.discount?.value).toBe(10)
  })

  it('validates a valid fixed coupon', () => {
    const result = validateCoupon('SPRING25')
    expect(result.valid).toBe(true)
    expect(result.discount?.type).toBe('fixed')
    expect(result.discount?.value).toBe(2500)
  })

  it('rejects unknown coupon code', () => {
    const result = validateCoupon('FAKECODE')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid coupon code')
  })

  it('is case-insensitive', () => {
    const result = validateCoupon('welcome10')
    expect(result.valid).toBe(true)
  })

  it('rejects inactive coupon', () => {
    const result = validateCoupon('EXPIRED99')
    expect(result.valid).toBe(false)
    expect(result.error).toBe('Coupon is no longer active')
  })
})
