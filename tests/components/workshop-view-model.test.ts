import { describe, it, expect } from 'vitest'
import { toWorkshopData } from '@components/workshops/workshop-view-model'
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
