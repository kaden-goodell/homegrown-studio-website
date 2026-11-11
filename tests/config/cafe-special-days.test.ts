import { describe, it, expect } from 'vitest'
import { cafeHoursOn, CAFE_SPECIAL_DAYS } from '@config/hours'
import { cafeRunsOn } from '@lib/cafe-days'
import { partyStartsForDate } from '@lib/party-slots'

describe('Craft Café special days', () => {
  it('Nov 7 is all day, 9 AM to 9 PM (the grand opening)', () => {
    expect(cafeHoursOn('2026-11-07')).toEqual({ opens: '09:00', closes: '20:00' })
    expect(cafeRunsOn('2026-11-07')).toBe(true)
  })
  it('other Saturdays keep the weekly morning hours; other days have none', () => {
    expect(cafeHoursOn('2026-11-21')).toEqual({ opens: '09:00', closes: '13:00' })
    expect(cafeHoursOn('2026-11-22')).toBeNull()
    expect(cafeRunsOn('2026-11-22')).toBe(false)
  })
  it('a closed day stays closed', () => {
    expect(cafeRunsOn('2026-12-26')).toBe(false) // Christmas holidays, a Saturday
  })
  it('the Saturday after Thanksgiving is open (closed Thursday and Friday only)', () => {
    expect(cafeRunsOn('2026-11-28')).toBe(true)
  })
  it('an all-day café day has no party times', () => {
    expect(CAFE_SPECIAL_DAYS.find((d) => d.date === '2026-11-07')).toBeTruthy()
    expect(partyStartsForDate('2026-11-07', new Date('2026-10-15T15:00:00Z'))).toEqual([])
  })
  it('the Nov 13–15 café weekend keeps only Saturday 4:30 for parties', () => {
    const now = new Date('2026-10-15T15:00:00Z')
    expect(cafeHoursOn('2026-11-13')).toEqual({ opens: '16:00', closes: '20:00' })
    expect(cafeHoursOn('2026-11-14')).toEqual({ opens: '09:00', closes: '14:00' })
    expect(cafeHoursOn('2026-11-15')).toEqual({ opens: '14:00', closes: '18:00' })
    expect(partyStartsForDate('2026-11-13', now)).toEqual([])
    expect(partyStartsForDate('2026-11-14', now)).toEqual(['2026-11-14T22:30:00.000Z'])
    expect(partyStartsForDate('2026-11-15', now)).toEqual([])
  })
})
