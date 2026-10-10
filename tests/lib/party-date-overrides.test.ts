import { describe, it, expect } from 'vitest'
import { bookableDates, bookableOn, partyStartsForDate } from '@lib/party-slots'

describe('one-off party days (partyDateOverrides)', () => {
  const now = new Date('2026-10-09T17:00:00Z')

  it('opens Sat Oct 24 all day even though parties start Nov 7', () => {
    const starts = partyStartsForDate('2026-10-24', now)
    expect(starts).toEqual([
      '2026-10-24T15:00:00.000Z', // 10:00 CDT
      '2026-10-24T17:30:00.000Z', // 12:30
      '2026-10-24T20:00:00.000Z', // 3:00
      '2026-10-24T22:30:00.000Z', // 5:30
    ])
    expect(bookableOn('2026-10-24', now)).toBe('ok')
  })

  it('leaves the other pre-opening days closed', () => {
    expect(partyStartsForDate('2026-10-25', now)).toEqual([])
    expect(partyStartsForDate('2026-10-17', now)).toEqual([])
    expect(bookableOn('2026-10-31', now)).toBe('before_opening')
  })

  it('starts the date range at the one-off day', () => {
    expect(bookableDates(now).first).toBe('2026-10-24')
  })

  it('still needs a week of notice', () => {
    expect(partyStartsForDate('2026-10-24', new Date('2026-10-20T17:00:00Z'))).toEqual([])
  })
})
