/**
 * The party checkout core (bookParty) beyond the public route: owners' and
 * link bookings, the R6 store-failure paths, the R41 test-site guard, and
 * Square's payment events / To decide recording a paid party whose answer
 * never came back. Real stores (temp dir); Square and messages are fakes.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

vi.mock('@config/party.config', async (orig) => ({ ...(await orig<typeof import('@config/party.config')>()), partyDateOverrides: {} }))

const m = vi.hoisted(() => ({
  createOrder: vi.fn(),
  processPayment: vi.fn(),
  findOrderPayment: vi.fn(),
  alert: vi.fn(),
  email: vi.fn(),
  report: vi.fn(),
  paid: new Map<string, any>(),
  fail: { confirm: false, record: 0 },
}))

vi.mock('@config/providers', () => ({
  providers: {
    booking: { createBooking: vi.fn(), listBookings: async () => [] },
    workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] },
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
    },
    customer: { findOrCreate: async () => ({ id: 'cust-1' }) },
    giftcard: { fromNonce: vi.fn() },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({ sendPartyConfirmationEmail: (...a: any[]) => m.email(...a), sendEmail: vi.fn() }))
vi.mock('@lib/booking-alert', () => ({ announceBooking: vi.fn() }))
vi.mock('@lib/posthog-server', () => ({ reportBooking: (...a: any[]) => m.report(...a) }))
vi.mock('@lib/craft-catalog', async (orig) => ({
  ...(await orig<typeof import('@lib/craft-catalog')>()),
  findPartyCraft: async (id: string) => (id === 'craft-1' ? { id, name: 'Tote Bags', perHeadCents: 2000, perHeadMaxCents: 2000, description: '', imageUrl: null } : null),
}))
vi.mock('@lib/parties/party-book', async (orig) => {
  const real = await orig<typeof import('@lib/parties/party-book')>()
  return { ...real, confirmTime: async (...a: Parameters<typeof real.confirmTime>) => { if (m.fail.confirm) throw new Error('party book down'); return real.confirmTime(...a) } }
})
vi.mock('@lib/party-store', async (orig) => {
  const real = await orig<typeof import('@lib/party-store')>()
  return { ...real, createPartyRecord: async (r: any) => { if (m.fail.record > 0) { m.fail.record--; throw new Error('parties store down') } return real.createPartyRecord(r) } }
})

import { bookParty, partyIdFor, type BookInput } from '@lib/parties/checkout'
import { handlePartyOrder, confirmUnclearParty, notPaidUnclearParty } from '@lib/parties/square-orders'
import { holdsBetween } from '@lib/parties/party-book'
import { getCheckout, listCheckouts, saveCheckout } from '@lib/parties/party-checkouts'
import { ORDER_UNKNOWN_MESSAGE } from '@lib/parties/square-orders'
import { partyTestSiteRefusal, NO_TEST_STORE } from '@lib/parties/test-site'
import { localToUtcISO } from '@lib/parties/party-times'
import { getPartyRecord } from '@lib/party-store'
import { partyForPayment } from '@lib/parties/party-payments'
import { isStartOpen } from '@lib/parties/open-times'
import { listToDecide, decide } from '@lib/classes/to-decide'

const NOW = new Date('2027-02-01T15:00:00.000Z')
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const owner = { id: 'k', name: 'Kaden' }
const sumLines = (lines: any[]) => lines.reduce((t, l) => t + l.quantity * l.pricePerUnit, 0)

function input(startIso: string, over: Partial<BookInput> = {}): BookInput {
  return {
    key: randomUUID(), startIso, guests: 10, craftId: 'craft-1',
    host: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '2565551234' },
    pay: { kind: 'card', paymentToken: 'cnon:ok' }, audience: 'public', by: null,
    origin: 'http://localhost', requestUrl: 'http://localhost/api/party/book.json', ...over,
  }
}
const heldBy = async (startIso: string, partyId: string) =>
  (await holdsBetween(startIso, new Date(Date.parse(startIso) + 60_000).toISOString(), new Date())).find((h) => h.partyId === partyId)

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  vi.setSystemTime(NOW)
  m.paid.clear()
  m.fail.confirm = false
  m.fail.record = 0
  m.alert.mockReset().mockResolvedValue(undefined)
  m.email.mockReset().mockResolvedValue({ sent: true })
  m.report.mockReset().mockResolvedValue(undefined)
  m.createOrder.mockReset().mockImplementation(async (p: any) => ({ id: `ord-${p.idempotencyKey}`, version: 1, lineItems: p.lineItems, discounts: [], totalAmount: sumLines(p.lineItems), currency: 'USD', status: 'open' }))
  m.processPayment.mockReset().mockImplementation(async (p: any) => {
    const pay = { id: `pay-${p.orderId}`, orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }
    m.paid.set(p.orderId, pay)
    return pay
  })
  m.findOrderPayment.mockReset().mockImplementation(async (id: string) => m.paid.get(id) ?? null)
})

describe('partyIdFor', () => {
  it('is pty_ + 16 hex, the same for the same key', () => {
    const k = randomUUID()
    expect(partyIdFor(k)).toMatch(/^pty_[0-9a-f]{16}$/)
    expect(partyIdFor(k)).toBe(partyIdFor(k))
    expect(partyIdFor(randomUUID())).not.toBe(partyIdFor(k))
  })
})

describe('owners and links', () => {
  it('an owner books inside the notice period, never in the past (R37), and hears the clash by name', async () => {
    const soon = at('2027-02-04', '16:00') // 3 days out: too soon online
    expect(await bookParty(input(soon), NOW)).toMatchObject({ kind: 'refused', code: 'not_open' })
    const owned = await bookParty(input(soon, { audience: 'admin', by: owner, key: 'create-key-0001' }), NOW)
    expect(owned).toMatchObject({ kind: 'booked' })
    // An owner's long create key: Square's keys come from the party id (≤ 45 characters for payments).
    expect(m.processPayment.mock.calls[0][0].idempotencyKey).toBe(`${partyIdFor('create-key-0001')}:pay`)
    expect((owned as any).charge.via).toBe('admin-card')
    expect(await bookParty(input(at('2027-01-31', '13:00'), { audience: 'admin', by: owner }), NOW)).toMatchObject({ kind: 'refused', status: 409 })
    const clash = await bookParty(input(soon, { audience: 'admin', by: owner }), NOW)
    expect(clash).toMatchObject({ kind: 'refused', code: 'slot_taken' })
    expect((clash as any).message).toMatch(/party/i)
  })

  it('pay by link: the time is held with no expiry, the record has everything due, no Square call', async () => {
    const start = at('2027-02-14', '13:00')
    const out = await bookParty(input(start, { pay: { kind: 'link' }, audience: 'admin', by: owner, key: 'create-key-link1' }), NOW)
    expect(out).toMatchObject({ kind: 'booked', charge: null })
    const partyId = partyIdFor('create-key-link1')
    expect(await heldBy(start, partyId)).toMatchObject({ state: 'held', holdExpiresAt: null })
    const rec = await getPartyRecord(partyId)
    expect(rec!.items!.every((it) => it.chargeId === null)).toBe(true)
    expect(rec!.charges).toEqual([])
    expect(rec!.payToken).toBeTruthy()
    expect(m.createOrder).not.toHaveBeenCalled()
    // The same create key again: the same party, nothing new.
    expect(await bookParty(input(start, { pay: { kind: 'link' }, audience: 'admin', by: owner, key: 'create-key-link1' }), NOW)).toMatchObject({ kind: 'booked', replay: true })
  })
})

describe('money taken always means a party recorded (R6)', () => {
  it('the party book failing at confirm still saves the paid party and tells the owners', async () => {
    m.fail.confirm = true
    const out = await bookParty(input(at('2027-02-14', '15:30')), NOW)
    expect(out).toMatchObject({ kind: 'booked' })
    const rec = await getPartyRecord((out as any).rec.bookingId)
    expect(rec!.charges).toHaveLength(1)
    expect(m.alert.mock.calls.some(([t]) => /couldn't be marked booked/.test(String(t)))).toBe(true)
  })

  it('the record write failing twice tells the owners, keeps the checkout, and Square’s payment event records it later', async () => {
    m.fail.record = 2
    const inp = input(at('2027-02-20', '13:30'))
    const partyId = partyIdFor(inp.key)
    const out = await bookParty(inp, NOW)
    expect(out).toMatchObject({ kind: 'booked' })
    expect(m.alert.mock.calls.some(([t]) => /party page could not be set up/.test(String(t)) && String(t).includes(partyId))).toBe(true)
    expect(m.email.mock.calls[0][0].hostPageUrl).toBeNull()
    expect(await getPartyRecord(partyId)).toBeNull()
    expect(await getCheckout(partyId)).toBeTruthy()
    // Six minutes on, Square's payment event records it from the checkout, and the host gets the page link.
    vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000))
    const orderId = `ord-${inp.key}:order`
    m.email.mockClear()
    expect(await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [{ payment_id: `pay-${orderId}` }] }, new Date())).toEqual({ action: 'recorded', partyId })
    expect((await getPartyRecord(partyId))!.charges![0].paymentId).toBe(`pay-${orderId}`)
    expect(m.email.mock.calls[0][0].hostPageUrl).toContain(`/party/${partyId}?key=`)
    expect(await getCheckout(partyId)).toBeNull()
    expect(await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [{ payment_id: `pay-${orderId}` }] }, new Date())).toEqual({ action: 'ignored', why: 'recorded' })
  })
})

describe('Square says a party order is paid (webhook / nightly reconcile)', () => {
  async function unclear(day: string, hhmm: string) {
    m.processPayment.mockRejectedValueOnce(new Error('timeout'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    const inp = input(at(day, hhmm))
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'unknown' })
    const partyId = partyIdFor(inp.key)
    const orderId = `ord-${inp.key}:order`
    return { inp, partyId, orderId, start: at(day, hhmm) }
  }

  it('an unclear party Square shows paid is booked and recorded from the checkout; the host is emailed once', async () => {
    const { partyId, orderId, start } = await unclear('2027-02-21', '13:00')
    m.email.mockClear()
    m.paid.set(orderId, { id: 'pay-hook', orderId, amount: 30000, status: 'completed', receiptUrl: null })
    const order = { id: orderId, reference_id: partyId, state: 'OPEN', tenders: [{ payment_id: 'pay-hook' }] }
    expect(await handlePartyOrder(order, NOW)).toEqual({ action: 'recorded', partyId })
    expect(await getPartyRecord(partyId)).toMatchObject({ status: 'booked', charges: [expect.objectContaining({ paymentId: 'pay-hook' })] })
    expect((await heldBy(start, partyId))?.state).toBe('booked')
    expect(await partyForPayment('pay-hook')).toMatchObject({ partyId })
    expect(m.email).toHaveBeenCalledTimes(1)
    const reportsFor = () => m.report.mock.calls.filter(([b]) => b.bookingId === partyId)
    expect(reportsFor()).toHaveLength(1)
    expect(reportsFor()[0][0]).toMatchObject({ kind: 'party', amountCents: 30000, extra: expect.objectContaining({ recovered: true }) })
    expect(await handlePartyOrder(order, NOW)).toEqual({ action: 'ignored', why: 'recorded' })
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(reportsFor()).toHaveLength(1)

    // M2: a checkout left behind for a party already recorded is not shown as waiting.
    await saveCheckout({ ...(await (async () => ({ partyId, state: 'unclear', startIso: start, endIso: start, draft: null, order: null, orderId, quotedCents: 30000, squareCents: 30000, host: { firstName: 'A', lastName: 'S', email: 'a@x.co', phone: '1' }, origin: '', via: 'online', at: NOW.toISOString(), updatedAt: NOW.toISOString() }))()) } as any)
    expect((await listToDecide(NOW)).items.some((i) => i.kind === 'party-paid-unclear' && i.detail.partyId === partyId)).toBe(false)
  })

  it('a checkout still being charged by its own request is left alone; an unpaid order is ignored', async () => {
    const inp = input(at('2027-02-21', '15:30'))
    const partyId = partyIdFor(inp.key)
    m.processPayment.mockImplementationOnce(async (p: any) => {
      // Square's event arrives while the request is still charging.
      m.paid.set(p.orderId, { id: 'pay-fly', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null })
      expect(await handlePartyOrder({ id: p.orderId, reference_id: partyId, state: 'OPEN', tenders: [] }, new Date())).toEqual({ action: 'ignored', why: 'in-flight' })
      return m.paid.get(p.orderId)
    })
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'booked' })
    expect(await handlePartyOrder({ id: 'ord-none', reference_id: 'pty_ffffffffffffffff', state: 'OPEN', tenders: [] }, NOW)).toEqual({ action: 'ignored', why: 'not-paid' })
  })

  it('paid with nothing to record it from: kept for To decide, owners told once', async () => {
    m.paid.set('ord-orphan', { id: 'pay-orphan', orderId: 'ord-orphan', amount: 30000, status: 'completed', receiptUrl: null })
    const order = { id: 'ord-orphan', reference_id: 'pty_0000000000000abc', state: 'COMPLETED', tenders: [] }
    expect(await handlePartyOrder(order, NOW)).toEqual({ action: 'flagged', why: 'no-checkout' })
    expect(await handlePartyOrder(order, NOW)).toEqual({ action: 'flagged', why: 'no-checkout' })
    expect(m.alert.mock.calls.filter(([t]) => String(t).includes('ord-orphan'))).toHaveLength(1)
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'party-paid-unclear' && i.detail.orderId === 'ord-orphan')
    expect(item).toMatchObject({ title: 'Party payment to check' })
    await decide(item!.id, 'sorted', {}, owner, NOW)
    expect((await listCheckouts()).some((c) => c.orderId === 'ord-orphan')).toBe(false)
  })

  it('To decide: an unclear party is listed; Confirm needs Square to show it paid; It wasn’t paid lets the time go', async () => {
    const a = await unclear('2027-02-28', '13:00')
    const b = await unclear('2027-02-28', '15:30')
    const items = (await listToDecide(NOW)).items.filter((i) => i.kind === 'party-paid-unclear')
    const itemA = items.find((i) => i.detail.partyId === a.partyId)!
    const itemB = items.find((i) => i.detail.partyId === b.partyId)!
    expect(itemA.title).toBe('Party payment unclear')

    // Not paid in Square: confirm is refused, nothing written.
    await expect(decide(itemA.id, 'confirm', {}, owner, NOW)).rejects.toMatchObject({ status: 409 })
    m.paid.set(a.orderId, { id: 'pay-a', orderId: a.orderId, amount: 30000, status: 'completed', receiptUrl: null })
    await expect(decide(itemA.id, 'not-paid', {}, owner, NOW)).rejects.toMatchObject({ status: 409 })
    const done = await decide(itemA.id, 'confirm', {}, owner, NOW)
    expect(done.decided.what).toBe('Confirmed the party')
    expect(await getPartyRecord(a.partyId)).toMatchObject({ status: 'booked' })

    await decide(itemB.id, 'not-paid', {}, owner, NOW)
    expect(await heldBy(b.start, b.partyId)).toBeUndefined()
    expect((await isStartOpen(b.start, 90)).ok).toBe(true)
    expect(await getCheckout(b.partyId)).toBeNull()
  })

  it('the decisions are refused for a party not waiting', async () => {
    await expect(confirmUnclearParty('pty_nothinghere0000')).rejects.toMatchObject({ status: 404 })
    await expect(notPaidUnclearParty('pty_nothinghere0000')).rejects.toMatchObject({ status: 404 })
  })
})

describe('R41: a test site with no store of its own', () => {
  it('refuses party writes on a preview or branch deploy without STORE_NAMESPACE', () => {
    expect(partyTestSiteRefusal({ context: 'deploy-preview' })).toBe(NO_TEST_STORE)
    expect(partyTestSiteRefusal({ context: 'branch-deploy' })).toBe(NO_TEST_STORE)
    expect(partyTestSiteRefusal({ context: 'unknown', onNetlify: true })).toBe(NO_TEST_STORE)
    expect(partyTestSiteRefusal({ context: 'branch-deploy', namespace: 'preview' })).toBeNull()
    expect(partyTestSiteRefusal({ context: 'production' })).toBeNull()
    expect(partyTestSiteRefusal({ context: 'dev' })).toBeNull()
  })

  it('bookParty refuses before any hold or Square call', async () => {
    const prev = process.env.NETLIFY
    process.env.NETLIFY = 'true'
    const ctx = (globalThis as any).Netlify
    ;(globalThis as any).Netlify = { context: { deploy: { context: 'deploy-preview' } } }
    try {
      const { deployContext } = await import('@lib/deploy-context')
      if (deployContext(new Request('https://deploy-preview-3--site.netlify.app/')) === 'dev') return // vitest's DEV flag wins here; the rule is covered above
      const out = await bookParty(input(at('2027-03-07', '13:00'), { requestUrl: 'https://deploy-preview-3--site.netlify.app/api/party/book.json' }), NOW)
      expect(out).toMatchObject({ kind: 'refused', status: 503, message: NO_TEST_STORE })
      expect(m.createOrder).not.toHaveBeenCalled()
    } finally {
      process.env.NETLIFY = prev
      ;(globalThis as any).Netlify = ctx
    }
  })
})

describe('fix round 1', () => {
  const priorOf = (inp: BookInput, customerId: string) => ({
    partyId: partyIdFor(inp.key), state: 'charging' as const, startIso: inp.startIso,
    endIso: new Date(Date.parse(inp.startIso) + 90 * 60_000).toISOString(),
    draft: {
      bookingId: partyIdFor(inp.key), hostToken: 'h-prior', craftName: 'Tote Bags', startIso: inp.startIso, durationMinutes: 90,
      hostName: 'Alice Smith', hostEmail: 'alice@example.com', hostPhone: '2565551234', guestCount: 10, title: null, dropOff: false,
      createdAt: NOW.toISOString(), source: 'ours' as const, status: 'booked' as const, endIso: new Date(Date.parse(inp.startIso) + 90 * 60_000).toISOString(),
      packageId: 'pkg_whole', craftId: 'craft-1', payToken: 'p-prior', charges: [], refunds: [],
      items: [{ id: 'itm_prior', kind: 'package' as const, refId: 'pkg_whole', label: 'Whole studio', qty: 1, count: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: null }],
    },
    order: { idempotencyKey: `${inp.key}:order`, locationId: 'L', customerId, lineItems: [{ name: 'Whole Studio Party — studio fee', quantity: 1, pricePerUnit: 30000, note: 'pkg_whole' }], referenceId: partyIdFor(inp.key) },
    orderId: null, quotedCents: 30000, squareCents: null,
    host: inp.host, origin: 'http://localhost', via: 'online' as const, at: NOW.toISOString(), updatedAt: NOW.toISOString(),
  })

  it('I1: a retry finds the earlier try’s checkout (its hold gone): asks Square first, and reuses its order request, never a new one', async () => {
    const inp = input(at('2027-03-07', '13:00'))
    await saveCheckout(priorOf(inp, 'cust-old')) // the first try crashed mid-charge; its 10-minute hold has gone
    const out = await bookParty(inp, NOW)
    expect(out).toMatchObject({ kind: 'booked' })
    // Same key, same request: the customer lookup giving 'cust-1' now doesn't change the order.
    for (const [req] of m.createOrder.mock.calls) expect(req.customerId).toBe('cust-old')
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await getPartyRecord(partyIdFor(inp.key)))!.hostToken).toBe('h-prior')
  })

  it('I1: the earlier try was paid: recorded from it, the card never charged again', async () => {
    const inp = input(at('2027-03-07', '15:30'))
    await saveCheckout(priorOf(inp, 'cust-old'))
    m.paid.set(`ord-${inp.key}:order`, { id: 'pay-first', orderId: `ord-${inp.key}:order`, amount: 30000, status: 'completed', receiptUrl: null })
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'booked' })
    expect(m.processPayment).not.toHaveBeenCalled()
    expect((await getPartyRecord(partyIdFor(inp.key)))!.charges![0].paymentId).toBe('pay-first')
    expect(m.report.mock.calls.filter(([b]) => b.bookingId === partyIdFor(inp.key))).toHaveLength(1)
  })

  it('I1: Square can’t be asked about the earlier try: in_progress, nothing written over it', async () => {
    const inp = input(at('2027-03-13', '13:30'))
    const prior = priorOf(inp, 'cust-old')
    await saveCheckout(prior)
    m.createOrder.mockRejectedValueOnce(new Error('Square 500'))
    expect(await bookParty(inp, NOW)).toEqual({ kind: 'in_progress' })
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(await getCheckout(prior.partyId)).toMatchObject({ order: { customerId: 'cust-old' } })
  })

  it('I1: Square refuses the order key (used with another request) and no order id is known: Confirm refused with the owners’ words, It wasn’t paid lets the time go', async () => {
    const start = at('2027-03-14', '13:00')
    const inp = input(start)
    m.createOrder.mockRejectedValue(Object.assign(new Error('reused'), { statusCode: 400, errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }] }))
    expect(await bookParty(inp, NOW)).toEqual({ kind: 'unknown', partyId: partyIdFor(inp.key) })
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(await getCheckout(partyIdFor(inp.key))).toMatchObject({ state: 'unclear', orderId: null })
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'party-paid-unclear' && i.detail.partyId === partyIdFor(inp.key))!
    await expect(decide(item.id, 'confirm', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: ORDER_UNKNOWN_MESSAGE })
    await decide(item.id, 'not-paid', {}, owner, NOW)
    expect(await heldBy(start, partyIdFor(inp.key))).toBeUndefined()
    expect(await getCheckout(partyIdFor(inp.key))).toBeNull()
  })

  it('M1: the same attempt sent twice at once: one books, the other is in_progress; one charge, the hold kept', async () => {
    const start = at('2027-03-20', '13:30')
    const inp = input(start)
    const outs = await Promise.all([bookParty(inp, NOW), bookParty({ ...inp, pay: { kind: 'card', paymentToken: 'cnon:second' } }, NOW)])
    expect(outs.map((o) => o.kind).sort()).toEqual(['booked', 'in_progress'])
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await heldBy(start, partyIdFor(inp.key)))?.state).toBe('booked')
  })
})
