import { describe, it, expect } from 'vitest'
import { byStart, studioClock, toWorkshopData, whenLabel } from '@components/workshops/workshop-view-model'
import type { Workshop } from '@providers/interfaces/workshop'

const SAMPLE: Workshop = {
  id: 'inst-1',
  scheduleId: 'sched-A',
  name: 'Glass Fusing',
  description: 'A class',
  descriptionHtml: '<p>A class</p>',
  startAt: '2026-06-10T17:00:00Z',
  durationMinutes: 120,
  priceCents: 6500,
  priceCurrency: 'USD',
  availableCapacity: 5,
  staffName: 'Kaden',
  teamMemberId: 'TM1',
}

describe('toWorkshopData', () => {
  it('derives the date string as YYYY-MM-DD from startAt', () => {
    const data = toWorkshopData(SAMPLE)
    expect(data.date).toBe('2026-06-10')
  })

  it('uses the studio-local (America/Chicago) day, not the UTC day, for evening classes', () => {
    // 7pm CDT on Fri Oct 16 is 00:00Z on Sat Oct 17 — must render as the 16th.
    const data = toWorkshopData({ ...SAMPLE, startAt: '2026-10-17T00:00:00Z' })
    expect(data.date).toBe('2026-10-16')
  })

  it('derives endTime by adding durationMinutes to startAt', () => {
    const data = toWorkshopData(SAMPLE)
    const end = new Date(data.endTime)
    const start = new Date(SAMPLE.startAt)
    expect(end.getTime() - start.getTime()).toBe(120 * 60 * 1000)
  })

  it('passes priceCents through as price (cents)', () => {
    const data = toWorkshopData(SAMPLE)
    expect(data.price).toBe(6500)
    expect(data.currency).toBe('USD')
  })

  it('sets remainingSeats from availableCapacity', () => {
    expect(toWorkshopData(SAMPLE).remainingSeats).toBe(5)
  })

  it('sets category to "workshop"', () => {
    expect(toWorkshopData(SAMPLE).category).toBe('workshop')
  })

  it('preserves classScheduleId and classScheduleInstanceId for the booking flow', () => {
    const data = toWorkshopData(SAMPLE)
    expect(data.classScheduleId).toBe('sched-A')
    expect(data.classScheduleInstanceId).toBe('inst-1')
  })

  it('passes Workshop.imageUrl through to WorkshopData.imageUrl', () => {
    const withImage = { ...SAMPLE, imageUrl: '/images/workshops/glass-fusing.jpg' }
    expect(toWorkshopData(withImage).imageUrl).toBe('/images/workshops/glass-fusing.jpg')
  })
})

describe('toWorkshopData — coming soon', () => {
  it('marks a workshop with no price as coming soon', () => {
    expect(toWorkshopData({ ...SAMPLE, priceCents: 0 }).comingSoon).toBe(true)
  })
  it('does not mark a priced workshop', () => {
    expect(toWorkshopData(SAMPLE).comingSoon).toBe(false)
  })
})

describe('toWorkshopData — sold out', () => {
  it('keeps a workshop with no seats left, with zero seats remaining', () => {
    const data = toWorkshopData({ ...SAMPLE, availableCapacity: 0 })
    expect(data.remainingSeats).toBe(0)
    expect(data.comingSoon).toBe(false)
  })
})

describe('studioClock', () => {
  it('is the studio wall clock, 24h, in summer (UTC-5) and winter (UTC-6)', () => {
    expect(studioClock('2026-10-17T00:00:00Z')).toBe('19:00')
    expect(studioClock('2026-12-05T20:30:00Z')).toBe('14:30')
  })

  it('reads midnight as 00:00, not 24:00', () => {
    expect(studioClock('2026-10-17T05:00:00Z')).toBe('00:00')
  })

  it('is empty for something that is not a time', () => {
    expect(studioClock('')).toBe('')
    expect(studioClock('soon')).toBe('')
  })
})

describe('whenLabel', () => {
  it('is the day and the time range, in studio time, with no year', () => {
    expect(
      whenLabel({ date: '2026-10-16', startTime: '2026-10-17T00:00:00Z', endTime: '2026-10-17T02:00:00.000Z' }),
    ).toBe('Fri, Oct 16 · 7–9 PM')
  })

  it('keeps minutes and both halves of the day when they differ', () => {
    expect(
      whenLabel({ date: '2026-10-24', startTime: '2026-10-24T16:30:00Z', endTime: '2026-10-24T18:00:00Z' }),
    ).toBe('Sat, Oct 24 · 11:30 AM–1 PM')
  })

  it('is just the day when the times cannot be read', () => {
    expect(whenLabel({ date: '2026-10-16', startTime: '', endTime: '' })).toBe('Fri, Oct 16')
  })
})

describe('byStart', () => {
  const at = (id: string, date: string, startTime: string) => ({ id, date, startTime })

  it('sorts by day, then by start time', () => {
    const list = [
      at('evening', '2026-10-25', '2026-10-26T00:00:00Z'),
      at('later-day', '2026-10-26', '2026-10-26T15:00:00Z'),
      at('afternoon', '2026-10-25', '2026-10-25T21:00:00Z'),
      at('first', '2026-10-16', '2026-10-17T00:00:00Z'),
    ]
    expect(list.sort(byStart).map((w) => w.id)).toEqual(['first', 'afternoon', 'evening', 'later-day'])
  })

  it('compares instants, not text: a time written with an offset still sorts right', () => {
    const list = [
      at('seven-pm', '2026-10-25', '2026-10-25T19:00:00-05:00'),
      at('four-pm', '2026-10-25', '2026-10-25T21:00:00Z'),
    ]
    expect(list.sort(byStart).map((w) => w.id)).toEqual(['four-pm', 'seven-pm'])
  })
})
