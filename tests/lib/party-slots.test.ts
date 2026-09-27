import { describe, it, expect } from 'vitest'
import { partyConfig } from '@config/party.config'
import { bookableDates, bookableOn, partyStartsForDate, partyStartsInRange, localDate } from '@lib/party-slots'

// Noon Central on Sunday 27 Sep 2026. Opening day is Fri 16 Oct 2026.
const SEP_27 = new Date('2026-09-27T17:00:00.000Z')
// Noon Central on Tuesday 20 Oct 2026, after opening.
const OCT_20 = new Date('2026-10-20T17:00:00.000Z')

describe('bookableDates', () => {
  it('uses the settings, not numbers typed here', () => {
    expect(partyConfig.bookingWindowDays).toBe(45)
    expect(partyConfig.minLeadDays).toBe(5)
  })

  it('before opening, starts on opening day and ends 45 days from today', () => {
    expect(bookableDates(SEP_27)).toEqual({ first: '2026-10-16', last: '2026-11-11' })
  })

  it('after opening, starts 5 days from today', () => {
    expect(bookableDates(OCT_20)).toEqual({ first: '2026-10-25', last: '2026-12-04' })
  })

  it('counts days on the studio calendar, not the UTC one', () => {
    // 11:30 PM Central on 20 Oct is already 21 Oct in UTC.
    const lateEvening = new Date('2026-10-21T04:30:00.000Z')
    expect(bookableDates(lateEvening).first).toBe('2026-10-25')
  })

  it('crosses the clock change and the year end without slipping a day', () => {
    expect(bookableDates(new Date('2026-10-30T17:00:00.000Z')).first).toBe('2026-11-04')
    expect(bookableDates(new Date('2026-12-20T18:00:00.000Z')).last).toBe('2027-02-03')
  })
})

describe('bookableOn', () => {
  it('explains each refusal', () => {
    expect(bookableOn('2026-10-10', SEP_27)).toBe('before_opening')
    expect(bookableOn('2026-10-24', OCT_20)).toBe('too_soon')
    expect(bookableOn('2026-12-05', OCT_20)).toBe('too_far')
  })

  it('accepts both ends of the window', () => {
    expect(bookableOn('2026-10-25', OCT_20)).toBe('ok')
    expect(bookableOn('2026-12-04', OCT_20)).toBe('ok')
  })
})

describe('partyStartsForDate', () => {
  it('offers the day\'s party times for a date inside the window', () => {
    // Saturday 17 Oct 2026: 9:00, 11:30, 2:00 and 4:30 Central (CDT, UTC-5).
    expect(partyStartsForDate('2026-10-17', SEP_27)).toEqual([
      '2026-10-17T14:00:00.000Z',
      '2026-10-17T16:30:00.000Z',
      '2026-10-17T19:00:00.000Z',
      '2026-10-17T21:30:00.000Z',
    ])
  })

  it('offers nothing past the 45-day window', () => {
    expect(partyStartsForDate('2026-11-07', SEP_27).length).toBeGreaterThan(0) // Saturday, day 41
    expect(partyStartsForDate('2026-11-14', SEP_27)).toEqual([]) // Saturday, day 48
    expect(partyStartsForDate('2026-12-05', SEP_27)).toEqual([])
  })

  it('offers nothing with less than 5 days\' notice', () => {
    expect(partyStartsForDate('2026-10-24', OCT_20)).toEqual([]) // Saturday, 4 days away
    expect(partyStartsForDate('2026-10-25', OCT_20).length).toBeGreaterThan(0) // Sunday, 5 days away
  })

  it('offers nothing before opening day', () => {
    expect(partyStartsForDate('2026-10-10', SEP_27)).toEqual([])
  })

  it('offers nothing on a day with no parties', () => {
    expect(partyStartsForDate('2026-10-21', SEP_27)).toEqual([]) // Wednesday
  })
})

describe('partyStartsInRange', () => {
  it('never returns a party time outside the window, however wide the range asked for', () => {
    const starts = partyStartsInRange('2026-09-27T17:00:00.000Z', '2027-03-01T06:00:00.000Z', SEP_27)
    const dates = [...new Set(starts.map((s) => localDate(s)))]
    expect(dates[0]).toBe('2026-10-17') // first Saturday on or after opening day
    expect(dates[dates.length - 1]).toBe('2026-11-08') // last party day on or before 11 Nov
    for (const d of dates) {
      expect(d >= '2026-10-16').toBe(true)
      expect(d <= '2026-11-11').toBe(true)
    }
  })
})
