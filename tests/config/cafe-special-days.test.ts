import { describe, it, expect } from 'vitest'
import { cafeHoursOn, CAFE_SPECIAL_DAYS } from '@config/hours'
import { cafeRunsOn } from '@lib/cafe-days'
import { partyStartsForDate } from '@lib/party-slots'

describe('Craft Café special days', () => {
  it('Nov 7 is all day, 9 AM to 9 PM (the grand opening)', () => {
    expect(cafeHoursOn('2026-11-07')).toEqual({ opens: '09:00', closes: '21:00' })
    expect(cafeRunsOn('2026-11-07')).toBe(true)
  })
  it('other Saturdays keep the weekly morning hours; other days have none', () => {
    expect(cafeHoursOn('2026-11-14')).toEqual({ opens: '09:00', closes: '12:00' })
    expect(cafeHoursOn('2026-11-15')).toBeNull()
    expect(cafeRunsOn('2026-11-15')).toBe(false)
  })
  it('a closed day stays closed', () => {
    expect(cafeRunsOn('2026-12-26')).toBe(false) // Christmas holidays, a Saturday
  })
  it('the Saturday after Thanksgiving is open (closed Thursday and Friday only)', () => {
    expect(cafeRunsOn('2026-11-28')).toBe(true)
  })
  it('an all-day café day has no party times', () => {
    for (const d of CAFE_SPECIAL_DAYS) expect(partyStartsForDate(d.date, new Date('2026-10-15T15:00:00Z'))).toEqual([])
  })
})
