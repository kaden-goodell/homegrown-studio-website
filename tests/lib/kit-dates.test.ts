/**
 * Pure date math for the take-home kit product. All arithmetic is on
 * YYYY-MM-DD strings via UTC (no local-timezone Date traps, DST-safe).
 *
 * Reference weekdays used below (2026, not a leap year):
 *  - 2026-01-01 is a Thursday, so Thursdays fall on 07-09, 07-16, 07-23, 07-30…
 *  - 2026-03-01 is a Sunday (03-05 Thu) — spans the 03-08 DST spring-forward.
 *  - 2026-12-31 is a Thursday; 2027-01-01 is a Friday (year boundary).
 */
import { describe, it, expect } from 'vitest'
import { pickupThursdayFor, returnByFor, weekKeyFor, isOrderable, tierFor, addDays, assemblyWeekKeyFor, isWeekKey } from '@lib/kit-dates'

describe('pickupThursdayFor — latest Thursday ≤ party date', () => {
  it('a Saturday party picks up the Thursday of that week', () => {
    expect(pickupThursdayFor('2026-07-18')).toBe('2026-07-16')
  })
  it('a party ON Thursday picks up that same morning', () => {
    expect(pickupThursdayFor('2026-07-16')).toBe('2026-07-16')
  })
  it('a Friday party picks up the day before', () => {
    expect(pickupThursdayFor('2026-07-17')).toBe('2026-07-16')
  })
  it('a Wednesday party falls back to the previous Thursday', () => {
    expect(pickupThursdayFor('2026-07-15')).toBe('2026-07-09')
  })
  it('crosses a month boundary backward', () => {
    // 2026-08-02 is a Sunday; latest Thursday ≤ it is 2026-07-30.
    expect(pickupThursdayFor('2026-08-02')).toBe('2026-07-30')
  })
  it('crosses a year boundary backward', () => {
    // 2027-01-02 is a Saturday; latest Thursday ≤ it is 2026-12-31.
    expect(pickupThursdayFor('2027-01-02')).toBe('2026-12-31')
  })
  it('is DST-safe (spring-forward week)', () => {
    // 2026-03-10 is a Tuesday; its pickup Thursday is 2026-03-05.
    expect(pickupThursdayFor('2026-03-10')).toBe('2026-03-05')
  })
})

describe('returnByFor — pickup + 6 days (always a Wednesday)', () => {
  it('Thursday pickup returns the following Wednesday', () => {
    expect(returnByFor('2026-07-16')).toBe('2026-07-22')
  })
  it('spans a year boundary', () => {
    expect(returnByFor('2026-12-31')).toBe('2027-01-06')
  })
  it('is DST-safe (spans the spring-forward)', () => {
    // 2026-03-05 Thu + 6 = 2026-03-11 Wed, across the 03-08 clock change.
    expect(returnByFor('2026-03-05')).toBe('2026-03-11')
  })
})

describe('weekKeyFor — the pickup Thursday as the week key', () => {
  it('matches pickupThursdayFor for any day of the party week', () => {
    expect(weekKeyFor('2026-07-18')).toBe('2026-07-16')
    expect(weekKeyFor('2026-07-16')).toBe('2026-07-16')
    expect(weekKeyFor('2026-07-15')).toBe('2026-07-09')
  })
})

describe('isOrderable — pickup is at least the lead time away from now', () => {
  // partyDate 2026-07-18 → pickup Thursday 2026-07-16; lead time is 7 days.
  it('is orderable exactly at the 7-day cutoff', () => {
    expect(isOrderable('2026-07-18', '2026-07-09')).toBe(true)
  })
  it('is NOT orderable one day inside the cutoff', () => {
    expect(isOrderable('2026-07-18', '2026-07-10')).toBe(false)
  })
  it('is NOT orderable on pickup day itself', () => {
    expect(isOrderable('2026-07-18', '2026-07-16')).toBe(false)
  })
  it('is orderable with plenty of runway', () => {
    expect(isOrderable('2026-07-18', '2026-07-01')).toBe(true)
  })
  it('is NOT orderable once the pickup is in the past', () => {
    expect(isOrderable('2026-07-18', '2026-07-20')).toBe(false)
  })
})

describe('tierFor — round guests up to the next serves-5, clamped to configured tiers', () => {
  it('exact tier sizes map to themselves', () => {
    expect(tierFor(10)).toBe(10)
    expect(tierFor(15)).toBe(15)
    expect(tierFor(20)).toBe(20)
  })
  it('rounds up to the next offered tier', () => {
    expect(tierFor(11)).toBe(15)
    expect(tierFor(16)).toBe(20)
  })
  it('returns null above the largest tier', () => {
    expect(tierFor(21)).toBeNull()
    expect(tierFor(25)).toBeNull()
    expect(tierFor(30)).toBeNull()
  })
  it('returns null below the smallest tier', () => {
    // Rounds to serves-5, which is not a configured tier.
    expect(tierFor(5)).toBeNull()
  })
})

describe('assemblyWeekKeyFor — the pickup week staff are building for, rolling over Thursday morning', () => {
  // Thursdays in July 2026: 07-09, 07-16, 07-23.
  it('Mon–Wed point at this week’s Thursday', () => {
    expect(assemblyWeekKeyFor('2026-07-13')).toBe('2026-07-16') // Monday
    expect(assemblyWeekKeyFor('2026-07-15')).toBe('2026-07-16') // Wednesday
  })
  it('Thursday itself has already rolled over to next week', () => {
    expect(assemblyWeekKeyFor('2026-07-16')).toBe('2026-07-23')
  })
  it('Fri–Sun build toward the coming Thursday', () => {
    expect(assemblyWeekKeyFor('2026-07-17')).toBe('2026-07-23') // Friday
    expect(assemblyWeekKeyFor('2026-07-19')).toBe('2026-07-23') // Sunday
  })
  it('crosses a year boundary', () => {
    // 2026-12-31 is a Thursday → already assembling for 2027-01-07.
    expect(assemblyWeekKeyFor('2026-12-31')).toBe('2027-01-07')
  })
})

describe('isWeekKey — Thursdays only', () => {
  it('accepts a Thursday', () => {
    expect(isWeekKey('2026-07-16')).toBe(true)
  })
  it('rejects non-Thursdays and malformed strings', () => {
    expect(isWeekKey('2026-07-18')).toBe(false)
    expect(isWeekKey('not-a-date')).toBe(false)
    expect(isWeekKey('')).toBe(false)
  })
})

describe('addDays — UTC string arithmetic helper', () => {
  it('rolls across month and year boundaries', () => {
    expect(addDays('2026-07-16', 6)).toBe('2026-07-22')
    expect(addDays('2026-07-30', 3)).toBe('2026-08-02')
    expect(addDays('2026-12-31', 6)).toBe('2027-01-06')
    expect(addDays('2026-07-16', -7)).toBe('2026-07-09')
  })
})
