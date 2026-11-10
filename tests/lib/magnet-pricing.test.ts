import { describe, it, expect } from 'vitest'
import { quoteMagnets, isValidSets } from '@lib/magnet-pricing'

describe('quoteMagnets', () => {
  it('prices one set for pickup with 9% tax', () => {
    expect(quoteMagnets(1, 'pickup')).toEqual({ sets: 1, magnets: 6, subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 })
  })
  it('adds $6 untaxed shipping', () => {
    expect(quoteMagnets(2, 'ship')).toEqual({ sets: 2, magnets: 12, subtotalCents: 3600, taxCents: 324, shippingCents: 600, totalCents: 4524 })
  })
})

describe('isValidSets', () => {
  it('accepts 1 to 10 whole sets', () => {
    expect(isValidSets(1)).toBe(true)
    expect(isValidSets(10)).toBe(true)
  })
  it('refuses 0, 11, fractions and non-numbers', () => {
    for (const v of [0, 11, 1.5, -1, '2', null, NaN]) expect(isValidSets(v)).toBe(false)
  })
})

describe('quoteSilhouettes', () => {
  it('is $25 each, 9% tax on the silhouettes, $6 untaxed shipping', async () => {
    const { quoteSilhouettes, isValidSilhouetteCount } = await import('@lib/magnet-pricing')
    expect(quoteSilhouettes(1, 'pickup')).toEqual({ count: 1, subtotalCents: 2500, taxCents: 225, shippingCents: 0, totalCents: 2725 })
    expect(quoteSilhouettes(2, 'ship')).toEqual({ count: 2, subtotalCents: 5000, taxCents: 450, shippingCents: 600, totalCents: 6050 })
    expect([0, 1, 6, 7, 1.5].map(isValidSilhouetteCount)).toEqual([false, true, true, false, false])
  })
})
