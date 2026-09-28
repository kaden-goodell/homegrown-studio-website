import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateCoupon } from '@lib/coupons'

// Fixture codes: the validation logic stays covered whatever the live config
// holds (every real code is switched off — see the last describe).
vi.mock('@config/coupons.json', () => ({
  default: {
    TESTPCT10: {
      type: 'percent',
      value: 10,
      description: '10% off',
      active: true,
      expiresAt: '2026-12-31',
    },
    TESTFIXED25: {
      type: 'fixed',
      value: 2500,
      description: '$25 off',
      active: true,
      expiresAt: null,
    },
    TESTOFF: {
      type: 'percent',
      value: 99,
      description: 'Switched off',
      active: false,
      expiresAt: null,
    },
    TESTLAPSED: {
      type: 'percent',
      value: 15,
      description: 'Active but past its date',
      active: true,
      expiresAt: '2026-01-01',
    },
  },
}))

describe('coupon validation', () => {
  // validateCoupon compares expiresAt with the real clock; pin it.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T18:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates a valid percent coupon', () => {
    const result = validateCoupon('TESTPCT10')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.discount.type).toBe('percent')
    expect(result.discount.value).toBe(10)
  })

  it('validates a valid fixed coupon', () => {
    const result = validateCoupon('TESTFIXED25')
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.discount.type).toBe('fixed')
    expect(result.discount.value).toBe(2500)
  })

  it('rejects unknown coupon code', () => {
    const result = validateCoupon('FAKECODE')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.error).toBe('Invalid coupon code')
  })

  it('is case-insensitive', () => {
    const result = validateCoupon('testpct10')
    expect(result.valid).toBe(true)
  })

  it('rejects inactive coupon', () => {
    const result = validateCoupon('TESTOFF')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.error).toBe('Coupon is no longer active')
  })

  it('rejects an active coupon past its expiry date', () => {
    const result = validateCoupon('TESTLAPSED')
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.error).toBe('Coupon has expired')
  })
})

describe('live coupon config', () => {
  it('has no active codes — no checkout applies discounts to the charge', async () => {
    const actual = await vi.importActual<{ default: Record<string, { active: boolean }> }>(
      '@config/coupons.json',
    )
    const active = Object.entries(actual.default)
      .filter(([, entry]) => entry.active)
      .map(([code]) => code)
    expect(active).toEqual([])
    expect(actual.default.WELCOME10.active).toBe(false)
    expect(actual.default.SPRING25.active).toBe(false)
  })
})
