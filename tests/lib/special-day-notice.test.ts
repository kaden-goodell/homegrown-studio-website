import { describe, it, expect } from 'vitest'
import { cafeDayNotices, activeDayNotice, regularCafeHours } from '@lib/special-day-notice'
import { CONFIG_CAFE_HOURS } from '@config/hours'

describe('special-day notices (the grand opening)', () => {
  const [opening] = cafeDayNotices()

  it('announces the Nov 7 grand opening with its own café hours', () => {
    expect(opening).toMatchObject({
      date: '2026-11-07',
      headline: 'Grand Opening Day',
      weekday: 'SAT',
      monthDay: 'NOV 7',
      shortDate: 'Sat Nov 7',
      hours: '9 AM – 8 PM',
      regularHours: 'Saturdays 9 AM – 1 PM',
    })
  })

  it('shows from midnight three weeks ahead until the café closes at 8 PM (CST)', () => {
    expect(opening.showFromIso).toBe('2026-10-17T05:00:00.000Z') // Oct 17 midnight CDT
    expect(opening.showUntilIso).toBe('2026-11-08T02:00:00.000Z') // Nov 7, 8 PM CST
  })

  it('is active inside that window and gone outside it', () => {
    expect(activeDayNotice(new Date('2026-10-16T12:00:00Z'))).toBeNull()
    expect(activeDayNotice(new Date('2026-11-02T12:00:00Z'))?.date).toBe('2026-11-07')
    expect(activeDayNotice(new Date('2026-11-08T01:59:00Z'))?.date).toBe('2026-11-07') // 7:59 PM on the day
    expect(activeDayNotice(new Date('2026-11-08T02:00:00Z'))).toBeNull() // 8 PM, café closed
  })

  it('words the usual café hours from the weekly schedule', () => {
    expect(regularCafeHours()).toBe('Saturdays 9 AM – 1 PM')
  })

  it('reads the café hours in use (the owners’ saved settings), not only the config', () => {
    const saved = {
      weekly: [{ weekday: 'Saturday' as const, opens: '10:00', closes: '14:00' }],
      special: [{ ...CONFIG_CAFE_HOURS.special[0], closes: '18:00' }, { date: '2026-12-12', opens: '09:00', closes: '12:00', name: 'Quiet day' }],
    }
    const notices = cafeDayNotices(saved)
    expect(notices.map((n) => n.date)).toEqual(['2026-11-07']) // only announced days
    expect(notices[0]).toMatchObject({ hours: '9 AM – 6 PM', regularHours: 'Saturdays 10 AM – 2 PM', showUntilIso: '2026-11-08T00:00:00.000Z' })
    expect(cafeDayNotices({ weekly: saved.weekly, special: [] })).toEqual([])
  })
})
