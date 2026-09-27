import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSubscribe = vi.fn()
const mockNotify = vi.fn()
const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    customer: { subscribe: (...a: any[]) => mockSubscribe(...a) },
    notification: { send: (...a: any[]) => mockNotify(...a) },
    workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) },
  },
}))

// The confirmation that goes to the person who signed up. Never sent from a test.
const mockSendSignupEmail = vi.fn()
vi.mock('@lib/email', () => ({
  sendSignupConfirmationEmail: (...a: any[]) => mockSendSignupEmail(...a),
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
  mockSendSignupEmail.mockResolvedValue({ sent: true })
  mockListWorkshops.mockResolvedValue([{ name: 'Kinusaiga' }, { name: 'Fall Earring Bar' }])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-27T17:00:00.000Z'))
  POST = (await import('@pages/api/party/notify-me.json')).POST
})

afterEach(() => vi.useRealTimers())

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

  describe('the email to the person who signed up', () => {
    it('confirms the sign-up, saying what they will hear about', async () => {
      const res = await POST(ctx({ email: 'ada@example.com', interest: 'party-date:2026-10-24' }))
      expect((await res.json()).data).toEqual({ ok: true, emailSent: true })
      expect(mockSendSignupEmail).toHaveBeenCalledWith({
        to: 'ada@example.com',
        when: 'the day party booking opens',
        also: 'You were looking at Saturday, October 24.',
        opensOn: 'Friday, October 16',
      })
    })

    it('names the workshop when it is one we list', async () => {
      await POST(ctx({ email: 'ada@example.com', interest: 'workshop-waitlist:Kinusaiga 2026-10-16' }))
      expect(mockSendSignupEmail.mock.calls[0][0].when).toBe('if a seat opens in Kinusaiga')
    })

    it('never repeats text a visitor planted in the sign-up', async () => {
      await POST(ctx({ email: 'victim@example.com', interest: 'workshop:Visit http://evil.example now 2026-10-16' }))
      const sent = JSON.stringify(mockSendSignupEmail.mock.calls[0][0])
      expect(sent).not.toMatch(/evil|http/)
      expect(mockSendSignupEmail.mock.calls[0][0].when).toBe('the day workshop booking opens')
    })

    it('still confirms when the workshop list cannot be had', async () => {
      mockListWorkshops.mockRejectedValue(new Error('Square 503'))
      const res = await POST(ctx({ email: 'ada@example.com', interest: 'workshop:Kinusaiga 2026-10-16' }))
      expect(res.status).toBe(200)
      expect(mockSendSignupEmail.mock.calls[0][0].when).toBe('the day workshop booking opens')
    })

    it('leaves out the opening date once the studio has opened', async () => {
      vi.setSystemTime(new Date('2026-10-20T17:00:00.000Z'))
      await POST(ctx({ email: 'ada@example.com', interest: 'workshops:new-dates' }))
      expect(mockSendSignupEmail.mock.calls[0][0].opensOn).toBeUndefined()
    })

    it('says so when the email did not go, and the sign-up still counts', async () => {
      mockSendSignupEmail.mockResolvedValue({ sent: false })
      const res = await POST(ctx({ email: 'ada@example.com' }))
      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual({ ok: true, emailSent: false })
    })

    it('a failure in the email never fails the sign-up', async () => {
      mockSendSignupEmail.mockRejectedValue(new Error('SMTP down'))
      const res = await POST(ctx({ email: 'ada@example.com' }))
      expect(res.status).toBe(200)
      expect(mockSubscribe).toHaveBeenCalledTimes(1)
    })

    it('never confirms a sign-up that was lost', async () => {
      mockSubscribe.mockRejectedValue(new Error('Square down'))
      mockAlert.mockResolvedValue({ attempted: 2, sent: 0 })
      const res = await POST(ctx({ email: 'ada@example.com' }))
      expect(res.status).toBe(500)
      expect(mockSendSignupEmail).not.toHaveBeenCalled()
    })

    it('sends nothing for a bad email address', async () => {
      await POST(ctx({ email: 'not-an-email' }))
      expect(mockSendSignupEmail).not.toHaveBeenCalled()
    })
  })
})
