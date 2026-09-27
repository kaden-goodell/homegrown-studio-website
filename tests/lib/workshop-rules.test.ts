import { describe, it, expect } from 'vitest'
import { canBeBooked } from '@lib/workshop-rules'

describe('canBeBooked', () => {
  it('is true for a workshop with a price', () => {
    expect(canBeBooked(4000)).toBe(true)
    expect(canBeBooked(1)).toBe(true)
  })

  it('is false for a free workshop: there are none', () => {
    expect(canBeBooked(0)).toBe(false)
  })

  it('is false when the price is missing or not a real amount', () => {
    for (const bad of [undefined, null, '', '4000', NaN, Infinity, -100, {}]) {
      expect(canBeBooked(bad)).toBe(false)
    }
  })
})
