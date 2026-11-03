import { describe, it, expect } from 'vitest'
import { waitlistQuietNow } from '@lib/classes/waitlist-quiet'

describe('waitlist quiet hours (final review I12): 8 AM–8 PM Chicago only', () => {
  it.each([
    ['2026-11-02T13:59:00.000Z', true], // 7:59 AM CST
    ['2026-11-02T14:00:00.000Z', false], // 8:00 AM CST
    ['2026-11-03T01:59:00.000Z', false], // 7:59 PM CST
    ['2026-11-03T02:00:00.000Z', true], // 8:00 PM CST
    ['2026-07-01T12:59:00.000Z', true], // 7:59 AM CDT
    ['2026-07-01T13:00:00.000Z', false], // 8:00 AM CDT
  ])('%s quiet=%s', (iso, quiet) => {
    expect(waitlistQuietNow(new Date(iso))).toBe(quiet)
  })
})
