import { describe, it, expect } from 'vitest'
import { partyConfig } from '@config/party.config'
import { bookableDates, bookableOn, partyStartsForDate, partyStartsInRange, localDate } from '@lib/party-slots'

// Noon Central on Sunday 27 Sep 2026. Opening day is Fri 16 Oct 2026.
const SEP_27 = new Date('2026-09-27T17:00:00.000Z')
// Noon Central on Tuesday 20 Oct 2026, after opening (still CDT).
const OCT_20 = new Date('2026-10-20T17:00:00.000Z')
// Noon Central on Tuesday 3 Nov 2026, after the clock change (CST, UTC-6).
const NOV_3 = new Date('2026-11-03T18:00:00.000Z')

describe('bookableDates', () => {
  it('uses the settings, not numbers typed here', () => {
    expect(partyConfig.bookingWindowDays).toBe(90)
    expect(partyConfig.minLeadDays).toBe(5)
  })

  it('before parties start, begins on the first party day (the weekend after opening) and ends 90 days from today', () => {
    expect(bookableDates(SEP_27)).toEqual({ first: '2026-11-07', last: '2026-12-26' })
  })

  it('after opening but before parties start, still begins on the first party day', () => {
    expect(bookableDates(OCT_20)).toEqual({ first: '2026-11-07', last: '2027-01-18' })
  })

  it('once parties have started, starts 5 days from today', () => {
    expect(bookableDates(NOV_3)).toEqual({ first: '2026-11-08', last: '2027-02-01' })
  })

  it('counts days on the studio calendar, not the UTC one', () => {
    // 11:30 PM Central on 20 Oct is already 21 Oct in UTC.
    const lateEvening = new Date('2026-10-21T04:30:00.000Z')
    expect(bookableDates(lateEvening).first).toBe('2026-11-07')
    // 11:30 PM Central on 3 Nov (CST) is already 4 Nov in UTC.
    const lateNov3 = new Date('2026-11-04T05:30:00.000Z')
    expect(bookableDates(lateNov3).first).toBe('2026-11-08')
  })

  it('crosses the clock change and the year end without slipping a day', () => {
    // Window set on 30 Oct (CDT) runs across the 1 Nov clock change.
    expect(bookableDates(new Date('2026-10-30T17:00:00.000Z')).last).toBe('2027-01-28')
    expect(bookableDates(new Date('2026-11-04T18:00:00.000Z')).first).toBe('2026-11-09')
    expect(bookableDates(new Date('2026-12-20T18:00:00.000Z')).last).toBe('2027-03-20')
  })
})

describe('bookableOn', () => {
  it('explains each refusal', () => {
    expect(bookableOn('2026-10-10', SEP_27)).toBe('before_opening')
    expect(bookableOn('2026-10-24', OCT_20)).toBe('before_opening')
    expect(bookableOn('2026-11-07', NOV_3)).toBe('too_soon')
    expect(bookableOn('2027-01-19', OCT_20)).toBe('too_far')
  })

  it('accepts both ends of the window', () => {
    expect(bookableOn('2026-11-07', OCT_20)).toBe('ok')
    expect(bookableOn('2027-01-18', OCT_20)).toBe('ok')
    expect(bookableOn('2026-11-08', NOV_3)).toBe('ok')
    expect(bookableOn('2027-02-01', NOV_3)).toBe('ok')
  })
})

describe('partyStartsForDate', () => {
  it('offers a Saturday its one party time (1:30 PM) for a date inside the window', () => {
    // Saturday 7 Nov 2026: 1:30 PM Central (CST, UTC-6).
    expect(partyStartsForDate('2026-11-07', SEP_27)).toEqual(['2026-11-07T19:30:00.000Z'])
  })

  it('offers a Sunday two party times (1:00 and 3:30 PM)', () => {
    // Sunday 8 Nov 2026 (CST, UTC-6).
    expect(partyStartsForDate('2026-11-08', SEP_27)).toEqual([
      '2026-11-08T19:00:00.000Z',
      '2026-11-08T21:30:00.000Z',
    ])
  })

  it('offers nothing past the 90-day window', () => {
    expect(partyStartsForDate('2026-12-19', SEP_27).length).toBeGreaterThan(0) // Saturday, day 83
    expect(partyStartsForDate('2027-01-02', SEP_27)).toEqual([]) // Saturday, day 97
    expect(partyStartsForDate('2027-01-09', SEP_27)).toEqual([])
  })

  it('offers nothing with less than 5 days\' notice', () => {
    expect(partyStartsForDate('2026-11-07', NOV_3)).toEqual([]) // Saturday, 4 days away
    expect(partyStartsForDate('2026-11-08', NOV_3).length).toBeGreaterThan(0) // Sunday, 5 days away
  })

  it('offers nothing before parties start (opening weekend included)', () => {
    expect(partyStartsForDate('2026-10-10', SEP_27)).toEqual([])
    expect(partyStartsForDate('2026-10-17', SEP_27)).toEqual([])
    expect(partyStartsForDate('2026-10-24', OCT_20)).toEqual([]) // the old first weekend
  })

  it('offers nothing on a day with no parties', () => {
    expect(partyStartsForDate('2026-10-21', SEP_27)).toEqual([]) // Wednesday
  })
})

describe('partyStartsInRange', () => {
  it('never returns a party time outside the window, however wide the range asked for', () => {
    const starts = partyStartsInRange('2026-09-27T17:00:00.000Z', '2027-03-01T06:00:00.000Z', SEP_27)
    const dates = [...new Set(starts.map((s) => localDate(s)))]
    expect(dates[0]).toBe('2026-11-07') // first Saturday on or after the party start date
    // The window ends Sat 26 Dec, but the studio is closed 21 Dec to 1 Jan: the last party day is Sun 20 Dec.
    expect(dates[dates.length - 1]).toBe('2026-12-20')
    for (const d of dates) {
      expect(d >= '2026-11-07').toBe(true)
      expect(d <= '2026-12-26').toBe(true)
      expect(d >= '2026-12-21' && d <= '2027-01-01').toBe(false)
    }
  })
})
