/**
 * POST /api/quote/corky-deposit.json: the $1,500 deposit on Jessyca's quote
 * page. Square (orders and payments), the owners' texts and emails are fakes;
 * the real chargeOrder runs on top of the fake Square, so the amount checked
 * is the one that would reach Square.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  alert: vi.fn(),
  sendEmail: vi.fn(),
  bypass: { on: false },
  testSite: null as string | null,
  rows: new Map<string, string>(),
  kvFail: false,
}))

// Jessyca's visit log: an in-memory 'quote-visits' store; every other store is real.
vi.mock('@lib/blob-store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@lib/blob-store')>()
  return {
    ...real,
    makeKvStore: (name: string, dir: string) => (name !== 'quote-visits' ? real.makeKvStore(name, dir) : {
      get: async (k: string) => { if (m.kvFail && k === 'corky-paid') throw new Error('blobs down'); return m.rows.get(k) ?? null },
      set: async (k: string, v: string) => { m.rows.set(k, v) },
      list: async (p?: string) => { if (m.kvFail) throw new Error('blobs down'); return [...m.rows.keys()].filter((k) => !p || k.startsWith(p)) },
      delete: async (k: string) => { m.rows.delete(k) },
      getWithMeta: async () => ({ value: null, etag: null }),
      setIfMatch: async (k: string, v: string, etag: string | null, exists: boolean) => {
        if (!etag && !exists) { if (m.rows.has(k)) return false; m.rows.set(k, v); return true }
        m.rows.set(k, v); return true
      },
    }),
  }
})

vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
    },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({ sendEmail: (...a: any[]) => m.sendEmail(...a) }))
vi.mock('@lib/notify-settings', () => ({ emailsFor: async () => 'owners@example.com' }))
vi.mock('@lib/dev-flags', () => ({ paymentBypassEnabled: () => m.bypass.on }))
vi.mock('@lib/classes/test-site-guard', () => ({ classWritesRefusal: () => m.testSite }))

import { POST, DEPOSIT_CENTS, DEPOSIT_LINE, DECLINED_MESSAGE } from '@pages/api/quote/corky-deposit.json'

let ip = 0
const post = async (b: unknown, address?: string) => {
  const res = (await POST({
    request: new Request('http://localhost/api/quote/corky-deposit.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof b === 'string' ? b : JSON.stringify(b) }),
    clientAddress: address ?? `10.9.0.${++ip}`,
  } as any)) as Response
  return { status: res.status, json: await res.json() }
}
const body = (over: Record<string, unknown> = {}) => ({
  attemptId: randomUUID(), paymentToken: 'cnon:ok', sourceKind: 'card',
  firstName: 'Jessyca', lastName: 'Test', email: 'jessyca@example.com', phone: '(256) 555-0100', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.bypass.on = false
  m.testSite = null
  m.rows.clear()
  m.kvFail = false
  m.createOrder.mockImplementation(async (req: any) => ({
    id: `ord-${req.idempotencyKey}`, totalAmount: req.lineItems.reduce((t: number, l: any) => t + l.quantity * l.pricePerUnit, 0),
  }))
  m.findOrderPayment.mockResolvedValue(null)
  m.processPayment.mockImplementation(async (p: any) => ({ id: 'pay-1', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: 'https://squareup.com/receipt/1' }))
  m.alert.mockResolvedValue({ attempted: 1, sent: 1 })
  m.sendEmail.mockResolvedValue({ sent: true })
})

describe('POST /api/quote/corky-deposit.json', () => {
  it('always charges $1,500, whatever the page sends', async () => {
    const res = await post(body({ amount: 1, amountCents: 100, expectedCents: 5, total: '1.00' }))
    expect(res.status).toBe(200)
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    const order = m.createOrder.mock.calls[0][0]
    expect(order.lineItems).toEqual([expect.objectContaining({ name: DEPOSIT_LINE, quantity: 1, pricePerUnit: 150000 })])
    expect(order.idempotencyKey).toMatch(/:order$/)
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    const charge = m.processPayment.mock.calls[0][0]
    expect(charge.amount).toBe(150000)
    expect(DEPOSIT_CENTS).toBe(150000)
    expect(charge.buyerEmailAddress).toBe('jessyca@example.com')
    expect(charge.idempotencyKey).toMatch(/:pay$/)
  })

  it('paid → 200 with the receipt, one owner text and the owners’ email', async () => {
    const res = await post(body({ verificationToken: 'verf-1' }))
    expect(res).toEqual({ status: 200, json: { data: { paid: true, receiptUrl: 'https://squareup.com/receipt/1' } } })
    expect(m.processPayment.mock.calls[0][0].verificationToken).toBe('verf-1')
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert).toHaveBeenCalledWith('Deposit paid $1,500: Corky Child Care, Sat Dec 12. Jessyca Test (256) 555-0100. No night picked yet. No page visits on record.', 'booking-alerts')
    expect(m.sendEmail).toHaveBeenCalledTimes(1)
    expect(m.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'owners@example.com', subject: expect.stringContaining('Deposit paid') })
  })

  it('a retry whose order is already paid is not charged again', async () => {
    m.findOrderPayment.mockResolvedValue({ id: 'pay-0', orderId: 'x', amount: 150000, status: 'completed', receiptUrl: 'https://r/0' })
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(res.json.data.receiptUrl).toBe('https://r/0')
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('declined → 402 with the plain message, no alert', async () => {
    m.processPayment.mockRejectedValue(Object.assign(new Error('declined'), { statusCode: 402, errors: [{ code: 'CARD_DECLINED' }] }))
    const res = await post(body())
    expect(res.status).toBe(402)
    expect(res.json).toMatchObject({ code: 'card_declined', detail: DECLINED_MESSAGE })
    expect(m.alert).not.toHaveBeenCalled()
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it('no answer from Square → 202 checking, and the owners are told it is unclear', async () => {
    m.processPayment.mockRejectedValue(new Error('socket hang up'))
    const res = await post(body())
    expect(res.status).toBe(202)
    expect(res.json).toMatchObject({ why: 'checking' })
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/^Deposit unclear: Corky Child Care Collective, Dec 12, \$1,500 \(Jessyca Test, \(256\) 555-0100\)\. Check Square/)
    expect(m.sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    ['not JSON', '{nope'],
    ['no attempt id', body({ attemptId: 'abc' })],
    ['no first name', body({ firstName: ' ' })],
    ['no last name', body({ lastName: '' })],
    ['a bad email', body({ email: 'jessyca@' })],
    ['a short phone', body({ phone: '555-0100' })],
    ['no payment token', body({ paymentToken: '' })],
  ])('bad body (%s) → 400, nothing reaches Square', async (_name, b) => {
    const res = await post(b)
    expect(res.status).toBe(400)
    expect(res.json.code).toBe('invalid')
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('rate limit → 429 after 5 tries a minute from one address', async () => {
    const address = '10.99.99.99'
    for (let i = 0; i < 5; i++) expect((await post(body({ firstName: '' }), address)).status).toBe(400)
    const res = await post(body(), address)
    expect(res.status).toBe(429)
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('payment bypass → simulated paid, no Square, no texts', async () => {
    m.bypass.on = true
    const res = await post(body({ paymentToken: 'mock-payment-token' }))
    expect(res).toEqual({ status: 200, json: { data: { paid: true, simulated: true } } })
    expect(m.createOrder).not.toHaveBeenCalled()
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(m.alert).not.toHaveBeenCalled()
  })

  it('a test site sharing the live Square refuses before any order', async () => {
    m.testSite = 'This test site has no store of its own. Set STORE_NAMESPACE first.'
    const res = await post(body())
    expect(res.status).toBe(503)
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  describe('the owners hear what she picked and how she browsed', () => {
    // Mon Nov 16 2026, 9:02 AM in Madison (CST = UTC−6).
    const T0 = Date.UTC(2026, 10, 16, 15, 2)
    const PHONE = 'aaaa1111-0000-0000-0000-000000000001'
    const LAPTOP = 'bbbb2222-0000-0000-0000-000000000002'
    const seed = (visitorId: string, sessionId: string, v: Record<string, unknown>) =>
      m.rows.set(`corky-${visitorId}-${sessionId}`, JSON.stringify({
        visitorId, sessionId, first: T0, last: T0, device: 'iPhone', referrer: null, activeSeconds: 0, scroll: 0, events: [], pick: null, ...v,
      }))
    const pick = (id: string, at: number) => ({ type: 'pick', id, at })

    function seedFourVisits() {
      seed(PHONE, 's1aaaaaaaa', { first: T0, device: 'iPhone', referrer: 'facebook.com', activeSeconds: 240, scroll: 80, events: [pick('tote', 30), pick('ornament', 50), pick('tote', 70)] })
      seed(LAPTOP, 's2aaaaaaaa', { first: T0 + 26 * 3600_000, device: 'Mac', activeSeconds: 300, scroll: 100, events: [pick('ornament', 20), { type: 'text', at: 90 }] })
      seed(PHONE, 's3aaaaaaaa', { first: T0 + 50 * 3600_000, device: 'iPhone', activeSeconds: 100, scroll: 60, events: [] })
      seed(LAPTOP, 's4aaaaaaaa', { first: T0 + 51 * 3600_000, device: 'Mac', activeSeconds: 80, scroll: 100, events: [pick('tote', 10), { type: 'monoOn', at: 20 }, { type: 'sheet', at: 40 }, { type: 'pay', at: 70 }] })
      m.rows.set('other-thing', '{}')
    }

    it('the text has the pick and the visit counts, in 300 characters or fewer', async () => {
      seedFourVisits()
      const res = await post(body({ firstName: 'Jessyca', lastName: 'Lope', phone: '(256) 975-0563', night: 'Tote & Keychain Bar', visitorId: LAPTOP }))
      expect(res.status).toBe(200)
      const text: string = m.alert.mock.calls[0][0]
      expect(text).toBe('Deposit paid $1,500: Corky Child Care, Sat Dec 12. Jessyca Lope (256) 975-0563. Picked: Tote & Keychain Bar. 4 visits on 2 devices since Nov 16, 12 min on page. Tapped Tote ×3, Ornament ×2. Tapped "Text us".')
      expect(text.length).toBeLessThanOrEqual(300)
      expect(m.alert.mock.calls[0][1]).toBe('booking-alerts')
    })

    it('the email has every visit, her contact and the details', async () => {
      seedFourVisits()
      await post(body({ firstName: 'Jessyca', lastName: 'Lope', email: 'jessyca@example.com', phone: '(256) 975-0563', night: 'Tote & Keychain Bar', monogram: true, visitorId: LAPTOP }))
      const mail = m.sendEmail.mock.calls[0][0]
      expect(mail.subject).toBe('Deposit paid: Corky Child Care Collective, Dec 12 · Tote & Keychain Bar + monograms')
      expect(mail.text).toContain('Jessyca Lope · (256) 975-0563 · jessyca@example.com')
      expect(mail.text).toContain('Picked: Tote & Keychain Bar + monograms ($15 more a guest, names due Fri, Nov 27)')
      expect(mail.text).toContain('Visits: 4 visits on 2 devices, first opened Mon Nov 16 9:02 AM')
      expect(mail.text).toContain('Time on page: 12 min in all · deepest scroll 100%')
      expect(mail.text).toContain('Nights tapped: Tote & Keychain Bar ×3, Ornament Bar ×2')
      expect(mail.text).toContain('Tapped "Text us your pick": yes')
      expect(mail.text).toContain('Came from: facebook.com')
      expect(mail.text).toContain('Paid from: Mac')
      expect(mail.text).toContain('- Mon Nov 16 9:02 AM · iPhone · 4 min · 80% scrolled · tapped Tote, Ornament, Tote')
      expect(mail.text).toContain('- Tue Nov 17 11:02 AM · Mac · 5 min · 100% scrolled · tapped Ornament · tapped Text us')
      expect(mail.text).toContain('- Wed Nov 18 11:02 AM · iPhone · 2 min · 60% scrolled · no taps')
      expect(mail.text).toContain('- Wed Nov 18 12:02 PM · Mac · 1 min · 100% scrolled · tapped Tote · monograms on · opened deposit · started paying')
      expect(mail.html).toContain('Tote &amp; Keychain Bar')
    })

    it('no pick → "No night picked yet"', async () => {
      seedFourVisits()
      await post(body({ night: null }))
      expect(m.alert.mock.calls[0][0]).toContain('No night picked yet.')
      expect(m.sendEmail.mock.calls[0][0].text).toContain('No night picked yet')
    })

    it('a night that is not on the page is treated as no pick', async () => {
      await post(body({ night: 'Free Pony Bar' }))
      expect(m.alert.mock.calls[0][0]).toContain('No night picked yet.')
      expect(m.alert.mock.calls[0][0]).not.toContain('Pony')
    })

    it('a very long name still fits: the visit details drop off first', async () => {
      seedFourVisits()
      await post(body({ firstName: 'J'.repeat(60), lastName: 'L'.repeat(60), night: 'Ornament Bar' }))
      const text: string = m.alert.mock.calls[0][0]
      expect(text.length).toBeLessThanOrEqual(300)
      expect(text).toContain('Picked: Ornament Bar.')
    })

    it('the visit log failing still answers 200 paid, with the plain text', async () => {
      seedFourVisits()
      m.kvFail = true
      const res = await post(body({ night: 'Ornament Bar' }))
      expect(res).toEqual({ status: 200, json: { data: { paid: true, receiptUrl: 'https://squareup.com/receipt/1' } } })
      expect(m.alert).toHaveBeenCalledWith('Deposit paid $1,500: Corky Child Care, Sat Dec 12. Jessyca Test (256) 555-0100. Picked: Ornament Bar.', 'booking-alerts')
      expect(m.sendEmail).toHaveBeenCalledTimes(1)
    })

    it('unclear payment: the text adds the pick', async () => {
      m.processPayment.mockRejectedValue(new Error('socket hang up'))
      await post(body({ night: 'Mosaics & Plant Bar' }))
      expect(m.alert.mock.calls[0][0]).toMatch(/^Deposit unclear: Corky Child Care Collective, Dec 12, \$1,500 \(Jessyca Test, \(256\) 555-0100\)\. Check Square.*\. Picked: Mosaics & Plant Bar\.$/)
    })

    it('payment bypass: no summary, no texts', async () => {
      seedFourVisits()
      m.bypass.on = true
      await post(body({ night: 'Ornament Bar', paymentToken: 'mock' }))
      expect(m.alert).not.toHaveBeenCalled()
    })
  })

  describe('monograms (the tote night’s add-on)', () => {
    it('tote + monograms: the text, email and saved record say so; the deposit stays $1,500', async () => {
      const res = await post(body({ night: 'Tote & Keychain Bar', monogram: true }))
      expect(res.status).toBe(200)
      expect(m.processPayment.mock.calls[0][0].amount).toBe(150000)
      expect(m.alert.mock.calls[0][0]).toContain('Picked: Tote & Keychain Bar + monograms.')
      const mail = m.sendEmail.mock.calls[0][0]
      expect(mail.subject).toBe('Deposit paid: Corky Child Care Collective, Dec 12 · Tote & Keychain Bar + monograms')
      expect(mail.text).toContain('Picked: Tote & Keychain Bar + monograms ($15 more a guest, names due Fri, Nov 27)')
      expect(JSON.parse(m.rows.get('corky-paid')!)).toMatchObject({ night: 'Tote & Keychain Bar', monogram: true, firstName: 'Jessyca', receiptUrl: 'https://squareup.com/receipt/1' })
    })

    it('tote without monograms says so in the email', async () => {
      await post(body({ night: 'Tote & Keychain Bar', monogram: false }))
      expect(m.alert.mock.calls[0][0]).toContain('Picked: Tote & Keychain Bar.')
      expect(m.sendEmail.mock.calls[0][0].text).toContain('Picked: Tote & Keychain Bar (no monograms)')
    })

    it.each([
      ['another night', { night: 'Ornament Bar', monogram: true }],
      ['no night', { night: null, monogram: true }],
      ['not a real true', { night: 'Tote & Keychain Bar', monogram: 'yes' }],
    ])('monograms with %s are ignored, never a blocked payment', async (_n, over) => {
      const res = await post(body(over))
      expect(res.status).toBe(200)
      expect(m.alert.mock.calls[0][0]).not.toContain('monograms')
      expect(JSON.parse(m.rows.get('corky-paid')!).monogram).toBe(false)
    })

    it('unclear payment text carries the monograms too', async () => {
      m.processPayment.mockRejectedValue(new Error('socket hang up'))
      await post(body({ night: 'Tote & Keychain Bar', monogram: true }))
      expect(m.alert.mock.calls[0][0]).toMatch(/Picked: Tote & Keychain Bar \+ monograms\.$/)
    })
  })

  describe('paid lock-in', () => {
    it('a real payment saves corky-paid (create-only: an existing record is never replaced)', async () => {
      await post(body({ night: 'Ornament Bar' }))
      const first = m.rows.get('corky-paid')
      expect(JSON.parse(first!)).toMatchObject({ night: 'Ornament Bar', monogram: false, paidAt: expect.any(String), firstName: 'Jessyca' })
      const { savePaid } = await import('@lib/quote/corky-visits')
      const { makeKvStore } = await import('@lib/blob-store')
      expect(await savePaid({ night: 'Mosaics & Plant Bar', monogram: false, paidAt: 'x', firstName: 'Z', receiptUrl: null }, makeKvStore('quote-visits', 'quote-visits'))).toBe(false)
      expect(m.rows.get('corky-paid')).toBe(first)
    })

    it('once paid, a second deposit is answered paid/already and never charged', async () => {
      m.rows.set('corky-paid', JSON.stringify({ night: 'Ornament Bar', monogram: false, paidAt: '2026-11-18T15:02:00.000Z', firstName: 'Jessyca', receiptUrl: null }))
      const res = await post(body({ night: 'Mosaics & Plant Bar' }))
      expect(res).toEqual({ status: 200, json: { data: { paid: true, already: true } } })
      expect(m.createOrder).not.toHaveBeenCalled()
      expect(m.processPayment).not.toHaveBeenCalled()
      expect(m.alert).not.toHaveBeenCalled()
      expect(JSON.parse(m.rows.get('corky-paid')!).night).toBe('Ornament Bar')
    })

    it('a simulated payment writes no lock-in', async () => {
      m.bypass.on = true
      await post(body({ night: 'Ornament Bar', paymentToken: 'mock' }))
      expect(m.rows.has('corky-paid')).toBe(false)
    })

    it('the paid record unreadable: the payment still goes through', async () => {
      m.kvFail = true
      const res = await post(body({ night: 'Ornament Bar' }))
      expect(res.status).toBe(200)
      expect(m.processPayment).toHaveBeenCalledTimes(1)
    })
  })
})
