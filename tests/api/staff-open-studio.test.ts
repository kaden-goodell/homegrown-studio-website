import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
const mockAudit = vi.fn()
vi.mock('@lib/audit', () => ({ recordAudit: (...a: any[]) => mockAudit(...a) }))
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => authed,
  byOf: (m: any) => ({ id: m.id, name: m.name }),
}))

const mockCheckIn = vi.fn()
const mockGetDay = vi.fn()
const mockHereNowCount = vi.fn()
vi.mock('@lib/open-studio-store', () => ({
  checkInOpenStudio: (...a: any[]) => mockCheckIn(...a),
  getOpenStudioDay: (...a: any[]) => mockGetDay(...a),
  hereNowCount: (...a: any[]) => mockHereNowCount(...a),
}))

function postCtx(body: any) {
  const request = new Request('http://localhost/api/staff/open-studio.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { request } as any
}

function getCtx(query: string) {
  const request = new Request(`http://localhost/api/staff/open-studio.json${query}`)
  const url = new URL(request.url)
  return { request, url } as any
}

let POST: any
let GET: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  mockHereNowCount.mockResolvedValue(0)
  const mod = await import('@pages/api/staff/open-studio.json')
  POST = mod.POST
  GET = mod.GET
})

describe('POST /api/staff/open-studio.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(postCtx({ recordId: 'wvr_1', personIds: ['adult'] }))
    expect(res.status).toBe(401)
    expect(mockCheckIn).not.toHaveBeenCalled()
  })

  it('requires recordId and at least one personId', async () => {
    const res = await POST(postCtx({ recordId: '', personIds: [] }))
    expect(res.status).toBe(400)
  })

  it('checks in with the signed-in staffer stamped as `by`', async () => {
    mockCheckIn.mockResolvedValue({})
    const res = await POST(postCtx({ recordId: 'wvr_1', personIds: ['adult', 'child:0'] }))
    expect(res.status).toBe(200)
    expect(mockCheckIn).toHaveBeenCalledWith(expect.any(String), 'wvr_1', ['adult', 'child:0'], { id: 't', name: 'Test' })
    expect(mockAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'checkin.here', by: expect.objectContaining({ id: expect.any(String), role: expect.stringMatching(/^(owner|crew)$/) }), target: expect.objectContaining({ kind: 'household', id: 'wvr_1' }) }))
  })

  it('returns 503 on a storage error', async () => {
    mockCheckIn.mockRejectedValue(new Error('boom'))
    const res = await POST(postCtx({ recordId: 'wvr_1', personIds: ['adult'] }))
    expect(res.status).toBe(503)
  })
})

describe('GET /api/staff/open-studio.json', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await GET(getCtx('?date=2026-10-20'))
    expect(res.status).toBe(401)
  })

  it('returns the here-now count for the date', async () => {
    mockHereNowCount.mockResolvedValue(7)
    const res = await GET(getCtx('?date=2026-10-20'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.count).toBe(7)
    expect(mockHereNowCount).toHaveBeenCalledWith('2026-10-20')
  })
})
