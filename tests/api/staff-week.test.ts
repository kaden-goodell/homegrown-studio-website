import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let authed: any = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))
const mockListEvents = vi.fn()
vi.mock('@lib/events', async (orig) => ({ ...(await orig<typeof import('@lib/events')>()), listEvents: (...a: any[]) => mockListEvents(...a) }))
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
    mockListEvents.mockResolvedValue({ events: [], sources: { parties: 'error', workshops: 'error', classes: 'error' } })
    expect((await GET(req())).status).toBe(503)
    mockListEvents.mockResolvedValue({ events: [], sources: { parties: 'error', workshops: 'error', classes: 'ok' } })
    expect((await GET(req())).status).toBe(200)
    mockListEvents.mockResolvedValue({ events: [], sources: { parties: 'error', workshops: 'ok' } })
    expect((await GET(req())).status).toBe(200)
  })
  it('a multi-day class of ours: each of its days in the week with that day’s time, seats and prep', async () => {
    const sessions = [
      { id: 'ses_1', day: '2026-10-16', startIso: '2026-10-16T15:00:00.000Z', endIso: '2026-10-16T17:00:00.000Z', capacity: 8, sold: 3 },
      { id: 'ses_2', day: '2026-10-17', startIso: '2026-10-17T14:00:00.000Z', endIso: '2026-10-17T16:00:00.000Z', capacity: 8, sold: 9 },
    ]
    mockListEvents.mockResolvedValue({ events: [
      { kind: 'workshop', id: 'cls_camp', title: 'Camp', startIso: sessions[0].startIso, days: ['2026-10-16', '2026-10-17'], dropOff: true, capacity: 8, seats: 5, options: [{ id: 'g', label: 'Glaze', choices: ['Blue'] }], own: true, sessions },
    ], sources: { parties: 'ok', workshops: 'ok', classes: 'ok' } })
    mockPrep.mockImplementation(async (_e: any, day: string) => ({ prep: [{ id: 'g', label: 'Glaze', counts: [{ choice: 'Blue', n: day === '2026-10-17' ? 9 : 3 }], unpicked: 0 }] }))
    const { data } = await (await GET(req())).json()
    const row = data.events[0]
    expect(row.byDay['2026-10-16']).toMatchObject({ startIso: sessions[0].startIso, sold: 3, capacity: 8, prep: [{ counts: [{ n: 3 }] }] })
    expect(row.byDay['2026-10-17']).toMatchObject({ startIso: sessions[1].startIso, sold: 9, capacity: 8, prep: [{ counts: [{ n: 9 }] }] })
  })
})
