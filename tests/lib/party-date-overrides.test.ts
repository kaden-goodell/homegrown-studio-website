import { describe, it, expect } from 'vitest'
import { bookableDates, bookableOn, partyStartsForDate } from '@lib/party-slots'

describe('one-off party days (partyDateOverrides)', () => {
  const now = new Date('2026-10-09T17:00:00Z')

  it('opens Sat Oct 24 all day even though parties start Nov 7', () => {
    const starts = partyStartsForDate('2026-10-24', now)
    expect(starts).toEqual([
      '2026-10-24T14:00:00.000Z', // 9:00 CDT
      '2026-10-24T16:30:00.000Z', // 11:30
      '2026-10-24T19:00:00.000Z', // 2:00
      '2026-10-24T21:30:00.000Z', // 4:30
      '2026-10-25T00:00:00.000Z', // 7:00
    ])
    expect(bookableOn('2026-10-24', now)).toBe('ok')
  })

  it('leaves the other pre-opening days closed', () => {
    expect(partyStartsForDate('2026-10-25', now)).toEqual([])
    expect(partyStartsForDate('2026-10-17', now)).toEqual([])
    expect(bookableOn('2026-10-31', now)).toBe('before_opening')
  })

  it('starts the date range at the one-off day', () => {
    expect(bookableDates(now).first).toBe('2026-10-22')
  })

  it('still needs a week of notice', () => {
    expect(partyStartsForDate('2026-10-24', new Date('2026-10-20T17:00:00Z'))).toEqual([])
  })
})

describe('Thursday and Friday parties', () => {
  const now = new Date('2026-10-09T17:00:00Z')

  it('Thu Oct 22 has two parties, 4:00 and 6:30', () => {
    expect(partyStartsForDate('2026-10-22', now)).toEqual(['2026-10-22T21:00:00.000Z', '2026-10-22T23:30:00.000Z'])
  })

  it('Fri Oct 23 has one, at 4:00, before the evening class', () => {
    expect(partyStartsForDate('2026-10-23', now)).toEqual(['2026-10-23T21:00:00.000Z'])
  })

  it('carries on every Thursday and Friday at 4:00, before and after Nov 7', () => {
    expect(partyStartsForDate('2026-11-05', new Date('2026-10-20T17:00:00Z'))).toEqual(['2026-11-05T22:00:00.000Z'])
    expect(partyStartsForDate('2026-11-13', now)).toEqual(['2026-11-13T22:00:00.000Z'])
    expect(partyStartsForDate('2026-11-19', now)).toEqual(['2026-11-19T22:00:00.000Z'])
  })

  it('never on Monday to Wednesday', () => {
    expect(partyStartsForDate('2026-11-09', now)).toEqual([])
    expect(partyStartsForDate('2026-11-10', now)).toEqual([])
    expect(partyStartsForDate('2026-11-11', now)).toEqual([])
  })
})
