import { describe, it, expect } from 'vitest'
import { taxCents, seatsTaxCents } from '@lib/tax'

describe('seatsTaxCents', () => {
  it('rounds each seat on its own, as Square charges them', () => {
    expect(taxCents(3750, 9)).toBe(338)
    // each seat its own order: 112.5 → 112 (half to even, as Square), ×3
    expect(seatsTaxCents([1250, 1250, 1250], 9)).toBe(336)
  })
  it('matches the whole-dollar prices exactly', () => {
    expect(seatsTaxCents([4500, 1500, 1500, 1500], 9)).toBe(810)
  })
  it('is 0 with no tax or no seats', () => {
    expect(seatsTaxCents([2000], undefined)).toBe(0)
    expect(seatsTaxCents([], 9)).toBe(0)
  })
})
