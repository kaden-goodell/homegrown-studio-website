import { describe, it, expect, vi, beforeEach } from 'vitest'

let authed: { id: string; name: string; role: 'owner' | 'crew' } | null = { id: 't', name: 'Test', role: 'crew' }
vi.mock('@lib/staff-auth', () => ({ staffAuthorized: () => authed }))

const mockGetEvent = vi.fn()
vi.mock('@lib/events', () => ({ getEvent: (...a: any[]) => mockGetEvent(...a) }))

const mockGetWaiverRecord = vi.fn()
vi.mock('@lib/waiver-store', () => ({ getWaiverRecord: (...a: any[]) => mockGetWaiverRecord(...a) }))

let configured = true
const mockSend = vi.fn()
vi.mock('@lib/quo', () => ({
  quoConfigured: () => configured,
  sendQuoText: (...a: any[]) => mockSend(...a),
}))

function ctx(body: any) {
  return {
    request: new Request('http://localhost/api/staff/send-waiver-link.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as any
}

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  authed = { id: 't', name: 'Test', role: 'crew' }
  configured = true
  mockGetEvent.mockResolvedValue({ kind: 'party', id: 'party-1', title: 'Suncatchers Party', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: true })
  mockGetWaiverRecord.mockResolvedValue({ adult: { phone: '(256) 555-0123' } })
  mockSend.mockResolvedValue(undefined)
  POST = (await import('@pages/api/staff/send-waiver-link.json')).POST
})

describe('POST /api/staff/send-waiver-link.json (HOM-213)', () => {
  it('rejects an unauthenticated caller', async () => {
    authed = null
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party', id: 'party-1' }))
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('400s on missing params', async () => {
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party' }))
    expect(res.status).toBe(400)
  })

  it('404s when the household is not found', async () => {
    mockGetWaiverRecord.mockResolvedValue(null)
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party', id: 'party-1' }))
    expect(res.status).toBe(404)
  })

  it('404s when the event is not found', async () => {
    mockGetEvent.mockResolvedValue(null)
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party', id: 'party-1' }))
    expect(res.status).toBe(404)
  })

  it('sends the addendum link to the household phone', async () => {
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party', id: 'party-1' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.sent).toBe(true)
    const { to, content } = mockSend.mock.calls[0][0]
    expect(to).toBe('(256) 555-0123')
    expect(content).toContain('Suncatchers Party')
    expect(content).toContain('/waiver?party=party-1')
  })

  it('workshop kind builds a /waiver?workshop= link', async () => {
    mockGetEvent.mockResolvedValue({ kind: 'workshop', id: 'ws-1', title: 'Pottery Camp', startIso: '2026-10-20T18:00:00.000Z', days: ['2026-10-20'], dropOff: true })
    await POST(ctx({ recordId: 'wvr_1', kind: 'workshop', id: 'ws-1' }))
    const { content } = mockSend.mock.calls[0][0]
    expect(content).toContain('/waiver?workshop=ws-1')
  })

  it('reports { sent: false } (not an error) when Quo is not configured', async () => {
    configured = false
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party', id: 'party-1' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.sent).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reports { sent: false } (not an error) when the Quo send throws', async () => {
    mockSend.mockRejectedValue(new Error('Quo API 500'))
    const res = await POST(ctx({ recordId: 'wvr_1', kind: 'party', id: 'party-1' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.sent).toBe(false)
  })
})
