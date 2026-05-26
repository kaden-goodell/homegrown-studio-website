import type { Workshop, WorkshopProvider } from '../interfaces/workshop'

const NOW = Date.now()
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const FIXTURES: Workshop[] = [
  {
    id: 'mock-ws-1',
    scheduleId: 'mock-sched-1',
    name: 'Mock Glass Fusing 101',
    description: 'Beginner glass fusing class.',
    descriptionHtml: '<p>Beginner glass fusing class.</p>',
    startAt: new Date(NOW + 3 * DAY).toISOString(),
    durationMinutes: 120,
    priceCents: 6500,
    priceCurrency: 'USD',
    availableCapacity: 6,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
  {
    id: 'mock-ws-2',
    scheduleId: 'mock-sched-2',
    name: 'Mock Candle Pouring',
    description: 'Make your own soy candle.',
    descriptionHtml: '<p>Make your own soy candle.</p>',
    startAt: new Date(NOW + 7 * DAY).toISOString(),
    durationMinutes: 90,
    priceCents: 4500,
    priceCurrency: 'USD',
    availableCapacity: 4,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
  {
    id: 'mock-sold-out-1',
    scheduleId: 'mock-sched-3',
    name: 'Mock Sold-Out Workshop',
    description: 'This one is full.',
    descriptionHtml: '<p>This one is full.</p>',
    startAt: new Date(NOW + 10 * DAY).toISOString(),
    durationMinutes: 60,
    priceCents: 3500,
    priceCurrency: 'USD',
    availableCapacity: 0,
    staffName: 'Mock Instructor',
    teamMemberId: 'TM-mock',
  },
]

export class MockWorkshopProvider implements WorkshopProvider {
  async listWorkshops(): Promise<Workshop[]> {
    return FIXTURES
      .filter((w) => w.availableCapacity > 0)
      .slice()
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }

  async getWorkshop(id: string): Promise<Workshop | null> {
    return FIXTURES.find((w) => w.id === id) ?? null
  }
}
