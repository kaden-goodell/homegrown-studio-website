import { describe, it, expect } from 'vitest'
import { cafeRunsOn } from '@lib/cafe-days'

describe('cafeRunsOn', () => {
  it('is Saturdays from the café start date', () => {
    expect(cafeRunsOn('2026-11-07')).toBe(true) // first café Saturday
    expect(cafeRunsOn('2026-11-08')).toBe(false) // Sunday
    expect(cafeRunsOn('2026-10-31')).toBe(false) // a Saturday before the start
  })
})
