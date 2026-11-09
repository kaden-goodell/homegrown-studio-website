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
