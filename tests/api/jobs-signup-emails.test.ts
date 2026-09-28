import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockListWithNotes = vi.fn()
const mockAppendNote = vi.fn()
const mockListWorkshops = vi.fn()
vi.mock('@config/providers', () => ({
  providers: {
    customer: {
      listWithNotes: (...a: any[]) => mockListWithNotes(...a),
      appendNote: (...a: any[]) => mockAppendNote(...a),
    },
    workshop: { listWorkshops: (...a: any[]) => mockListWorkshops(...a) },
  },
}))

// Never sent from a test.
const mockSend = vi.fn()
const mockEmailReady = vi.fn()
vi.mock('@lib/email', () => ({
  sendSignupNewsEmail: (...a: any[]) => mockSend(...a),
  emailReady: () => mockEmailReady(),
}))

const mockAlert = vi.fn()
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => mockAlert(...a) }))

const mockOpenStarts = vi.fn()
vi.mock('@lib/party-open-dates', () => ({ openPartyStartsInWindow: (...a: any[]) => mockOpenStarts(...a) }))

const SECRET = 'a-secret-only-the-site-holds'
const OCT_24 = '2026-10-24T14:00:00.000Z'

const kinusaiga = (over: Record<string, unknown> = {}) => ({
  id: 'clsschi_kinusaiga',
  name: 'Kinusaiga',
  startAt: '2026-10-17T00:00:00.000Z',
  durationMinutes: 120,
  priceCents: 4000,
  availableCapacity: 12,
  ...over,
})

const person = (n: number, ...lines: string[]) => ({ id: `cust-${n}`, email: `person${n}@example.com`, note: lines.join('\n') })

let POST: any
let jobKey: (secret: string) => string

function ctx(body: unknown = {}, key?: string) {
  return {
    request: new Request('http://localhost/api/jobs/signup-emails.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key === undefined ? {} : { 'x-job-key': key }) },
      body: JSON.stringify(body),
    }),
  } as any
}
const run = async (body: unknown = {}) => {
  const res = await POST(ctx(body, jobKey(SECRET)))
  return { status: res.status, json: await res.json() }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  process.env.LOOKUP_SIGNING_SECRET = SECRET
  process.env.BOOKINGS_OPEN = 'true'
  mockEmailReady.mockReturnValue(true)
  mockSend.mockResolvedValue({ sent: true })
  mockAppendNote.mockResolvedValue(undefined)
  mockAlert.mockResolvedValue({ attempted: 2, sent: 2 })
  mockListWorkshops.mockResolvedValue([kinusaiga()])
  mockOpenStarts.mockResolvedValue([OCT_24])
  mockListWithNotes.mockResolvedValue([])
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T15:00:00.000Z'))
  ;({ POST, jobKey } = await import('@pages/api/jobs/signup-emails.json'))
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.BOOKINGS_OPEN
  delete process.env.LOOKUP_SIGNING_SECRET
})

describe('who may call it', () => {
  it('refuses a call with no key', async () => {
    const res = await POST(ctx({}))
    expect(res.status).toBe(401)
    expect(mockListWithNotes).not.toHaveBeenCalled()
  })

  it('refuses a call with the wrong key', async () => {
    const res = await POST(ctx({}, jobKey('some-other-secret')))
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('refuses every call when the site has no secret set', async () => {
    delete process.env.LOOKUP_SIGNING_SECRET
    const res = await POST(ctx({}, jobKey('')))
    expect(res.status).toBe(401)
  })
})

describe('while booking is closed', () => {
  it('sends nothing, and asks the booking system nothing', async () => {
    process.env.BOOKINGS_OPEN = 'false'
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    const { status, json } = await run()
    expect(status).toBe(200)
    expect(json.data).toMatchObject({ bookingOpen: false, sent: 0, left: 0 })
    expect(mockListWithNotes).not.toHaveBeenCalled()
    expect(mockListWorkshops).not.toHaveBeenCalled()
    expect(mockOpenStarts).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockAppendNote).not.toHaveBeenCalled()
  })
})

describe('once booking is open', () => {
  it('emails the person what they asked about, with a link to it', async () => {
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party-date:2026-10-24')])
    const { json } = await run()
    expect(json.data).toMatchObject({ sent: 1, failed: 0, left: 0 })
    expect(mockSend).toHaveBeenCalledTimes(1)
    const mail = mockSend.mock.calls[0][0]
    expect(mail.to).toBe('person1@example.com')
    expect(mail.siteUrl).toBe('https://ourhometownstudio.com')
    expect(mail.items).toEqual([
      {
        headline: 'Saturday, October 24 is open for a party',
        lines: ['A date is held for whoever books it first.'],
        path: '/book?date=2026-10-24',
        linkLabel: 'Book October 24',
      },
    ])
  })

  it('writes "Emailed" on their record, in the booking system', async () => {
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party-date:2026-10-24')])
    await run()
    expect(mockAppendNote).toHaveBeenCalledWith('cust-1', '2026-10-10 Emailed: party-date:2026-10-24')
  })

  it('marks the record before the email goes, never after', async () => {
    const order: string[] = []
    mockAppendNote.mockImplementation(async () => void order.push('marked'))
    mockSend.mockImplementation(async () => (order.push('sent'), { sent: true }))
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    await run()
    expect(order).toEqual(['marked', 'sent'])
  })

  it('does not email someone who has already been emailed', async () => {
    mockListWithNotes.mockResolvedValue([
      person(1, '2026-10-10 Emailed: party:booking-opens', '2026-09-27 Asked to be told: party:booking-opens'),
    ])
    const { json } = await run()
    expect(json.data.sent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockAppendNote).not.toHaveBeenCalled()
  })

  it('leaves alone a sign-up whose time has not come', async () => {
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party-later:2026-12')])
    const { json } = await run()
    expect(json.data).toMatchObject({ sent: 0, waiting: 1 })
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockAppendNote).not.toHaveBeenCalled()
  })

  it('puts everything that came due for one person into one email', async () => {
    mockListWithNotes.mockResolvedValue([
      person(1, '2026-09-28 Asked to be told: workshop:Kinusaiga 2026-10-16', '2026-09-27 Asked to be told: party:booking-opens'),
    ])
    await run()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0].items.map((i: any) => i.headline)).toEqual([
      'Party booking is open',
      'Booking is open for Kinusaiga',
    ])
    expect(mockAppendNote).toHaveBeenCalledTimes(1)
    expect(mockAppendNote.mock.calls[0][1]).toBe(
      '2026-10-10 Emailed: party:booking-opens\n2026-10-10 Emailed: workshop:Kinusaiga 2026-10-16',
    )
  })

  it('shows a button once when two sign-ups lead to the same place, and answers both', async () => {
    mockListWithNotes.mockResolvedValue([
      person(1, '2026-09-28 Asked to be told: party:booking-opens', '2026-09-27 Asked to be told: when booking opens'),
    ])
    await run()
    expect(mockSend.mock.calls[0][0].items).toHaveLength(1)
    expect(mockAppendNote.mock.calls[0][1]).toBe('2026-10-10 Emailed: when booking opens\n2026-10-10 Emailed: party:booking-opens')
  })

  it('says nothing about party dates when none are on offer', async () => {
    mockOpenStarts.mockResolvedValue([])
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    const { json } = await run()
    expect(json.data).toMatchObject({ sent: 0, waiting: 1 })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('says nothing about party dates when they could not be looked up', async () => {
    mockOpenStarts.mockRejectedValue(new Error('Square 503'))
    mockListWithNotes.mockResolvedValue([
      person(1, '2026-09-27 Asked to be told: party:booking-opens'),
      person(2, '2026-09-27 Asked to be told: workshop:Kinusaiga 2026-10-16'),
    ])
    const { json } = await run()
    // The workshop email still goes.
    expect(json.data.sent).toBe(1)
    expect(mockSend.mock.calls[0][0].to).toBe('person2@example.com')
  })

  it('emails a few people per call and says how many are left', async () => {
    mockListWithNotes.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => person(i + 1, '2026-09-27 Asked to be told: party:booking-opens')),
    )
    const first = await run()
    expect(first.json.data).toMatchObject({ sent: 5, left: 7 })
    expect(mockSend).toHaveBeenCalledTimes(5)
  })

  it('cannot be asked for a bigger batch than ten', async () => {
    mockListWithNotes.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => person(i + 1, '2026-09-27 Asked to be told: party:booking-opens')),
    )
    const { json } = await run({ limit: 500 })
    expect(json.data).toMatchObject({ sent: 10, left: 20 })
  })
})

describe('when something goes wrong', () => {
  it('does nothing at all when email is not set up', async () => {
    mockEmailReady.mockReturnValue(false)
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    const { status } = await run()
    expect(status).toBe(503)
    expect(mockAppendNote).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('does not send when the record could not be marked: it comes round again', async () => {
    mockAppendNote.mockRejectedValue(new Error('Square 503'))
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    const { json } = await run()
    expect(json.data).toMatchObject({ sent: 0, failed: 0 })
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('tries an email twice, then writes the failure on the record and texts the owners', async () => {
    mockSend.mockResolvedValue({ sent: false })
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    const { json } = await run()
    expect(json.data).toMatchObject({ sent: 0, failed: 1 })
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockAppendNote).toHaveBeenLastCalledWith('cust-1', '2026-10-10 Email failed: party:booking-opens')
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toContain('person1@example.com')
  })

  it('sends one text for a run of failures, not one each', async () => {
    mockSend.mockResolvedValue({ sent: false })
    mockListWithNotes.mockResolvedValue([
      person(1, '2026-09-27 Asked to be told: party:booking-opens'),
      person(2, '2026-09-27 Asked to be told: party:booking-opens'),
    ])
    await run()
    expect(mockAlert).toHaveBeenCalledTimes(1)
    expect(mockAlert.mock.calls[0][0]).toContain('2 people')
  })

  it('succeeds on the second try without telling anyone', async () => {
    mockSend.mockResolvedValueOnce({ sent: false }).mockResolvedValueOnce({ sent: true })
    mockListWithNotes.mockResolvedValue([person(1, '2026-09-27 Asked to be told: party:booking-opens')])
    const { json } = await run()
    expect(json.data).toMatchObject({ sent: 1, failed: 0 })
    expect(mockAlert).not.toHaveBeenCalled()
  })

  it('answers 502 and sends nothing when the sign-ups cannot be read', async () => {
    mockListWithNotes.mockRejectedValue(new Error('Square 503'))
    const { status } = await run()
    expect(status).toBe(502)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('a dry run', () => {
  it('says how many and of what kind, never who, and changes nothing', async () => {
    mockListWithNotes.mockResolvedValue([
      person(1, '2026-09-27 Asked to be told: party:booking-opens'),
      person(2, '2026-09-27 Asked to be told: workshop:Kinusaiga 2026-10-16'),
      person(3, '2026-09-27 Asked to be told: party-later:2026-12'),
    ])
    const { json } = await run({ dry: true })
    expect(json.data).toEqual({ bookingOpen: true, dry: true, wouldEmail: 2, kinds: { party: 1, workshop: 1 }, waiting: 1 })
    expect(JSON.stringify(json)).not.toContain('example.com')
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockAppendNote).not.toHaveBeenCalled()
  })
})
