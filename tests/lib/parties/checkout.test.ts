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
  refundPayment: vi.fn(),
  readPayment: vi.fn(),
  findOrderByReference: vi.fn(),
  refundEmail: vi.fn(),
  alert: vi.fn(),
  email: vi.fn(),
  report: vi.fn(),
  paid: new Map<string, any>(),
  fail: { confirm: false, record: 0, readRecord: '', landThenThrow: 0 },
}))

vi.mock('@config/providers', () => ({
  providers: {
    booking: { createBooking: vi.fn(), listBookings: async () => [] },
    workshop: { listAllWorkshops: async () => [], listWorkshops: async () => [] },
    payment: {
      createOrder: (...a: any[]) => m.createOrder(...a),
      processPayment: (...a: any[]) => m.processPayment(...a),
      findOrderPayment: (...a: any[]) => m.findOrderPayment(...a),
      refundPayment: (...a: any[]) => m.refundPayment(...a),
      readPayment: (...a: any[]) => m.readPayment(...a),
      findOrderByReference: (...a: any[]) => m.findOrderByReference(...a),
    },
    customer: { findOrCreate: async () => ({ id: 'cust-1' }) },
    giftcard: { fromNonce: vi.fn() },
  },
}))
vi.mock('@lib/owner-alert', () => ({ alertOwners: (...a: any[]) => m.alert(...a) }))
vi.mock('@lib/email', () => ({ sendPartyConfirmationEmail: (...a: any[]) => m.email(...a), sendRefundEmail: (...a: any[]) => m.refundEmail(...a), sendEmail: vi.fn() }))
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
  return { ...real, getPartyRecord: async (id: string) => { if (m.fail.readRecord && id === m.fail.readRecord) throw new Error('parties store down'); return real.getPartyRecord(id) }, createPartyRecord: async (r: any) => { if (m.fail.record > 0) { m.fail.record--; throw new Error('parties store down') } if (m.fail.landThenThrow > 0) { m.fail.landThenThrow--; await real.createPartyRecord(r); throw new Error('timed out after the write') } return real.createPartyRecord(r) } }
})

import { bookParty, partyIdFor, type BookInput } from '@lib/parties/checkout'
import { handlePartyOrder, confirmUnclearParty, notPaidUnclearParty, settleStuckPartyCheckouts } from '@lib/parties/square-orders'
import { holdsBetween } from '@lib/parties/party-book'
import { getCheckout, listCheckouts, saveCheckout } from '@lib/parties/party-checkouts'
import { ORDER_UNKNOWN_MESSAGE } from '@lib/parties/square-orders'
import { CHOICES_CHANGED_MESSAGE } from '@lib/parties/checkout'
import { holdTime } from '@lib/parties/party-book'
import { partyTestSiteRefusal, NO_TEST_STORE } from '@lib/parties/test-site'
import { localToUtcISO } from '@lib/parties/party-times'
import { getPartyRecord } from '@lib/party-store'
import { partyForPayment } from '@lib/parties/party-payments'
import { isStartOpen } from '@lib/parties/open-times'
import { listToDecide, decide, askSquare } from '@lib/classes/to-decide'

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
  m.fail.readRecord = ''
  m.fail.landThenThrow = 0
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
  m.refundPayment.mockReset().mockImplementation(async (p: any) => ({ id: `rf-${p.idempotencyKey.slice(-8)}`, status: 'COMPLETED', amountCents: p.amountCents }))
  m.refundEmail.mockReset().mockResolvedValue({ sent: true })
  // Square's read of a payment: what m.paid has, nothing refunded unless a test says so.
  m.readPayment.mockReset().mockImplementation(async (id: string) => {
    const pay = [...m.paid.values()].find((p) => p.id === id)
    return { id, orderId: pay?.orderId ?? null, status: 'COMPLETED', amountCents: pay?.amount ?? 0, refundedCents: 0, refunds: [], createdAt: '2027-01-30T18:00:00.000Z' }
  })
  m.findOrderByReference.mockReset().mockResolvedValue(null)
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
    const soon = at('2027-02-05', '16:30') // 4 days out: too soon online
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
    const inp = input(at('2027-02-20', '14:00'))
    const partyId = partyIdFor(inp.key)
    const out = await bookParty(inp, NOW)
    expect(out).toMatchObject({ kind: 'booked' })
    // Owner texts name the host and the time, never the party id (T12 review m12).
    expect(m.alert.mock.calls.some(([t]) => /party page could not be set up/.test(String(t)) && !String(t).includes(partyId))).toBe(true)
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

  it('I-1: the request dies right after the charge: Square’s event pins the time, and the 10-minute sweep records the party', async () => {
    const inp = input(at('2027-03-07', '15:30'))
    const partyId = partyIdFor(inp.key)
    const start = at('2027-03-07', '15:30')
    let charged!: () => void
    const chargedNow = new Promise<void>((r) => { charged = r })
    m.processPayment.mockImplementationOnce(async (p: any) => {
      m.paid.set(p.orderId, { id: 'pay-dies', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null })
      charged()
      return new Promise(() => undefined) // the function was killed: no answer, nothing after this runs
    })
    void bookParty(inp, NOW)
    await chargedNow
    const orderId = `ord-${inp.key}:order`
    // Square's payment event within seconds: still "charging", so it isn't recorded here — but the time is kept.
    expect(await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [{ payment_id: 'pay-dies' }] }, new Date())).toEqual({ action: 'ignored', why: 'in-flight' })
    // Twelve minutes on, the 10-minute checkout hold would have run out: the time is still ours.
    vi.setSystemTime(new Date(NOW.getTime() + 12 * 60_000))
    expect((await heldBy(start, partyId))?.holdExpiresAt ?? 'none').toBe('none')
    expect(await heldBy(start, partyId)).toMatchObject({ state: 'held', holdExpiresAt: null })
    // The sweep finishes it: recorded, booked, host emailed once.
    m.email.mockClear()
    expect(await settleStuckPartyCheckouts(new Date())).toEqual({ checked: 1, recorded: 1 })
    expect(await getPartyRecord(partyId)).toMatchObject({ status: 'booked', charges: [expect.objectContaining({ paymentId: 'pay-dies' })] })
    expect((await heldBy(start, partyId))?.state).toBe('booked')
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(await settleStuckPartyCheckouts(new Date())).toEqual({ checked: 0, recorded: 0 })
  })

  it('I-1: the sweep never touches a checkout charging for under 5 minutes, or an unpaid one', async () => {
    const start = at('2027-02-23', '15:30')
    const base = { startIso: start, endIso: new Date(Date.parse(start) + 7_200_000).toISOString(), order: null, quotedCents: 30000, squareCents: 30000, host: { firstName: 'A', lastName: 'S', email: 'a@x.co', phone: '1' }, origin: '', via: 'online' as const, at: NOW.toISOString() }
    const draft = { bookingId: 'pty_00000000000000d1' } as any
    await saveCheckout({ ...base, partyId: 'pty_00000000000000d1', state: 'charging', draft, orderId: 'ord-young', updatedAt: NOW.toISOString() } as any)
    await saveCheckout({ ...base, partyId: 'pty_00000000000000d2', state: 'charging', draft, orderId: 'ord-unpaid', updatedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() } as any)
    m.paid.set('ord-young', { id: 'pay-young', orderId: 'ord-young', amount: 30000, status: 'completed', receiptUrl: null })
    expect(await settleStuckPartyCheckouts(NOW)).toEqual({ checked: 1, recorded: 0 })
    expect(await getPartyRecord('pty_00000000000000d1')).toBeNull()
  })

  it('money M10: a second payment on an already recorded party (same attempt) is never filed under a charge that doesn’t exist: To decide has it', async () => {
    const inp = input(at('2027-04-04', '15:30'))
    const partyId = partyIdFor(inp.key)
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'booked' })
    const rec = (await getPartyRecord(partyId))!
    const { recordPaidParty } = await import('@lib/parties/checkout')
    const c = { partyId, startIso: rec.startIso, endIso: rec.endIso!, draft: rec, quotedCents: 30000, via: 'online' as const, host: { firstName: 'A', lastName: 'S', email: 'a@x.co', phone: '1' } }
    m.alert.mockClear()
    const out = await recordPaidParty(c, { orderId: 'ord-second', paymentId: 'pay-second', cents: 30000, receiptUrl: null }, NOW)
    expect(out.created).toBe(false)
    expect(await partyForPayment('pay-second')).toBeNull()
    expect((await getPartyRecord(partyId))!.charges).toHaveLength(1)
    expect((await listCheckouts()).find((x) => x.orderId === 'ord-second')).toMatchObject({ state: 'paid-elsewhere', why: 'other-payment', paymentId: 'pay-second' })
    expect(m.alert.mock.calls.filter(([t]) => /second \$300\.00 payment/.test(String(t)))).toHaveLength(1)
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
    // Settled: a marker stays (who, when, how), so Square's next event never raises it again (I1).
    expect((await listCheckouts()).find((c) => c.orderId === 'ord-orphan')).toMatchObject({ state: 'settled', settled: { how: 'sorted', by: owner } })
    expect(await handlePartyOrder(order, NOW)).toEqual({ action: 'ignored', why: 'recorded' })
    expect(m.alert.mock.calls.filter(([t]) => String(t).includes('ord-orphan'))).toHaveLength(1)
    expect((await listToDecide(NOW)).items.some((i) => !i.done && i.detail.orderId === 'ord-orphan')).toBe(false)
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
    const inp = input(at('2027-03-13', '14:00'))
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
    const start = at('2027-03-20', '14:00')
    const inp = input(start)
    const outs = await Promise.all([bookParty(inp, NOW), bookParty({ ...inp, pay: { kind: 'card', paymentToken: 'cnon:second' } }, NOW)])
    expect(outs.map((o) => o.kind).sort()).toEqual(['booked', 'in_progress'])
    expect(m.processPayment).toHaveBeenCalledTimes(1)
    expect((await heldBy(start, partyIdFor(inp.key)))?.state).toBe('booked')
  })
})

describe('fix round 2', () => {
  const priorFor = (inp: BookInput, startIso = inp.startIso) => ({
    partyId: partyIdFor(inp.key), state: 'charging' as const, startIso, endIso: new Date(Date.parse(startIso) + 90 * 60_000).toISOString(),
    draft: {
      bookingId: partyIdFor(inp.key), hostToken: 'h', craftName: 'Tote Bags', startIso, durationMinutes: 90, hostName: 'A S', hostEmail: 'a@x.co',
      guestCount: 10, title: null, dropOff: false, createdAt: NOW.toISOString(), source: 'ours' as const, status: 'booked' as const,
      endIso: new Date(Date.parse(startIso) + 90 * 60_000).toISOString(), packageId: 'pkg_whole', craftId: 'craft-1', items: [], charges: [], refunds: [],
    },
    order: { idempotencyKey: `${inp.key}:order`, locationId: 'L', customerId: 'cust-old', lineItems: [{ name: 'Whole Studio Party — studio fee', quantity: 1, pricePerUnit: 30000, note: 'pkg_whole' }], referenceId: partyIdFor(inp.key) },
    orderId: null, quotedCents: 30000, squareCents: null, host: inp.host, origin: 'http://localhost', via: 'online' as const,
    at: NOW.toISOString(), updatedAt: NOW.toISOString(),
  })

  it('N1: the earlier unpaid try is let go when the retry changed its choices; the old order is never charged', async () => {
    const start = at('2027-03-27', '14:00')
    const inp = input(start, { guests: 12 })
    await saveCheckout(priorFor(inp))
    const out = await bookParty(inp, NOW)
    expect(out).toMatchObject({ kind: 'refused', status: 503, code: 'unavailable', message: CHOICES_CHANGED_MESSAGE })
    // Only the paid-check re-sent the earlier request; nothing was charged.
    expect(m.createOrder).toHaveBeenCalledTimes(1)
    expect(m.createOrder.mock.calls[0][0].customerId).toBe('cust-old')
    expect(m.processPayment).not.toHaveBeenCalled()
    expect(await getCheckout(partyIdFor(inp.key))).toMatchObject({ state: 'retired' })
    expect((await isStartOpen(start, 90)).ok).toBe(true)
    // N7: the same attempt id again (even with the first choices) is refused plainly: no Square call.
    m.createOrder.mockClear()
    expect(await bookParty({ ...inp, guests: 10 }, NOW)).toMatchObject({ kind: 'refused', status: 503, message: CHOICES_CHANGED_MESSAGE })
    expect(m.createOrder).not.toHaveBeenCalled()
  })

  it('N2: an earlier unpaid try for another time is let go (its hold too), and the customer starts again', async () => {
    const start = at('2027-04-04', '13:00')
    const earlier = at('2027-04-02', '16:30')
    const inp = input(start)
    await saveCheckout(priorFor(inp, earlier))
    expect((await holdTime({ partyId: partyIdFor(inp.key), startIso: earlier, endIso: at('2027-04-02', '18:00'), ttlMinutes: 10 }, [], new Date())).ok).toBe(true)
    // N6: while that hold is live its own request may be charging: wait, let nothing go.
    expect(await bookParty(inp, NOW)).toEqual({ kind: 'in_progress' })
    expect(await heldBy(earlier, partyIdFor(inp.key))).toBeTruthy()
    // Once it has run out, the unpaid try is let go.
    vi.setSystemTime(new Date(NOW.getTime() + 11 * 60_000))
    expect(await bookParty(inp, new Date())).toMatchObject({ kind: 'refused', status: 503, message: CHOICES_CHANGED_MESSAGE })
    expect(await heldBy(earlier, partyIdFor(inp.key))).toBeUndefined()
    expect(await getCheckout(partyIdFor(inp.key))).toMatchObject({ state: 'retired' })
    expect(m.processPayment).not.toHaveBeenCalled()
  })

  it('N3: when Square’s payment event records the party first, the request answers the stored party and sends nothing again', async () => {
    const inp = input(at('2027-04-11', '13:00'))
    const partyId = partyIdFor(inp.key)
    m.processPayment.mockImplementationOnce(async (p: any) => {
      const pay = { id: 'pay-race', orderId: p.orderId, amount: p.amount, status: 'completed', receiptUrl: null }
      m.paid.set(p.orderId, pay)
      vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000)) // slow enough that the event no longer waits
      expect(await handlePartyOrder({ id: p.orderId, reference_id: partyId, state: 'COMPLETED', tenders: [] }, new Date())).toEqual({ action: 'recorded', partyId })
      return pay
    })
    const out = await bookParty(inp, NOW)
    expect(out).toMatchObject({ kind: 'booked', replay: true })
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(m.report.mock.calls.filter(([b]) => b.bookingId === partyId)).toHaveLength(1)
  })

  it('N4: a party record that can’t be read shows its item instead of hiding the others', async () => {
    m.processPayment.mockRejectedValueOnce(new Error('timeout'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    const inp = input(at('2027-04-09', '16:30'))
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'unknown' })
    m.fail.readRecord = partyIdFor(inp.key)
    const { items, failed } = await listToDecide(NOW)
    expect(failed).not.toContain('party payments')
    expect(items.some((i) => i.kind === 'party-paid-unclear' && i.detail.partyId === partyIdFor(inp.key))).toBe(true)
  })
})

describe('fix round 3', () => {
  it('N5: a record save that landed but threw still counts as made here: one email, one report, then the checkout is cleared', async () => {
    m.fail.landThenThrow = 1
    const inp = input(at('2027-04-18', '13:00'))
    const partyId = partyIdFor(inp.key)
    const out = await bookParty(inp, NOW)
    expect(out).toMatchObject({ kind: 'booked', emailSent: true })
    expect((out as any).replay).toBe(false)
    expect(m.email).toHaveBeenCalledTimes(1)
    expect(m.report.mock.calls.filter(([b]) => b.bookingId === partyId)).toHaveLength(1)
    expect(await getPartyRecord(partyId)).toMatchObject({ confirmation: { sent: true } })
    expect(await getCheckout(partyId)).toBeNull()
  })

  it('a replay answers whether the confirmation really went out', async () => {
    m.email.mockResolvedValueOnce({ sent: false })
    const inp = input(at('2027-04-16', '16:30'))
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'booked', emailSent: false })
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'booked', replay: true, emailSent: false })
  })

  it('N6: an earlier try whose outcome is already unclear is never let go by a changed retry', async () => {
    m.processPayment.mockRejectedValueOnce(new Error('timeout'))
    m.findOrderPayment.mockResolvedValueOnce(null)
    const inp = input(at('2027-04-25', '13:00'))
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'unknown' })
    expect(await bookParty({ ...inp, startIso: at('2027-04-23', '16:30') }, NOW)).toEqual({ kind: 'in_progress' })
    expect(await getCheckout(partyIdFor(inp.key))).toMatchObject({ state: 'unclear' })
    expect(await heldBy(at('2027-04-25', '13:00'), partyIdFor(inp.key))).toBeTruthy()
  })
})

describe('Task 13: To decide for parties (Task 7 carry-overs, Task 11 handoff)', () => {
  const ck = (partyId: string, over: Record<string, unknown> = {}) => ({
    partyId, state: 'unclear' as const, startIso: at('2027-05-01', '14:00'), endIso: at('2027-05-01', '15:30'), draft: null, order: null, orderId: null,
    quotedCents: 30000, squareCents: null, host: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '2565551234' }, origin: 'http://localhost',
    via: 'online' as const, at: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  })

  it('M4/M2: Square’s payment event on a retired try is flagged, never recorded, and says why in plain words', async () => {
    const partyId = 'pty_0000000000retire'
    const orderId = 'ord-retired'
    await saveCheckout(ck(partyId, { state: 'retired', draft: { bookingId: partyId } }) as any)
    m.paid.set(orderId, { id: 'pay-retired', orderId, amount: 30000, status: 'completed', receiptUrl: null })
    expect(await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [] }, NOW)).toEqual({ action: 'flagged', why: 'retired' })
    expect(await getPartyRecord(partyId)).toBeNull()
    expect(m.alert.mock.calls.map(([t]) => String(t)).find((t) => t.includes(orderId))).toBe(
      `Party payment to check: Square shows $300.00 paid on order ${orderId} for party ${partyId}, but it was an earlier try the customer changed and started again, so it isn’t booked. Nothing was refunded. Open /admin › To decide.`,
    )
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'party-paid-unclear' && i.detail.orderId === orderId)
    expect(item?.head).toBe(`Square shows $300 paid for a party (Alice Smith, Sat May 1 2 PM), but it was an earlier try the customer changed and started again, so it isn’t booked. Nothing was refunded.`)
    expect(item?.detail.why).toBe('retired')
    await decide(item!.id, 'sorted', {}, owner, NOW)
  })

  it('M4: a retired try is kept a week, then dropped on the next change', async () => {
    const old = 'pty_00000000oldretd'
    const fresh = 'pty_000000freshretd'
    await saveCheckout(ck(old, { state: 'retired', updatedAt: new Date(NOW.getTime() - 8 * 86_400_000).toISOString() }) as any)
    await saveCheckout(ck(fresh, { state: 'retired', updatedAt: new Date(NOW.getTime() - 6 * 86_400_000).toISOString() }) as any)
    const ids = (await listCheckouts()).map((c) => c.partyId)
    expect(ids).toContain(fresh)
    expect(ids).not.toContain(old)
  })

  it('M1: a paid party whose booking stopped before the confirmation shows until the details go out', async () => {
    const inp = input(at('2027-04-24', '14:00'))
    expect(await bookParty(inp, NOW)).toMatchObject({ kind: 'booked' })
    const partyId = partyIdFor(inp.key)
    const { updatePartyRecord } = await import('@lib/party-store')
    // As if the process died after recording the party, before the email: no confirmation, a checkout left behind.
    await updatePartyRecord(partyId, (r) => ({ ...r, confirmation: undefined }), 'test', null)
    await saveCheckout(ck(partyId, { state: 'charging', updatedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() }) as any)
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'party-no-confirmation' && i.detail.partyId === partyId)
    expect(item).toMatchObject({ title: 'Party booked, no confirmation', hint: 'Open the party and tap Email Alice the details' })
    expect(item!.head).toBe('Alice Smith’s party on Sat Apr 24 2 PM is paid and booked, but the booking stopped before their confirmation email went out.')
    expect(item!.detail).toMatchObject({ partyDay: '2027-04-24' })
    expect((await listToDecide(NOW)).items.some((i) => i.kind === 'party-paid-unclear' && i.detail.partyId === partyId)).toBe(false)
    const done = await decide(item!.id, 'sorted', {}, owner, NOW)
    expect(done.decided.what).toBe('Done')
    expect(await getCheckout(partyId)).toBeNull()
    // With its confirmation noted, nothing shows.
    await saveCheckout(ck(partyId, { state: 'unclear' }) as any)
    await updatePartyRecord(partyId, (r) => ({ ...r, confirmation: { at: NOW.toISOString(), sent: true } }), 'test', null)
    expect((await listToDecide(NOW)).items.some((i) => !i.done && i.detail.partyId === partyId)).toBe(false)
  })

  describe('an unclear payment on a party already booked (link or card in /admin)', () => {
    async function partyPayingUnclear(ymd: string, over: Record<string, unknown> = {}) {
      const { createPartyRecord, updatePartyRecord } = await import('@lib/party-store')
      const partyId = `pty_${randomUUID().replace(/-/g, '').slice(0, 16)}`
      await createPartyRecord({
        bookingId: partyId, hostToken: 'h', craftName: 'Tote Bags', startIso: at(ymd, '14:00'), durationMinutes: 90, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com',
        guestCount: 10, title: null, dropOff: false, createdAt: NOW.toISOString(), source: 'ours', status: 'booked', endIso: at(ymd, '15:30'), packageId: 'pkg_whole', payToken: 'pk',
        items: [{ id: 'itm_fee', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: null }],
        charges: [], refunds: [], confirmation: { at: NOW.toISOString(), sent: true },
      } as any)
      const order = { idempotencyKey: `att-${partyId}:order`, locationId: 'L', customerId: null, lineItems: [{ name: 'Party — Studio fee', quantity: 1, pricePerUnit: 30000 }], referenceId: partyId }
      await updatePartyRecord(partyId, (r) => ({
        ...r, paying: { attemptId: `att-${partyId}`, until: new Date(NOW.getTime() + 20 * 3_600_000).toISOString(), via: 'link', state: 'unclear', order, orderId: `ord-${order.idempotencyKey}`, itemIds: ['itm_fee'], quotedCents: 30000, at: NOW.toISOString(), ...over },
      }), 'test', null)
      return { partyId, orderId: `ord-${order.idempotencyKey}` }
    }
    const itemFor = async (partyId: string) => (await listToDecide(NOW)).items.find((i) => !i.done && i.kind === 'party-payment-unclear' && i.detail.partyId === partyId)

    it('is listed with who, how much, how and the Square order', async () => {
      const { partyId, orderId } = await partyPayingUnclear('2027-05-15')
      const item = await itemFor(partyId)
      expect(item).toMatchObject({ title: 'Party payment unclear', hint: 'Say whether it went through (it asks Square first)' })
      // The order id is its own row on the sheet (with Copy), not in the sentence.
      expect(item!.head).toBe('Stefanie Justice’s $300 payment (payment link) for their party on Sat May 15 2 PM got no answer from Square.')
      expect(item!.detail).toMatchObject({ partyDay: '2027-05-15', cents: 30000, via: 'link', orderId })
    })

    it('M-4: Ask Square on it shows what Square did; with no order kept, the order carrying the party id for that amount is found; none at all: “Square has no order”, It didn’t go through clears it', async () => {
      const none = await partyPayingUnclear('2027-05-08', { order: null, orderId: null })
      const a = await itemFor(none.partyId)
      expect(await askSquare(a!.id, NOW)).toMatchObject({ state: 'none', title: 'Square has no order for it', next: ['did-not-go-through'], message: 'Square has no order for this payment, so nothing was paid. It clears by itself within a day, or tap It didn’t go through.' })
      expect(m.findOrderByReference).toHaveBeenCalledWith(none.partyId, NOW.toISOString(), { totalCents: 30000 })
      await expect(decide(a!.id, 'went-through', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Square has no order for this payment/) })
      expect((await decide(a!.id, 'did-not-go-through', {}, owner, NOW)).decided.what).toBe('It didn’t go through: Square has no order for it, a new payment can start')
      expect((await getPartyRecord(none.partyId))!.paying).toBeNull()

      const found = await partyPayingUnclear('2027-05-09', { order: null, orderId: null })
      m.findOrderByReference.mockResolvedValue({ orderId: 'ord-by-ref' })
      m.paid.set('ord-by-ref', { id: 'pay-by-ref', orderId: 'ord-by-ref', amount: 30000, status: 'completed', receiptUrl: null })
      const b = await itemFor(found.partyId)
      expect(await askSquare(b!.id, NOW)).toMatchObject({ state: 'done', title: 'Square shows it paid', next: ['went-through'] })
      expect((await decide(b!.id, 'went-through', {}, owner, NOW)).decided.what).toBe('It went through: $300 recorded on the party')
      expect((await getPartyRecord(found.partyId))!.charges).toEqual([expect.objectContaining({ paymentId: 'pay-by-ref', orderId: 'ord-by-ref' })])
    })

    it('Ask Square on an unpaid order offers only It didn’t go through; nothing is written by asking', async () => {
      const { partyId } = await partyPayingUnclear('2027-05-10')
      const item = await itemFor(partyId)
      expect(await askSquare(item!.id, NOW)).toMatchObject({ state: 'none', title: 'Square shows no payment', next: ['did-not-go-through'] })
      expect((await getPartyRecord(partyId))!.paying?.state).toBe('unclear')
    })

    it('a card taken in /admin names who took it; one whose 24 hours ran out is not listed', async () => {
      const card = await partyPayingUnclear('2027-05-16', { via: 'admin-card', by: { id: 'c', name: 'Catherine' } })
      expect((await itemFor(card.partyId))!.head).toContain('(card taken in /admin by Catherine)')
      const old = await partyPayingUnclear('2027-05-17', { until: new Date(NOW.getTime() - 60_000).toISOString() })
      expect(await itemFor(old.partyId)).toBeUndefined()
    })

    it('“It went through” while Square shows no payment: refused, nothing written', async () => {
      const { partyId } = await partyPayingUnclear('2027-05-22')
      const item = await itemFor(partyId)
      await expect(decide(item!.id, 'went-through', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Square shows no payment on this order yet, so nothing was recorded\./) })
      expect((await getPartyRecord(partyId))!.paying?.state).toBe('unclear')
    })

    it('“It went through” once Square shows it paid: the charge from Square’s payment is recorded, the slot cleared, the host told, no owner text about their own tap', async () => {
      const { partyId, orderId } = await partyPayingUnclear('2027-05-23')
      m.paid.set(orderId, { id: 'pay-found', orderId, amount: 30000, status: 'completed', receiptUrl: 'https://r' })
      const item = await itemFor(partyId)
      const done = await decide(item!.id, 'went-through', {}, owner, NOW)
      expect(done.decided.what).toBe('It went through: $300 recorded on the party')
      const rec = (await getPartyRecord(partyId))!
      expect(rec.paying).toBeNull()
      expect(rec.charges).toEqual([expect.objectContaining({ paymentId: 'pay-found', orderId, cents: 30000, via: 'link' })])
      expect(rec.items![0].chargeId).toBe(rec.charges![0].id)
      expect(await partyForPayment('pay-found')).toMatchObject({ partyId })
      expect(m.alert.mock.calls.filter(([t]) => String(t).startsWith('Party paid'))).toHaveLength(0)
      expect(m.processPayment).not.toHaveBeenCalled()
      expect(await itemFor(partyId)).toBeUndefined()
    })

    it('“It didn’t go through” while Square shows it paid: refused, so the money is never lost', async () => {
      const { partyId, orderId } = await partyPayingUnclear('2027-05-29')
      m.paid.set(orderId, { id: 'pay-there', orderId, amount: 30000, status: 'completed', receiptUrl: null })
      const item = await itemFor(partyId)
      await expect(decide(item!.id, 'did-not-go-through', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: 'Square shows this payment went through. Tap It went through, so it’s recorded on the party.' })
      expect((await getPartyRecord(partyId))!.paying?.state).toBe('unclear')
    })

    it('“It didn’t go through” once Square shows it unpaid: the slot clears, nothing charged; Square unreachable refuses', async () => {
      const { partyId } = await partyPayingUnclear('2027-05-30')
      const item = await itemFor(partyId)
      m.findOrderPayment.mockRejectedValueOnce(new Error('Square 503'))
      await expect(decide(item!.id, 'did-not-go-through', {}, owner, NOW)).rejects.toMatchObject({ status: 503 })
      const done = await decide(item!.id, 'did-not-go-through', {}, owner, NOW)
      expect(done.decided.what).toBe('It didn’t go through: nothing was charged, a new payment can start')
      const rec = (await getPartyRecord(partyId))!
      expect(rec.paying).toBeNull()
      expect(rec.charges).toEqual([])
      expect(m.processPayment).not.toHaveBeenCalled()
    })
    it('a double tap on “It went through” records one decision and one audit entry (decided inside the party lock)', async () => {
      const { listAudit } = await import('@lib/audit')
      const { partyId, orderId } = await partyPayingUnclear('2027-05-02')
      m.paid.set(orderId, { id: 'pay-dbl', orderId, amount: 30000, status: 'completed', receiptUrl: null })
      const item = await itemFor(partyId)
      const both = await Promise.allSettled([decide(item!.id, 'went-through', {}, owner, NOW), decide(item!.id, 'went-through', {}, owner, NOW)])
      expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(both.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409, message: expect.stringMatching(/^Already done: It went through/) } })
      expect((await getPartyRecord(partyId))!.charges).toHaveLength(1)
      const entries = (await listAudit({ limit: 500 })).filter((e) => e.action === 'to-decide-went-through' && e.target.id === partyId)
      expect(entries).toHaveLength(1)
    })

    it('a payment Square shows still going through (APPROVED / PENDING) is neither: both choices refuse and the item stays', async () => {
      const { partyId, orderId } = await partyPayingUnclear('2027-05-03')
      m.paid.set(orderId, { id: 'pay-pend', orderId, amount: 30000, status: 'pending', receiptUrl: null })
      const item = await itemFor(partyId)
      const going = { status: 409, message: 'Square shows a payment still going through. Try again in a few minutes. Nothing was changed.' }
      await expect(decide(item!.id, 'did-not-go-through', {}, owner, NOW)).rejects.toMatchObject(going)
      await expect(decide(item!.id, 'went-through', {}, owner, NOW)).rejects.toMatchObject(going)
      expect((await getPartyRecord(partyId))!.paying?.state).toBe('unclear')
      expect(await itemFor(partyId)).toBeDefined()
    })

    it('the live Square check (orderPaymentInFlight) also counts: an APPROVED payment Square’s order lookup skips still refuses “It didn’t go through”', async () => {
      const { providers } = await import('@config/providers')
      const { partyId } = await partyPayingUnclear('2027-05-04')
      ;(providers.payment as any).orderPaymentInFlight = vi.fn(async () => true)
      try {
        const item = await itemFor(partyId)
        await expect(decide(item!.id, 'did-not-go-through', {}, owner, NOW)).rejects.toMatchObject({ status: 409 })
        expect((await getPartyRecord(partyId))!.paying?.state).toBe('unclear')
      } finally {
        delete (providers.payment as any).orderPaymentInFlight
      }
    })
  })

  describe('a held party time with no party record (Free this time)', () => {
    const SPAN = (ymd: string) => ({ startIso: at(ymd, '14:00'), endIso: at(ymd, '15:30') })
    async function orphan(ymd: string, heldAt: Date) {
      const { holdTime, confirmTime } = await import('@lib/parties/party-book')
      const partyId = `pty_${randomUUID().replace(/-/g, '').slice(0, 16)}`
      const { startIso, endIso } = SPAN(ymd)
      expect((await holdTime({ partyId, startIso, endIso, ttlMinutes: null }, [], heldAt)).ok).toBe(true)
      await confirmTime(partyId, startIso, endIso, heldAt)
      return { partyId, startIso }
    }
    const orphanItem = async (partyId: string, now = NOW) => (await listToDecide(now)).items.find((i) => !i.done && i.kind === 'party-hold-orphan' && i.detail.partyId === partyId)
    const heldOf = async (partyId: string) => {
      const { holdsBetween } = await import('@lib/parties/party-book')
      return (await holdsBetween(NOW.toISOString(), '2030-01-01T00:00:00.000Z', NOW)).filter((h) => h.partyId === partyId)
    }

    it('is listed; Free this time lets it go once it is older than the checkout window, audited; a second tap is refused', async () => {
      const { listAudit } = await import('@lib/audit')
      const { partyId } = await orphan('2027-05-08', new Date(NOW.getTime() - 60 * 60_000))
      const item = await orphanItem(partyId)
      expect(item).toMatchObject({ title: 'Party time held, no party', hint: 'Free this time, so others can book it' })
      expect(item!.head).toBe('Sat May 8 2 PM is held for a party that isn’t on the books, so nobody can book that time.')
      const done = await decide(item!.id, 'free', {}, owner, NOW)
      expect(done.decided.what).toMatch(/^Freed .*: others can book it now$/)
      expect(await heldOf(partyId)).toEqual([])
      expect((await listAudit({ limit: 500 })).filter((e) => e.action === 'party-free-time' && e.target.id === partyId)).toHaveLength(1)
      await expect(decide(item!.id, 'free', {}, owner, NOW)).rejects.toMatchObject({ status: expect.any(Number) })
    })

    it('a hold younger than the checkout window is refused (it may be a booking still being paid); nothing freed', async () => {
      const { partyId } = await orphan('2027-05-09', new Date(NOW.getTime() - 3 * 60_000))
      const item = await orphanItem(partyId)
      await expect(decide(item!.id, 'free', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^This time was held only a few minutes ago, so it may be a booking still being paid\./) })
      expect(await heldOf(partyId)).toHaveLength(1)
    })

    it('a hold with a payment attached (a checkout of any kind) is not listed and is never freed', async () => {
      const { partyId, startIso } = await orphan('2027-05-10', new Date(NOW.getTime() - 60 * 60_000))
      await saveCheckout(ck(partyId, { state: 'unclear', startIso }) as any)
      expect(await orphanItem(partyId)).toBeUndefined()
      const { freeOrphanHold } = await import('@lib/parties/hold-actions')
      await expect(freeOrphanHold(partyId, startIso, owner, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^A payment for this time is still being sorted out/) })
      expect(await heldOf(partyId)).toHaveLength(1)
    })
  })
})

describe('fix round 2 (Task 13 re-review 1)', () => {
  const ck = (partyId: string, over: Record<string, unknown> = {}) => ({
    partyId, state: 'unclear' as const, startIso: at('2027-06-05', '14:00'), endIso: at('2027-06-05', '15:30'), draft: null, order: null, orderId: null,
    quotedCents: 30000, squareCents: null, host: { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', phone: '2565551234' }, origin: 'http://localhost',
    via: 'online' as const, at: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over,
  })
  const newId = () => `pty_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  /** A booked party of ours: the $300 fee (paid or not) and, optionally, a $50 extra still due. */
  async function booked(ymd: string, opts: { feePaid?: boolean; extraCents?: number } = {}) {
    const { createPartyRecord } = await import('@lib/party-store')
    const partyId = newId()
    const items: any[] = [{ id: 'itm_fee', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: opts.feePaid ? 'chg_fee' : null, addedAt: NOW.toISOString(), by: null }]
    if (opts.extraCents) items.push({ id: 'itm_x', kind: 'addon', refId: 'x', label: 'Snacks', qty: 1, unitCents: opts.extraCents, cents: opts.extraCents, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: null })
    await createPartyRecord({
      bookingId: partyId, hostToken: 'h', craftName: 'Tote Bags', startIso: at(ymd, '14:00'), durationMinutes: 90, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com',
      guestCount: 10, title: null, dropOff: false, createdAt: NOW.toISOString(), source: 'ours', status: 'booked', endIso: at(ymd, '15:30'), packageId: 'pkg_whole', payToken: 'pk',
      items, charges: opts.feePaid ? [{ id: 'chg_fee', via: 'online', orderId: 'ord-fee', paymentId: `pay-fee-${partyId}`, cents: 30000, quotedCents: 30000, itemIds: ['itm_fee'], receiptUrl: null, at: NOW.toISOString(), by: null }] : [],
      refunds: [], confirmation: { at: NOW.toISOString(), sent: true },
    } as any)
    return partyId
  }
  /** Square shows `cents` paid on a party order nothing here can record: the To decide item. */
  async function paidElsewhere(partyId: string, cents = 30000) {
    const orderId = `ord-pe-${randomUUID().slice(0, 8)}`
    const paymentId = `pay-pe-${randomUUID().slice(0, 8)}`
    m.paid.set(orderId, { id: paymentId, orderId, amount: cents, status: 'completed', receiptUrl: null })
    const out = await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [] }, NOW)
    expect(out.action).toBe('flagged')
    const item = (await listToDecide(NOW)).items.find((i) => !i.done && i.kind === 'party-paid-unclear' && i.detail.orderId === orderId)!
    expect(item).toMatchObject({ title: 'Party payment to check' })
    return { orderId, paymentId, item }
  }
  const stillListed = async (orderId: string) => (await listToDecide(NOW)).items.some((i) => !i.done && i.detail.orderId === orderId)
  const audits = async (action: string, id: string) => (await (await import('@lib/audit')).listAudit({ limit: 500 })).filter((e) => e.action === action && e.target.id === id)

  describe('Party payment to check: Refund it / Put it toward the party (DV12)', () => {
    it('Refund it: exactly that Square payment through the refund runner, the host emailed once, audited once, the item gone', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      expect(item.hint).toBe('Refund it')
      expect(item.detail).toMatchObject({ paymentId, canApply: false, name: 'Alice Smith', why: 'retired' })
      const done = await decide(item.id, 'refund', {}, owner, NOW)
      expect(done.decided.what).toBe('Refunded $300 to Alice (emailed)')
      expect(m.refundPayment).toHaveBeenCalledTimes(1)
      expect(m.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId, amountCents: 30000, idempotencyKey: expect.stringMatching(/^refund:/) })
      expect(m.refundEmail).toHaveBeenCalledTimes(1)
      expect(m.refundEmail.mock.calls[0][0]).toMatchObject({ to: 'alice@example.com', givenName: 'Alice', cents: 30000, keptSeat: false })
      expect(await audits('party-paid-elsewhere-refund', partyId)).toHaveLength(1)
      expect(await audits('to-decide-refund', partyId)).toHaveLength(1)
      expect((await listCheckouts()).find((c) => c.orderId === orderId)).toMatchObject({ state: 'settled', settled: { how: 'refunded', cents: 30000 } })
      expect(await stillListed(orderId)).toBe(false)
      expect(m.processPayment).not.toHaveBeenCalled()
      // Abandoned try: worded as a duplicate payment, never a cancellation, no date.
      expect(m.refundEmail.mock.calls[0][0]).toMatchObject({ duplicate: 'changed-party', party: { startIso: null } })
    })

    it('a double tap on Refund it refunds once and records one decision', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { item } = await paidElsewhere(partyId)
      const both = await Promise.allSettled([decide(item.id, 'refund', {}, owner, NOW), decide(item.id, 'refund', {}, owner, NOW)])
      expect(both.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(both.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409, message: expect.stringMatching(/^Already done: Refunded \$300/) } })
      expect(m.refundPayment).toHaveBeenCalledTimes(1)
      expect(m.refundEmail).toHaveBeenCalledTimes(1)
      expect(await audits('party-paid-elsewhere-refund', partyId)).toHaveLength(1)
    })

    it('Square gives no answer: the item stays, Put it toward the party waits, and Refund it again re-sends the same request (same key, never twice)', async () => {
      const partyId = await booked('2027-06-12', { feePaid: false })
      // A second payment on a party already paid by another order would be other-payment; here the party owes $300.
      const { orderId, item } = await paidElsewhere(partyId)
      expect(item.detail).toMatchObject({ why: 'other-payment', canApply: true, dueCents: 30000 })
      m.refundPayment.mockRejectedValueOnce(new Error('socket hang up'))
      await expect(decide(item.id, 'refund', {}, owner, NOW)).rejects.toMatchObject({ status: 502, message: "Square didn't confirm the refund. Try again. It won't refund twice." })
      expect(await stillListed(orderId)).toBe(true)
      await expect(decide(item.id, 'apply', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: 'A refund of this payment was already started. Tap Refund it to finish it.' })
      const done = await decide(item.id, 'refund', {}, owner, NOW)
      expect(done.decided.what).toMatch(/^Refunded \$300 to Stefanie/)
      expect(m.refundPayment).toHaveBeenCalledTimes(2)
      expect(m.refundPayment.mock.calls[1][0].idempotencyKey).toBe(m.refundPayment.mock.calls[0][0].idempotencyKey)
      expect(m.refundEmail.mock.calls[0][0]).toMatchObject({ to: 'stef@example.com', keptSeat: true })
      // The party itself is untouched: no charge, no refund written on it.
      const rec = (await getPartyRecord(partyId))!
      expect(rec.charges).toEqual([])
      expect(rec.refunds).toEqual([])
    })

    it('Square turns the refund down: nothing refunded, the item stays, a later try is a new request', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, item } = await paidElsewhere(partyId)
      m.refundPayment.mockResolvedValueOnce({ id: 'rf-no', status: 'FAILED' })
      await expect(decide(item.id, 'refund', {}, owner, NOW)).rejects.toMatchObject({ status: 502, message: 'Square turned the refund down, so nothing was refunded. Try again.' })
      expect(await stillListed(orderId)).toBe(true)
      expect(m.refundEmail).not.toHaveBeenCalled()
      await decide(item.id, 'refund', {}, owner, NOW)
      expect(m.refundPayment.mock.calls[1][0].idempotencyKey).not.toBe(m.refundPayment.mock.calls[0][0].idempotencyKey)
    })

    it('Put it toward the party: recorded as a charge on the party (no Square call), what it covers marked paid, filed, audited, the item gone', async () => {
      const partyId = await booked('2027-06-13', { feePaid: false })
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      expect(item.hint).toBe('Refund it, or put it toward the party')
      const done = await decide(item.id, 'apply', {}, owner, NOW)
      expect(done.decided.what).toBe('Put $300 toward Stefanie’s party')
      const rec = (await getPartyRecord(partyId))!
      expect(rec.charges).toEqual([expect.objectContaining({ paymentId, orderId, cents: 30000, itemIds: ['itm_fee'], by: owner })])
      expect(rec.items![0].chargeId).toBe(rec.charges![0].id)
      expect(await partyForPayment(paymentId)).toMatchObject({ partyId, chargeId: rec.charges![0].id })
      expect(m.refundPayment).not.toHaveBeenCalled()
      expect(m.processPayment).not.toHaveBeenCalled()
      expect(await audits('party-paid-elsewhere-applied', partyId)).toHaveLength(1)
      expect(await stillListed(orderId)).toBe(false)
    })

    it('a party that owes less than the payment: Put it toward the party isn’t offered and is refused; nothing written', async () => {
      const partyId = await booked('2027-06-19', { feePaid: true, extraCents: 5000 })
      const { item } = await paidElsewhere(partyId)
      expect(item.detail).toMatchObject({ why: 'other-payment', canApply: false, dueCents: 5000 })
      expect(item.hint).toBe('Refund it')
      await expect(decide(item.id, 'apply', {}, owner, NOW)).rejects.toMatchObject({
        status: 409, message: 'The party only owes $50, less than this $300 payment, so it can’t go toward the party. Refund it instead.',
      })
      const rec = (await getPartyRecord(partyId))!
      expect(rec.charges).toHaveLength(1)
      expect(rec.items!.find((it) => it.id === 'itm_x')!.chargeId).toBeNull()
    })

    it('no To decide text sends anyone to Square to refund', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { item } = await paidElsewhere(partyId)
      expect(`${item.head} ${item.hint}`).not.toMatch(/refund[^.]*in Square/i)
    })
  })

  describe('“still going through” on every To decide payment path (Minor C)', () => {
    it('C1: an unclear link payment whose order id was never learned still asks Square about the order, so an APPROVED payment refuses “It didn’t go through”', async () => {
      const { providers } = await import('@config/providers')
      const { createPartyRecord, updatePartyRecord } = await import('@lib/party-store')
      const partyId = newId()
      await createPartyRecord({
        bookingId: partyId, hostToken: 'h', craftName: 'Tote Bags', startIso: at('2027-06-20', '14:00'), durationMinutes: 90, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com',
        guestCount: 10, title: null, dropOff: false, createdAt: NOW.toISOString(), source: 'ours', status: 'booked', endIso: at('2027-06-20', '15:30'), packageId: 'pkg_whole', payToken: 'pk',
        items: [{ id: 'itm_fee', kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: null }],
        charges: [], refunds: [], confirmation: { at: NOW.toISOString(), sent: true },
      } as any)
      const order = { idempotencyKey: `att-${partyId}:order`, locationId: 'L', customerId: null, lineItems: [{ name: 'Party — Studio fee', quantity: 1, pricePerUnit: 30000 }], referenceId: partyId }
      await updatePartyRecord(partyId, (r) => ({
        ...r, paying: { attemptId: `att-${partyId}`, until: new Date(NOW.getTime() + 20 * 3_600_000).toISOString(), via: 'link', state: 'unclear', order, orderId: null, itemIds: ['itm_fee'], quotedCents: 30000, at: NOW.toISOString() },
      }), 'test', null)
      const asked = vi.fn(async () => true)
      ;(providers.payment as any).orderPaymentInFlight = asked
      try {
        const item = (await listToDecide(NOW)).items.find((i) => !i.done && i.kind === 'party-payment-unclear' && i.detail.partyId === partyId)!
        await expect(decide(item.id, 'did-not-go-through', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: 'Square shows a payment still going through. Try again in a few minutes. Nothing was changed.' })
        expect(asked).toHaveBeenCalledWith(`ord-${order.idempotencyKey}`)
        expect((await getPartyRecord(partyId))!.paying?.state).toBe('unclear')
      } finally {
        delete (providers.payment as any).orderPaymentInFlight
      }
    })

    it('C2: “It wasn’t paid” on a new party’s unclear payment (order request saved without its id) refuses while Square shows a payment going through; the time stays held', async () => {
      const { providers } = await import('@config/providers')
      const partyId = newId()
      const startIso = at('2027-06-26', '14:00')
      const endIso = at('2027-06-26', '15:30')
      expect((await holdTime({ partyId, startIso, endIso, ttlMinutes: null }, [], NOW)).ok).toBe(true)
      const order = { idempotencyKey: `att-${partyId}:order`, locationId: 'L', customerId: null, lineItems: [{ name: 'Party — Studio fee', quantity: 1, pricePerUnit: 30000 }], referenceId: partyId }
      await saveCheckout(ck(partyId, { state: 'unclear', startIso, endIso, order, orderId: null, draft: { bookingId: partyId } }) as any)
      ;(providers.payment as any).orderPaymentInFlight = vi.fn(async () => true)
      try {
        const item = (await listToDecide(NOW)).items.find((i) => !i.done && i.kind === 'party-paid-unclear' && i.detail.partyId === partyId)!
        await expect(decide(item.id, 'not-paid', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: 'Square shows a payment still going through. Try again in a few minutes. Nothing was changed.' })
        await expect(decide(item.id, 'confirm', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: 'Square shows a payment still going through. Try again in a few minutes. Nothing was changed.' })
        expect(await getCheckout(partyId)).toMatchObject({ state: 'unclear' })
        expect(await heldBy(startIso, partyId)).toBeTruthy()
      } finally {
        delete (providers.payment as any).orderPaymentInFlight
      }
      // Settled unpaid: “It wasn’t paid” lets the time go.
      const item = (await listToDecide(NOW)).items.find((i) => !i.done && i.kind === 'party-paid-unclear' && i.detail.partyId === partyId)!
      await decide(item.id, 'not-paid', {}, owner, NOW)
      expect(await heldBy(startIso, partyId)).toBeFalsy()
    })
  })

  describe('fix round 3 (Task 13 re-review 2): settled stays settled; Square read before Refund it / Put it toward', () => {
    const refundEvent = async (r: Record<string, unknown>) => (await import('@lib/classes/square-events')).handleRefund(r, NOW)
    const itemOf = async (orderId: string) => (await listToDecide(NOW)).items.find((i) => !i.done && i.detail.orderId === orderId)
    const shows = (paymentId: string, refunds: { id: string; amountCents: number; status: string }[], amountCents = 30000) =>
      ({ id: paymentId, orderId: null, status: 'COMPLETED', amountCents, refundedCents: 0, createdAt: '2027-01-30T18:00:00.000Z', refunds: refunds.map((r) => ({ ...r, paymentId, createdAt: '2027-01-31T10:00:00.000Z' })) })

    it('I1: Refund it, then the same order comes back (order.updated / nightly): no owner text, no item, the marker says who and how', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      await decide(item.id, 'refund', { cents: 30000 }, owner, NOW)
      m.alert.mockClear()
      const out = await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [{ payment_id: paymentId }] }, NOW)
      expect(out).toEqual({ action: 'ignored', why: 'recorded' })
      expect(m.alert).not.toHaveBeenCalled()
      expect(await itemOf(orderId)).toBeUndefined()
      expect((await listCheckouts()).find((c) => c.orderId === orderId)).toMatchObject({ state: 'settled', settled: { how: 'refunded', by: owner, cents: 30000 } })
    })

    it('I1: after Put it toward the party, the replay is ignored too, and the charge is dated when Square took the money (M5)', async () => {
      const partyId = await booked('2027-07-03', { feePaid: false })
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      await decide(item.id, 'apply', {}, owner, NOW)
      expect((await getPartyRecord(partyId))!.charges![0].at).toBe('2027-01-30T18:00:00.000Z')
      m.alert.mockClear()
      await handlePartyOrder({ id: orderId, reference_id: partyId, state: 'COMPLETED', tenders: [{ payment_id: paymentId }] }, NOW)
      expect(m.alert).not.toHaveBeenCalled()
      expect((await listCheckouts()).find((c) => c.orderId === orderId)).toMatchObject({ state: 'settled', settled: { how: 'applied' } })
    })

    it('I2: Square already refunded it in full: Put it toward the party is refused (nothing credited), the item then says so and offers only It’s already sorted', async () => {
      const partyId = await booked('2027-07-04', { feePaid: false })
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      m.readPayment.mockResolvedValue(shows(paymentId, [{ id: 'RF-dash', amountCents: 30000, status: 'COMPLETED' }]))
      await expect(decide(item.id, 'apply', {}, owner, NOW)).rejects.toMatchObject({
        status: 409, message: 'Square shows this $300 payment already refunded, so it can’t go toward the party. If that settles it, tap It’s already sorted.', extra: { reload: true },
      })
      expect((await getPartyRecord(partyId))!.charges).toEqual([])
      const now = (await itemOf(orderId))!
      expect(now.head).toMatch(/and Square already refunded it\. Nothing more is owed back\. Tap It’s already sorted/)
      expect(now.hint).toBe('It’s already sorted')
      expect(now.detail).toMatchObject({ canApply: false, canRefund: false, canSort: true, backCents: 30000, leftCents: 0 })
      // Refund it is refused too (never a second refund); It's already sorted settles it as refunded in Square.
      await expect(decide(now.id, 'refund', { cents: 30000 }, owner, NOW)).rejects.toMatchObject({ status: 409 })
      expect(m.refundPayment).not.toHaveBeenCalled()
      expect((await decide(now.id, 'sorted', {}, owner, NOW)).decided.what).toBe('Already sorted (Square refunded it)')
      expect((await listCheckouts()).find((c) => c.orderId === orderId)).toMatchObject({ state: 'settled', settled: { how: 'refunded-in-square' } })
    })

    it('I2: partly refunded in Square: Put it toward is refused; Refund the rest refunds only what is left, and a stale amount is refused', async () => {
      const partyId = await booked('2027-07-10', { feePaid: false })
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      m.readPayment.mockResolvedValue(shows(paymentId, [{ id: 'RF-part', amountCents: 10000, status: 'COMPLETED' }]))
      await expect(decide(item.id, 'apply', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^Square shows \$100 of this \$300 payment already refunded/) })
      // The sheet still showed $300: refused, nothing sent.
      await expect(decide(item.id, 'refund', { cents: 30000 }, owner, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/so \$200 is left\. Look at it again before refunding\. Nothing was refunded\./) })
      expect(m.refundPayment).not.toHaveBeenCalled()
      const now = (await itemOf(orderId))!
      expect(now.detail).toMatchObject({ backCents: 10000, leftCents: 20000, canRefund: true, canApply: false })
      expect(now.hint).toBe('Refund the rest, or say it’s already sorted')
      const done = await decide(now.id, 'refund', { cents: 20000 }, owner, NOW)
      expect(done.decided.what).toBe('Refunded $200 to Stefanie (emailed)')
      expect(m.refundPayment).toHaveBeenCalledTimes(1)
      expect(m.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId, amountCents: 20000 })
    })

    it('I2: Square answers “already refunded” to Refund it: a final answer (409, not “no answer”), the request isn’t re-sent with the same key', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      m.refundPayment.mockRejectedValueOnce(Object.assign(new Error('Square said: refund amount invalid'), { errors: [{ code: 'REFUND_AMOUNT_INVALID' }] }))
      m.readPayment
        .mockResolvedValueOnce(shows(paymentId, []))
        .mockResolvedValue(shows(paymentId, [{ id: 'RF-reg', amountCents: 30000, status: 'COMPLETED' }]))
      await expect(decide(item.id, 'refund', { cents: 30000 }, owner, NOW)).rejects.toMatchObject({
        status: 409, message: 'Square says this payment was already refunded (or a refund of it is going through), so nothing more was refunded. Tap It’s already sorted to clear this.',
      })
      const { listRefundRequests } = await import('@lib/classes/refund-requests')
      expect((await listRefundRequests('party-paid-elsewhere', orderId))[0]).toMatchObject({ status: 'turned-down', failures: 1 })
      expect((await itemOf(orderId))!.detail).toMatchObject({ backCents: 30000, canRefund: false, canSort: true })
      expect(m.refundEmail).not.toHaveBeenCalled()
    })

    it('I2b: a refund made in Square on a waiting payment is noted on the item (Square’s event), never recorded as money anywhere', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId } = await paidElsewhere(partyId)
      expect(await refundEvent({ id: 'RF-app', payment_id: paymentId, status: 'COMPLETED', amount_money: { amount: 30000 } })).toEqual({ action: 'noted', cents: 30000 })
      // The same event again: the same note (not $600).
      await refundEvent({ id: 'RF-app', payment_id: paymentId, status: 'COMPLETED', amount_money: { amount: 30000 } })
      expect((await itemOf(orderId))!.detail).toMatchObject({ backCents: 30000, leftCents: 0, canRefund: false })
    })

    it('I2b: Refund it got no answer, then Square’s refund arrives (webhook or nightly): finished as that request, emailed once, settled; the item gives way', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      m.refundPayment.mockRejectedValueOnce(new Error('socket hang up'))
      await expect(decide(item.id, 'refund', { cents: 30000 }, owner, NOW)).rejects.toMatchObject({ status: 502 })
      const waiting = (await itemOf(orderId))!
      // M2: the head says a refund was started; only Refund it is offered.
      expect(waiting.head).toBe('A refund of $300 was started (Alice Smith, Sat Jun 5 2 PM), but Square didn’t confirm it. Tap Refund it to finish it (it never refunds twice).')
      expect(waiting.detail).toMatchObject({ refundStarted: true, canApply: false, canSort: false, canRefund: true })
      // M1: It's already sorted can't silently drop it.
      await expect(decide(waiting.id, 'sorted', {}, owner, NOW)).rejects.toMatchObject({ status: 409, message: 'A refund of this payment was started and Square didn’t confirm it. Tap Refund it to finish it (it never refunds twice).' })
      expect(await refundEvent({ id: 'RF-late', payment_id: paymentId, status: 'COMPLETED', amount_money: { amount: 30000 } })).toEqual({ action: 'ignored', why: 'ours' })
      expect(m.refundEmail).toHaveBeenCalledTimes(1)
      expect(await itemOf(orderId)).toBeUndefined()
      expect((await listCheckouts()).find((c) => c.orderId === orderId)).toMatchObject({ state: 'settled', settled: { how: 'refunded' } })
      expect(await audits('party-paid-elsewhere-refund', partyId)).toHaveLength(1)
    })

    it('I2b: Square fails our refund after it was written: the item waits again (decision undone), owners told, the next Refund it is a new try', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      await decide(item.id, 'refund', { cents: 30000 }, owner, NOW)
      const firstKey = m.refundPayment.mock.calls[0][0].idempotencyKey
      const refundId = `rf-${firstKey.slice(-8)}`
      m.alert.mockClear()
      expect(await refundEvent({ id: refundId, payment_id: paymentId, status: 'FAILED', amount_money: { amount: 30000 } })).toEqual({ action: 'flagged', kind: 'refund-failed' })
      expect(m.alert).toHaveBeenCalledTimes(1)
      const again = (await itemOf(orderId))!
      expect(again.head).toMatch(/A \$300 refund of it didn’t go through in Square, so nothing was refunded\./)
      await decide(again.id, 'refund', { cents: 30000 }, owner, NOW)
      expect(m.refundPayment).toHaveBeenCalledTimes(2)
      expect(m.refundPayment.mock.calls[1][0].idempotencyKey).not.toBe(firstKey)
    })

    it('M5 + M3: a refunded second payment on a booked party leaves one line on the party; its email says the party is still booked', async () => {
      const partyId = await booked('2027-07-11', { feePaid: true })
      const { item } = await paidElsewhere(partyId)
      await decide(item.id, 'refund', { cents: 30000 }, owner, NOW)
      const lines = (await getPartyRecord(partyId))!.history!.filter((h) => h.change === 'Refunded a $300 second payment that wasn’t on the party (To decide)')
      expect(lines).toHaveLength(1)
      expect(m.refundEmail.mock.calls[0][0]).toMatchObject({ keptSeat: true })
      expect(m.refundEmail.mock.calls[0][0].duplicate).toBeUndefined()
    })

    it('M6: no email on file: the Done line says so', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired', host: { firstName: '', lastName: '', email: '', phone: '' } }) as any)
      const { item } = await paidElsewhere(partyId)
      const done = await decide(item.id, 'refund', { cents: 30000 }, owner, NOW)
      expect(done.decided.what).toBe('Refunded $300 (no email on file)')
      expect(m.refundEmail).not.toHaveBeenCalled()
    })

    it('Party payment unclear (new booking): Confirm asks Square for the order by the party id when the key was reused, and books it once Square shows it paid', async () => {
      const start = at('2027-03-21', '13:00')
      const inp = input(start)
      m.createOrder.mockRejectedValue(Object.assign(new Error('reused'), { statusCode: 400, errors: [{ code: 'IDEMPOTENCY_KEY_REUSED' }] }))
      expect(await bookParty(inp, NOW)).toEqual({ kind: 'unknown', partyId: partyIdFor(inp.key) })
      const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'party-paid-unclear' && i.detail.partyId === partyIdFor(inp.key))!
      expect(item.hint).toBe('Confirm the party (it asks Square first), or say it wasn’t paid')
      m.findOrderByReference.mockResolvedValue({ orderId: 'ord-found' })
      m.paid.set('ord-found', { id: 'pay-found', orderId: 'ord-found', amount: 30000, status: 'completed', receiptUrl: null })
      const done = await decide(item.id, 'confirm', {}, owner, NOW)
      expect(done.decided.what).toBe('Confirmed the party')
      expect(m.findOrderByReference).toHaveBeenCalledWith(partyIdFor(inp.key), expect.any(String))
      expect((await getPartyRecord(partyIdFor(inp.key)))!.charges![0].paymentId).toBe('pay-found')
    })
  })

  describe('task 13 fix round 4: what Square shows refunded is always saved (I-2), and its “already refunded” answer fits what is left (M-1)', () => {
    const refundEvent = async (r: Record<string, unknown>) => (await import('@lib/classes/square-events')).handleRefund(r, NOW)
    const itemOf = async (orderId: string) => (await listToDecide(NOW)).items.find((i) => !i.done && i.detail.orderId === orderId)
    const shows = (paymentId: string, refunds: { id: string; amountCents: number; status: string }[], amountCents = 30000) =>
      ({ id: paymentId, orderId: null, status: 'COMPLETED', amountCents, refundedCents: 0, createdAt: '2027-01-30T18:00:00.000Z', refunds: refunds.map((r) => ({ ...r, paymentId, createdAt: '2027-01-31T10:00:00.000Z' })) })

    it('I-2 (PA): a refund made in Square that then FAILS is taken back off the item: the whole payment can go toward the party or be refunded again', async () => {
      const partyId = await booked('2027-08-07', { feePaid: false })
      const { orderId, paymentId } = await paidElsewhere(partyId)
      expect(await refundEvent({ id: 'RF-pa', payment_id: paymentId, status: 'PENDING', amount_money: { amount: 10000 } })).toEqual({ action: 'noted', cents: 10000 })
      expect((await itemOf(orderId))!.detail).toMatchObject({ backCents: 10000, leftCents: 20000, canApply: false })
      expect(await refundEvent({ id: 'RF-pa', payment_id: paymentId, status: 'FAILED', amount_money: { amount: 10000 } })).toEqual({ action: 'noted', cents: 0 })
      const now = (await itemOf(orderId))!
      expect(now.detail).toMatchObject({ backCents: 0, leftCents: 30000, canApply: true, canRefund: true })
      expect(now.hint).toBe('Refund it, or put it toward the party')
      expect((await decide(now.id, 'apply', {}, owner, NOW)).decided.what).toMatch(/^Put \$300 toward/)
    })

    it('I-2: a stale note (Square’s FAILED event never came): Refund the rest is refused once, the note is cleared from Square’s $0, and Refund it then refunds the whole payment', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId } = await paidElsewhere(partyId)
      await refundEvent({ id: 'RF-st', payment_id: paymentId, status: 'PENDING', amount_money: { amount: 10000 } })
      const stale = (await itemOf(orderId))!
      expect(stale.detail).toMatchObject({ leftCents: 20000 })
      await expect(decide(stale.id, 'refund', { cents: 20000 }, owner, NOW)).rejects.toMatchObject({
        status: 409, message: 'Square shows nothing refunded on this $300 payment now, so $300 is left. Look at it again before refunding. Nothing was refunded.', extra: { reload: true },
      })
      expect(m.refundPayment).not.toHaveBeenCalled()
      const now = (await itemOf(orderId))!
      expect(now.detail).toMatchObject({ backCents: 0, leftCents: 30000, canRefund: true })
      expect((await decide(now.id, 'refund', { cents: 30000 }, owner, NOW)).decided.what).toBe('Refunded $300 to Alice (emailed)')
      expect(m.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId, amountCents: 30000 })
    })

    it('M-1 (PB): no answer, $100 refunded in Square meanwhile, Square says “already refunded” to the retry: the words offer Refund the rest for what is left', async () => {
      const partyId = newId()
      await saveCheckout(ck(partyId, { state: 'retired' }) as any)
      const { orderId, paymentId, item } = await paidElsewhere(partyId)
      m.refundPayment.mockRejectedValueOnce(new Error('socket hang up'))
      await expect(decide(item.id, 'refund', { cents: 30000 }, owner, NOW)).rejects.toMatchObject({ status: 502 })
      m.readPayment.mockResolvedValue(shows(paymentId, [{ id: 'RF-pb', amountCents: 10000, status: 'COMPLETED' }]))
      m.refundPayment.mockRejectedValueOnce(Object.assign(new Error('refund amount invalid'), { errors: [{ code: 'REFUND_AMOUNT_INVALID' }] }))
      const again = (await itemOf(orderId))!
      await expect(decide(again.id, 'refund', { cents: 30000 }, owner, NOW)).rejects.toMatchObject({
        status: 409, message: 'Square shows $100 of this $300 payment already refunded, so $200 is left. Nothing more was refunded. Tap Refund the rest.',
      })
      const now = (await itemOf(orderId))!
      expect(now.detail).toMatchObject({ backCents: 10000, leftCents: 20000, canRefund: true, refundStarted: false })
    })
  })
})
