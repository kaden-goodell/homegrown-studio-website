import { describe, it, expect } from 'vitest'
import { cafeDayNotices, activeDayNotice, regularCafeHours } from '@lib/special-day-notice'

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
})
