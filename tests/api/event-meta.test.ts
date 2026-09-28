import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 'k', name: 'Kaden', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed, byOf: (m: any) => ({ id: m.id, name: m.name }) }))

const mockGetEvent = vi.fn()
const mockSetEventMeta = vi.fn()
vi.mock('@lib/events', () => ({ getEvent: (...a: any[]) => mockGetEvent(...a), EVENT_KIND_RE: /^(party|workshop)$/ }))
vi.mock('@lib/event-meta', () => ({ setEventMeta: (...a: any[]) => mockSetEventMeta(...a) }))

function postCtx(body: any) {
  const request = new Request('http://localhost/api/staff/event-meta.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

function getCtx(qs: string) {
  const url = new URL(`http://localhost/api/staff/event-meta.json?${qs}`)
  const request = new Request(url)
  return { request, url } as any
}

let POST: any
let GET: any

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 'k', name: 'Kaden', role: 'crew' }
  mockSetEventMeta.mockResolvedValue({ dropOff: true, days: null, updatedAt: '2026-09-28T00:00:00.000Z', by: { id: 'k', name: 'Kaden' }, history: [] })
  mockGetEvent.mockResolvedValue({ kind: 'workshop', id: 'cs1', title: 'Macramé', startIso: '2026-10-20T15:00:00.000Z', days: ['2026-10-20'], dropOff: true })
  const mod = await import('@pages/api/staff/event-meta.json')
  POST = mod.POST
  GET = mod.GET
})

describe('POST /api/staff/event-meta.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', dropOff: true }))
    expect(res.status).toBe(401)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('rejects a malformed days array', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', days: ['not-a-date'] }))
    expect(res.status).toBe(400)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('rejects more than 14 days', async () => {
    const days = Array.from({ length: 15 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', days }))
    expect(res.status).toBe(400)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('accepts null days (revert to default) and a dropOff flip, stamping the signed-in staffer', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', dropOff: true, days: null }))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).toHaveBeenCalledWith('workshop', 'cs1', { dropOff: true, days: null }, { id: 'k', name: 'Kaden' })
    const json = await res.json()
    expect(json.data).toMatchObject({ id: 'cs1', dropOff: true })
  })

  it('sorts and dedupes a valid days array before saving', async () => {
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', days: ['2026-10-21', '2026-10-20', '2026-10-20'] }))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).toHaveBeenCalledWith('workshop', 'cs1', { days: ['2026-10-20', '2026-10-21'] }, { id: 'k', name: 'Kaden' })
  })

  it('404s when the event no longer resolves — without writing an orphan overlay (M7)', async () => {
    mockGetEvent.mockResolvedValue(null)
    const res = await POST(postCtx({ kind: 'workshop', id: 'missing', dropOff: true }))
    expect(res.status).toBe(404)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
  })

  it('503s on a storage throw (fails closed)', async () => {
    mockSetEventMeta.mockRejectedValue(new Error('boom'))
    const res = await POST(postCtx({ kind: 'workshop', id: 'cs1', dropOff: true }))
    expect(res.status).toBe(503)
  })
})

describe('GET /api/staff/event-meta.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(getCtx('kind=workshop&id=cs1'))
    expect(res.status).toBe(401)
  })

  it('returns the current merged event without writing', async () => {
    const res = await GET(getCtx('kind=workshop&id=cs1'))
    expect(res.status).toBe(200)
    expect(mockSetEventMeta).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.data).toMatchObject({ id: 'cs1', dropOff: true })
  })
})
