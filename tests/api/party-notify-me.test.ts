import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSubscribe = vi.fn()
const mockNotify = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    customer: { subscribe: (...a: any[]) => mockSubscribe(...a) },
    notification: { send: (...a: any[]) => mockNotify(...a) },
  },
}))

const mockAlert = vi.fn()
vi.mock('@lib/owner-alert', () => ({
  alertOwners: (...a: any[]) => mockAlert(...a),
}))

function ctx(body: any, ip = '203.0.113.7') {
  return {
    clientAddress: ip,
    request: new Request('http://localhost/api/party/notify-me.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any
}

let POST: any
beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mockSubscribe.mockResolvedValue(undefined)
  mockNotify.mockResolvedValue(undefined)
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
  POST = (await import('@pages/api/party/notify-me.json')).POST
})

describe('POST /api/party/notify-me.json', () => {
  it('rejects a bad email', async () => {
    const res = await POST(ctx({ email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    const res = await POST(ctx('{nope'))
    expect(res.status).toBe(400)
  })

  it('saves the sign-up to the customer record with what they were interested in', async () => {
    const res = await POST(ctx({ email: ' ada@example.com ', interest: 'workshop:Kinusaiga 2026-10-16' }))
    expect(res.status).toBe(200)
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
    const [email, note] = mockSubscribe.mock.calls[0]
    expect(email).toBe('ada@example.com')
    expect(note).toContain('workshop:Kinusaiga 2026-10-16')
  })

  it('alerts the owners by text and by Slack, naming the interest', async () => {
    await POST(ctx({ email: 'ada@example.com', interest: 'party-date:2026-10-24' }))
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toContain('ada@example.com')
    expect(mockAlert.mock.calls[0][0]).toContain('party-date:2026-10-24')
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0].details.interest).toBe('party-date:2026-10-24')
  })

  it('works without an interest', async () => {
    const res = await POST(ctx({ email: 'ada@example.com' }))
    expect(res.status).toBe(200)
    expect(mockSubscribe.mock.calls[0][0]).toBe('ada@example.com')
  })

  it('cuts an over-long interest to 80 characters', async () => {
    await POST(ctx({ email: 'ada@example.com', interest: 'x'.repeat(200) }))
    expect(mockNotify.mock.calls[0][0].details.interest).toHaveLength(80)
  })

  it('still succeeds when both alerts fail', async () => {
    mockNotify.mockRejectedValue(new Error('slack down'))
    mockAlert.mockRejectedValue(new Error('quo down'))
    const res = await POST(ctx({ email: 'ada@example.com' }))
    expect(res.status).toBe(200)
  })

  it('still succeeds when the customer record cannot be saved but an owner was told', async () => {
    mockSubscribe.mockRejectedValue(new Error('square down'))
    const res = await POST(ctx({ email: 'ada@example.com', interest: 'kits' }))
    expect(res.status).toBe(200)
    expect(mockAlert.mock.calls[0][0]).toContain('not saved')
  })

  it('fails when the sign-up was neither saved nor passed on to anyone', async () => {
    mockSubscribe.mockRejectedValue(new Error('square down'))
    mockAlert.mockResolvedValue({ attempted: 0, sent: 0 })
    const res = await POST(ctx({ email: 'ada@example.com' }))
    expect(res.status).toBe(500)
  })

  it('limits how often one address can sign up', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await POST(ctx({ email: `a${i}@example.com` }, '198.51.100.9'))
      expect(ok.status).toBe(200)
    }
    const blocked = await POST(ctx({ email: 'a6@example.com' }, '198.51.100.9'))
    expect(blocked.status).toBe(429)
    const other = await POST(ctx({ email: 'b@example.com' }, '198.51.100.10'))
    expect(other.status).toBe(200)
  })
})
