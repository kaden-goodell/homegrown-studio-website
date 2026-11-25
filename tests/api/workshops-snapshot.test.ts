import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Kaden, 24 Nov 2026: /api/workshops.json serves Square's list from the copy
 * the 5-minute alerts job saves, instead of waiting 8+ seconds on Square.
 */
const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({ providers: { workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) } } }))
vi.mock('@lib/event-meta', () => ({ getEventMeta: async () => null }))
const mockMovedTo = vi.fn()
vi.mock('@lib/moved-classes', () => ({
  movedToFor: (id: string) => mockMovedTo(id),
  withoutMoved: async (list: any[], idOf: (x: any) => string) => {
    const out = []
    for (const x of list) if (!(await mockMovedTo(idOf(x)))) out.push(x)
    return out
  },
}))

import { GET } from '@pages/api/workshops.json'
import { GET as calendarGET } from '@pages/api/calendar.json'
import { forgetAll } from '@lib/short-memory'
import { _setSnapshotDeps, refreshWorkshopSnapshot } from '@lib/workshop-snapshot'
import { memoryKv } from '../helpers-memory-kv'

const workshop = (id: string, startAt: string) => ({
  id, scheduleId: `sch-${id}`, name: id, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
  priceCents: 2500, priceCurrency: 'USD', availableCapacity: 10, staffName: '', teamMemberId: '',
})

async function get(query = '') {
  const res = await GET({ request: new Request(`http://localhost/api/workshops.json${query}`) } as any)
  return { res, body: await res.json() }
}

let kv: ReturnType<typeof memoryKv>
beforeEach(async () => {
  forgetAll()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T20:00:00.000Z'))
  kv = memoryKv()
  _setSnapshotDeps({ store: kv })
  mockMovedTo.mockResolvedValue(null)
  mockListWorkshops.mockReset()
  mockListWorkshops.mockResolvedValue([workshop('saved', '2026-11-28T00:00:00.000Z')])
  await refreshWorkshopSnapshot()
  mockListWorkshops.mockReset()
  mockListWorkshops.mockResolvedValue([workshop('live', '2026-11-29T00:00:00.000Z')])
  forgetAll()
})
afterEach(() => {
  _setSnapshotDeps(null)
  vi.useRealTimers()
})

describe('GET /api/workshops.json — the saved copy', () => {
  it('serves a fresh saved copy without asking Square, and lets it be cached', async () => {
    const { res, body } = await get()
    expect(body.workshops.map((w: any) => w.id)).toEqual(['saved'])
    expect(mockListWorkshops).not.toHaveBeenCalled()
    expect(res.headers.get('Cache-Control')).not.toContain('no-store')
  })

  it('asks Square live once the copy is 25 minutes old', async () => {
    vi.setSystemTime(new Date('2026-11-24T20:25:00.000Z'))
    const { body } = await get()
    expect(body.workshops.map((w: any) => w.id)).toEqual(['live'])
    expect(mockListWorkshops).toHaveBeenCalledTimes(1)
  })

  it('asks Square live when there is no copy', async () => {
    kv.data.clear()
    const { body } = await get()
    expect(body.workshops.map((w: any) => w.id)).toEqual(['live'])
  })

  it('a live failure with no copy is "incomplete" and never cached', async () => {
    kv.data.clear()
    mockListWorkshops.mockRejectedValue(new Error('Square down'))
    const { res, body } = await get()
    expect(body).toMatchObject({ workshops: [], incomplete: true })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('?w= a class the copy does not have still asks Square again', async () => {
    mockListWorkshops.mockResolvedValue([workshop('saved', '2026-11-28T00:00:00.000Z'), workshop('newone', '2026-11-30T00:00:00.000Z')])
    const { body } = await get('?w=newone')
    expect(mockListWorkshops).toHaveBeenCalledTimes(1)
    expect(body.workshops.map((w: any) => w.id)).toEqual(['saved', 'newone'])
  })

  it('a class in the copy whose seats moved to our own system is hidden, and a link to it says where', async () => {
    mockMovedTo.mockImplementation(async (id: string) => (id === 'sch-saved' ? 'cls_ours' : null))
    const { body } = await get('?w=saved')
    expect(body.workshops).toEqual([])
    expect(body.moved).toEqual({ id: 'saved', to: 'cls_ours' })
    expect(mockListWorkshops).not.toHaveBeenCalled()
  })
})

describe('GET /api/calendar.json — the saved copy', () => {
  it('lists Square classes from the fresh copy without asking Square', async () => {
    const res = await calendarGET({ request: new Request('http://localhost/api/calendar.json?month=2026-11'), url: new URL('http://localhost/api/calendar.json?month=2026-11') } as any)
    const body = await res.json()
    expect(mockListWorkshops).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).toContain('saved')
  })
})
