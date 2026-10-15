import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: any = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))
const mockListEvents = vi.fn()
vi.mock('@lib/events', () => ({ listEvents: (...a: any[]) => mockListEvents(...a) }))
const mockPrep = vi.fn()
vi.mock('@lib/event-prep', () => ({ prepForEvent: (...a: any[]) => mockPrep(...a) }))

import { GET } from '@pages/api/staff/week.json'
const req = () => ({ request: new Request('http://localhost/api/staff/week.json') }) as any

beforeEach(() => {
  authed = { id: 't', name: 'Test', role: 'crew' }
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z')) // Thu Oct 15, 10 AM CT
  mockPrep.mockResolvedValue({})
})
afterEach(() => vi.useRealTimers())

describe('GET /api/staff/week.json', () => {
  it('staff only', async () => {
    authed = null
    expect((await GET(req())).status).toBe(401)
  })
  it('asks for today through six days on, studio time', async () => {
    mockListEvents.mockResolvedValue({ events: [], sources: { parties: 'ok', workshops: 'ok' } })
    const body = await (await GET(req())).json()
    expect(mockListEvents).toHaveBeenCalledWith({ from: '2026-10-15', to: '2026-10-21' })
    expect(body.data).toMatchObject({ from: '2026-10-15', to: '2026-10-21', events: [] })
  })
  it('each event in time order with seats booked, party guests, and prep', async () => {
    mockListEvents.mockResolvedValue({ events: [
      { kind: 'workshop', id: 'c2', title: 'Pails', startIso: '2026-10-18T18:00:00Z', days: ['2026-10-18'], dropOff: true, capacity: 35, seats: 31, options: [] },
      { kind: 'party', id: 'p1', title: 'Rivera Party', startIso: '2026-10-17T18:30:00Z', days: ['2026-10-17'], dropOff: false, guests: 12 },
    ], sources: { parties: 'ok', workshops: 'ok' } })
    mockPrep.mockImplementation(async (e: any) => (e.id === 'c2' ? { prep: [{ id: 'x', label: 'Color', counts: [{ choice: 'Black', n: 4 }], unpicked: 0 }] } : {}))
    const { data } = await (await GET(req())).json()
    expect(data.events.map((e: any) => e.id)).toEqual(['p1', 'c2'])
    expect(data.events[0]).toMatchObject({ guests: 12 })
    expect(data.events[1]).toMatchObject({ sold: 4, dropOff: true, prep: [{ counts: [{ choice: 'Black', n: 4 }] }] })
  })
  it('both sources down is a 503; one down still answers', async () => {
    mockListEvents.mockResolvedValue({ events: [], sources: { parties: 'error', workshops: 'error' } })
    expect((await GET(req())).status).toBe(503)
    mockListEvents.mockResolvedValue({ events: [], sources: { parties: 'error', workshops: 'ok' } })
    expect((await GET(req())).status).toBe(200)
  })
})
