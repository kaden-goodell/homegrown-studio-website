import { describe, it, expect } from 'vitest'
import { cafeHoursOn, CAFE_SPECIAL_DAYS } from '@config/hours'
import { cafeRunsOn } from '@lib/cafe-days'
import { partyFreeDays } from '@config/party.config'

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
    expect(cafeRunsOn('2026-11-28')).toBe(false)
  })
  it('every special café day keeps parties off it', () => {
    for (const d of CAFE_SPECIAL_DAYS) expect(partyFreeDays[d.date]).toBeTruthy()
  })
})
