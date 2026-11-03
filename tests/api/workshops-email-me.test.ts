import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSubscribe = vi.fn()
const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    customer: { subscribe: (...a: any[]) => mockSubscribe(...a) },
    workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) },
  },
}))

// Never sent from a test.
const mockSend = vi.fn()
vi.mock('@lib/class-link-email', () => ({ sendClassLinkEmail: (...a: any[]) => mockSend(...a) }))
const mockEvent = vi.fn()
vi.mock('@lib/posthog-server', () => ({ reportServerEvent: (...a: any[]) => mockEvent(...a) }))

const earrings = { id: 'clsschi_abc', name: 'Christmas Earring Bar', description: 'x', startAt: '2026-11-13T00:00:00.000Z', durationMinutes: 120, priceCents: 3500 }

let ipCounter = 0
function ctx(body: any, ip = `203.0.113.${++ipCounter}`) {
  return {
    clientAddress: ip,
    request: new Request('http://localhost/api/workshops/email-me.json', {
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
  mockSend.mockResolvedValue({ sent: true })
  mockEvent.mockResolvedValue(undefined)
  mockListWorkshops.mockResolvedValue([earrings])
  POST = (await import('@pages/api/workshops/email-me.json')).POST
})

describe('POST /api/workshops/email-me.json', () => {
  it('emails the class looked up by id, and does not touch the list unless asked', async () => {
    const res = await POST(ctx({ email: 'mom@example.com', classId: 'clsschi_abc' }))
    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalledWith('mom@example.com', earrings, 'https://ourhometownstudio.com')
    expect(mockSubscribe).not.toHaveBeenCalled()
    expect(mockEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'class_emailed', properties: expect.objectContaining({ item_name: 'Christmas Earring Bar', also_news: false }) }))
  })

  it('adds them to the new-classes list only when the box was ticked', async () => {
    const res = await POST(ctx({ email: 'mom@example.com', classId: 'clsschi_abc', alsoNews: true }))
    expect(res.status).toBe(200)
    expect(mockSubscribe).toHaveBeenCalledWith('mom@example.com')
    expect((await res.json()).data.subscribed).toBe(true)
  })

  it('still counts as sent when only the list sign-up fails', async () => {
    mockSubscribe.mockRejectedValue(new Error('square down'))
    const res = await POST(ctx({ email: 'mom@example.com', classId: 'clsschi_abc', alsoNews: true }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.subscribed).toBe(false)
  })

  it('rejects a bad email, a missing class, and a body that is not JSON', async () => {
    expect((await POST(ctx({ email: 'nope', classId: 'clsschi_abc' }))).status).toBe(400)
    expect((await POST(ctx({ email: 'mom@example.com' }))).status).toBe(400)
    expect((await POST(ctx('{nope'))).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('refuses a class that is not listed (nothing from the request goes in the email)', async () => {
    const res = await POST(ctx({ email: 'mom@example.com', classId: 'clsschi_gone', name: 'Buy crypto now' }))
    expect(res.status).toBe(404)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never says sent when the email did not go', async () => {
    mockSend.mockResolvedValue({ sent: false })
    const res = await POST(ctx({ email: 'mom@example.com', classId: 'clsschi_abc', alsoNews: true }))
    expect(res.status).toBe(502)
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('says so when the class list cannot be read', async () => {
    mockListWorkshops.mockRejectedValue(new Error('square down'))
    expect((await POST(ctx({ email: 'mom@example.com', classId: 'clsschi_abc' }))).status).toBe(502)
  })

  it('limits one connection to 5 tries in 10 minutes', async () => {
    for (let i = 0; i < 5; i++) await POST(ctx({ email: `p${i}@example.com`, classId: 'clsschi_abc' }, '198.51.100.9'))
    expect((await POST(ctx({ email: 'p9@example.com', classId: 'clsschi_abc' }, '198.51.100.9'))).status).toBe(429)
  })

  it('limits one address to 3 a day, from any connection, so no one can flood an inbox', async () => {
    for (let i = 0; i < 3; i++) expect((await POST(ctx({ email: 'Target@example.com', classId: 'clsschi_abc' }))).status).toBe(200)
    expect((await POST(ctx({ email: 'target@example.com', classId: 'clsschi_abc' }))).status).toBe(429)
    expect(mockSend).toHaveBeenCalledTimes(3)
  })
})
