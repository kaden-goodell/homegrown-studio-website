import { describe, it, expect } from 'vitest'
import { studioNight } from '@lib/quiet-hours'

describe('studioNight', () => {
  it('is 11 PM to 6 AM in the studio’s time zone (CST and CDT)', () => {
    expect(studioNight(new Date('2026-11-24T04:59:00Z'))).toBe(false) // 10:59 PM CST
    expect(studioNight(new Date('2026-11-24T05:00:00Z'))).toBe(true) // 11 PM CST
    expect(studioNight(new Date('2026-11-24T11:59:00Z'))).toBe(true) // 5:59 AM CST
    expect(studioNight(new Date('2026-11-24T12:00:00Z'))).toBe(false) // 6 AM CST
    expect(studioNight(new Date('2026-07-01T04:00:00Z'))).toBe(true) // 11 PM CDT
    expect(studioNight(new Date('2026-07-01T11:00:00Z'))).toBe(false) // 6 AM CDT
  })
})
