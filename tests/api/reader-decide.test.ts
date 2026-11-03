// @vitest-environment node
/**
 * Stage 4 fix round 5: what an owner answers about a reader sale in /admin ›
 * To decide, end to end on our own stores (temp dir), Square mocked (nothing
 * real is called):
 *   R1  a payment that didn't match → Keep it, they paid $X · Refund it and let the seat go
 *   R2  a second payment for one sale → Refund it · It's already sorted
 *   R3  a late payment seated over capacity → owners told, Keep them · Refund and free the seat
 *   R5  an order with catalog items is never a reader payment
 *   M-d a split payment (gift card + card) is refused; only Refund it
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  staff: { id: 'sam', name: 'Sam', role: 'crew' } as null | { id: string; name: string; role: 'owner' | 'crew' },
  audit: vi.fn(async (_e: any) => undefined),
  alert: vi.fn(async (_t: string) => undefined),
  confirmation: vi.fn(async (_x: any) => true),
  refundEmail: vi.fn(async (_x: any) => ({ sent: true })),
  refundPayment: vi.fn(),
  orders: new Map<string, any>(),
  payments: new Map<string, any>(),
  search: [] as any[],
  squareDown: false,
}))
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => mocks.staff }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: mocks.alert }))
vi.mock('@lib/email', async (orig) => ({ ...(await orig<typeof import('@lib/email')>()), sendRefundEmail: mocks.refundEmail }))
vi.mock('@config/providers', async (orig) => {
  const real = await orig<typeof import('@config/providers')>()
  return { ...real, providers: { ...real.providers, payment: { ...real.providers.payment, refundPayment: mocks.refundPayment } } }
})
vi.mock('@lib/classes/confirmation', async (orig) => ({ ...(await orig<typeof import('@lib/classes/confirmation')>()), sendClassConfirmation: mocks.confirmation }))
vi.mock('@lib/classes/square-api', async (orig) => ({
  ...(await orig<typeof import('@lib/classes/square-api')>()),
  squareSettings: () => ({ locationId: 'LOC1' }),
  squareFetch: vi.fn(async (path: string, init: RequestInit = {}) => {
    if (mocks.squareDown) throw Object.assign(new Error('Square answered with an error (500).'), { status: 500 })
    if (path === '/orders/search') return { orders: mocks.search }
    const m = /^\/orders\/([^/]+)$/.exec(path)
    if (m && (init.method ?? 'GET') === 'GET') {
      const o = mocks.orders.get(decodeURIComponent(m[1]))
      if (!o) throw Object.assign(new Error('Square said: not found'), { status: 404 })
      return { order: o }
    }
    const p = /^\/payments\/([^/]+)$/.exec(path)
    if (p && (init.method ?? 'GET') === 'GET') {
      const pay = mocks.payments.get(decodeURIComponent(p[1]))
      if (!pay) throw Object.assign(new Error('Square said: not found'), { status: 404 })
      return { payment: pay }
    }
    throw new Error(`unexpected Square call ${path}`)
  }),
}))

import * as readerRoute from '@pages/api/staff/reader.json'
import { createClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { getReaderSale } from '@lib/classes/reader-store'
import { handleOrder } from '@lib/classes/square-events'
import { decide, listToDecide } from '@lib/classes/to-decide'
import { defaultRules } from '@lib/classes/validate'
import type { ClassContent } from '@lib/classes/types'
import { makeKvStore } from '@lib/blob-store'

const NOW = new Date('2026-11-07T21:00:00.000Z') // Sat Nov 7, 3 PM studio time
const by = { id: 'cat', name: 'Catherine' }
const settingsKv = makeKvStore('studio-settings', 'studio-settings')

function content(over: Partial<ClassContent> = {}): ClassContent {
  return {
    name: 'Clay Camp', description: 'Make pots.', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'adult', label: 'Adult' }],
    passes: [{ id: 'all', label: 'Class', covers: { kind: 'all' } }],
    prices: { all: { adult: 3000 } }, questions: [], addOns: [], defaultCapacity: 1, defaultMinutes: 120,
    ...over,
  }
}
const sessions = (capacity = 2) => [{ id: 'ses_1', startIso: '2026-11-08T22:30:00.000Z', endIso: '2026-11-09T00:30:00.000Z', capacity }]
const person = { givenName: 'Gia', familyName: 'Winner', email: 'gia@example.com', phone: '(402) 980-2907' }
let attemptN = 0
let refundN = 0

async function post(body: unknown) {
  const request = new Request('https://studio.test/api/staff/reader.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res: Response = await (readerRoute as any).POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
async function begun(capacity = 2) {
  const cls = await createClass({ content: content(), sessions: sessions(capacity), status: 'open', by })
  const r = await post({ action: 'start', classId: cls.id, passId: 'all', tickets: { adult: 1 }, ...person, attempt: `attempt-${++attemptN}-x`, sendEmail: true })
  const { bookingId, posUrl } = r.body.data
  return { cls, bookingId: bookingId as string, state: JSON.parse(decodeURIComponent(posUrl.split('?data=')[1])).state as string }
}
let orderN = 0
function orderFor(bookingId: string, amount: number, over: Record<string, any> = {}) {
  const n = ++orderN
  const tenders = over.tenders ?? [{ id: `PAY_${n}`, payment_id: `PAY_${n}`, type: 'CARD', note: `Hometown ${bookingId} · Clay Camp` }]
  const order = {
    id: `ORD_${n}`, location_id: 'LOC1', state: 'COMPLETED', created_at: new Date(NOW.getTime() + 60_000).toISOString(),
    total_money: { amount, currency: 'USD' }, total_tip_money: { amount: 0 }, ...over, tenders,
  }
  mocks.orders.set(order.id, order)
  for (const t of tenders) mocks.payments.set(t.payment_id, { id: t.payment_id, status: 'COMPLETED', source_type: 'CARD', total_money: { amount: Math.round(amount / tenders.length) }, order_id: order.id })
  return order
}
const paidReturn = (state: string, orderId: string) => JSON.stringify({ status: 'ok', transaction_id: orderId, client_transaction_id: 'C1', state })
const itemFor = async (kind: string, bookingId: string, at = NOW) => (await listToDecide(at)).items.find((i) => i.kind === kind && i.detail.bookingId === bookingId && !i.done)
const audits = (action: string) => mocks.audit.mock.calls.filter(([e]) => e.action === action)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('SQUARE_POS_CLIENT_ID', 'sq0idp-TEST')
  vi.stubEnv('READER_ENABLED', 'true')
  await settingsKv.set('reader', '')
  mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
  mocks.audit.mockClear(); mocks.alert.mockClear(); mocks.confirmation.mockClear(); mocks.refundEmail.mockClear()
  mocks.refundPayment.mockReset().mockImplementation(async (i: any) => ({ id: `rf_${++refundN}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' }))
  mocks.orders.clear(); mocks.payments.clear(); mocks.search = []; mocks.squareDown = false
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('R1: a reader payment that didn’t match', () => {
  it('shows Keep it / Refund it (never Let the seat go); the owner text names the item; Let go is refused', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3000)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(mocks.alert.mock.calls[0][0]).toMatch(/Open \/admin › To decide › Reader payment didn’t match to keep it or refund it\./)
    const item = (await itemFor('reader-waiting', bookingId))!
    expect(item).toMatchObject({ title: 'Reader payment didn’t match', hint: 'Keep it or refund it', detail: { choices: ['keep', 'refund', 'check'], paidCents: 3000 } })
    expect(item.head).toMatch(/Square shows a payment of \$30\.00 for this sale that doesn’t match the amount asked/)
    expect(item.head).not.toMatch(/Ask Catherine or Kaden/)
    await expect(decide(item.id, 'let-go', {}, by, NOW)).rejects.toMatchObject({ status: 409 })
    const crew = await post({ action: 'let-go', bookingId })
    expect(crew.status).toBe(409)
    expect((await getReaderSale(bookingId))!.state).toBe('waiting')
  })

  it('Keep it: less than the seat asks to confirm the exact shortfall; then the seat is paid with what Square shows, audited, once', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3000)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    await expect(decide(item.id, 'keep', {}, by, NOW)).rejects.toMatchObject({ status: 409, extra: { short: { paidCents: 3000, askedCents: 3270, shortCents: 270 } } })
    // A stale confirm (another amount) is still refused.
    await expect(decide(item.id, 'keep', { confirmPaidCents: 2500 }, by, NOW)).rejects.toMatchObject({ status: 409 })
    const done = await decide(item.id, 'keep', { confirmPaidCents: 3000 }, by, NOW)
    expect(done.decided.what).toBe('Kept. They paid $30 and have their seat')
    const line = (await getLedger(cls.id)).lines[0]
    expect(line).toMatchObject({ state: 'confirmed', source: 'door-reader', square: { orderId: order.id, paymentId: order.tenders[0].payment_id, chargedCents: 3000 } })
    expect(await getReaderSale(bookingId)).toMatchObject({ state: 'paid', paid: { how: 'kept', paidCents: 3000, kept: { shortCents: 270, why: 'amount' } } })
    expect(audits('seat.reader-kept')).toHaveLength(1)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    // Asked again: already done, nothing twice.
    await expect(decide(item.id, 'keep', { confirmPaidCents: 3000 }, by, NOW)).rejects.toMatchObject({ status: 409 })
    expect(audits('seat.reader-kept')).toHaveLength(1)
  })

  it('Keep it: Square is read again first; a payment that matches now is simply seated (nothing kept or refunded)', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3000)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    mocks.orders.set(order.id, { ...order, total_money: { amount: 3270 } })
    await expect(decide(item.id, 'refund', {}, by, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/matches now/) })
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    expect((await getLedger(cls.id)).lines[0].state).toBe('confirmed')
  })

  it('Refund it and let the seat go: that exact payment, whole, through the refund runner; the hold freed; a second tap refunds nothing more', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3500)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    expect(item.detail.choices).toEqual(['keep', 'refund', 'check'])
    const done = await decide(item.id, 'refund', {}, by, NOW)
    expect(done.decided.what).toBe('Refunded $35 and let the seat go')
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    expect(mocks.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId: order.tenders[0].payment_id, amountCents: 3500, idempotencyKey: expect.stringMatching(/^refund:/) })
    expect(await getReaderSale(bookingId)).toMatchObject({ state: 'let-go', ended: { why: 'refunded' }, refunds: [{ paymentId: order.tenders[0].payment_id, cents: 3500 }] })
    expect((await getLedger(cls.id)).lines.every((l) => l.state === 'released')).toBe(true)
    expect(mocks.refundEmail).toHaveBeenCalledTimes(1)
    expect(audits('seat.reader-refund')).toHaveLength(1)
    expect(audits('seat.reader-refunded-let-go')).toHaveLength(1)
    // Idempotent: the item is done; the money call is never made twice.
    const { refundMismatchedReader } = await import('@lib/classes/reader-decide')
    expect(await refundMismatchedReader(bookingId, by, { origin: 'https://studio.test', now: NOW })).toMatchObject({ replayed: true, cents: 3500 })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
  })

  it('Refund it: Square gave no answer → refused plainly; the next tap sends the same request (same key), never a second refund', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3500)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await expect(decide(item.id, 'refund', {}, by, NOW)).rejects.toMatchObject({ status: 502 })
    expect((await getReaderSale(bookingId))!.state).toBe('waiting')
    await decide(item.id, 'refund', {}, by, NOW)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2)
    expect(mocks.refundPayment.mock.calls[1][0].idempotencyKey).toBe(mocks.refundPayment.mock.calls[0][0].idempotencyKey)
  })

  it('I-4: Refund it got no answer → Keep it is refused (a refund was started), never a "paid" seat whose money went back', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3500)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await expect(decide(item.id, 'refund', {}, by, NOW)).rejects.toMatchObject({ status: 502 })
    await expect(decide(item.id, 'keep', {}, by, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/refund of this payment was already started/) })
    expect((await getLedger(cls.id)).lines[0].state).not.toBe('confirmed')
  })

  it('I-4: Keep it and Refund it pressed together on one sale: exactly one goes through', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3500)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    const rs = await Promise.allSettled([decide(item.id, 'refund', {}, by, NOW), decide(item.id, 'keep', {}, by, NOW)])
    expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const sale = (await getReaderSale(bookingId))!
    // whichever won, the other never happened: refunded and let go with no "paid", or kept with no refund
    if (sale.state === 'let-go') expect(sale.paid).toBeFalsy()
    else expect(sale).toMatchObject({ state: 'paid', paid: { how: 'kept' } })
    if (sale.state === 'paid') expect(mocks.refundPayment).not.toHaveBeenCalled()
    else expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
  })

  it('M15: a kept short payment files what was actually paid (net + tax) for the tax report', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3000)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    const item = (await itemFor('reader-waiting', bookingId))!
    await decide(item.id, 'keep', { confirmPaidCents: 3000 }, by, NOW)
    const { getReaderOrderLink } = await import('@lib/classes/reader-store')
    const link = (await getReaderOrderLink(order.id))!
    // $30.00 paid at the quote's 9% share ($32.70 = $30 + $2.70): tax 248, net 2752
    expect(link.netCents + link.taxCents).toBe(3000)
    expect(link.taxCents).toBe(Math.round((3000 * 270) / 3270))
  })

  it('M-d: a split payment (gift card + card) is refused at the door; To decide offers only Refund it, which refunds both payments', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270, {
      tenders: [
        { id: 'PG', payment_id: 'PG', type: 'SQUARE_GIFT_CARD', note: `Hometown ${bookingId}` },
        { id: 'PC', payment_id: 'PC', type: 'CARD', note: `Hometown ${bookingId}` },
      ],
    })
    const r = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(r.body.data).toMatchObject({ outcome: 'refused', message: expect.stringMatching(/split between a gift card and a card/) })
    const item = (await itemFor('reader-waiting', bookingId))!
    expect(item.detail.choices).toEqual(['refund', 'check'])
    await expect(decide(item.id, 'keep', {}, by, NOW)).rejects.toMatchObject({ status: 409 })
    await decide(item.id, 'refund', {}, by, NOW)
    expect(mocks.refundPayment.mock.calls.map(([c]) => c.paymentId).sort()).toEqual(['PC', 'PG'])
  })

  it('M-b: a payment finished more than a day after the sale is "late", not "from before this sale"', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270, { created_at: new Date(NOW.getTime() + 25 * 3_600_000).toISOString() })
    const r = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(r.body.data.message).toMatch(/more than a day after this sale started/)
    expect(mocks.alert.mock.calls[0][0]).toMatch(/finished more than a day after the sale started/)
  })
})

describe('R2: a second reader payment for one sale', () => {
  it('records it, texts owners once naming the item, and To decide refunds exactly that payment', async () => {
    const { cls, bookingId, state } = await begun()
    const first = orderFor(bookingId, 3270)
    await post({ action: 'return', data: paidReturn(state, first.id) })
    const second = orderFor(bookingId, 3270)
    mocks.search = [first, second]
    await post({ action: 'check', bookingId })
    await handleOrder(second, NOW)
    const texts = mocks.alert.mock.calls.map(([t]) => t).filter((t) => /second reader payment/.test(t))
    expect(texts).toEqual(['A second reader payment came in for one sale: Gia Winner, Clay Camp, $32.70. The seat was already paid. Open /admin › To decide › Second reader payment to refund it.'])
    expect(texts.join()).not.toMatch(/at the register/)
    const item = (await itemFor('reader-extra', bookingId))!
    expect(item).toMatchObject({ title: 'Second reader payment', detail: { orderId: second.id, cents: 3270 } })
    const done = await decide(item.id, 'refund', {}, by, NOW)
    expect(done.decided.what).toBe('Refunded $32.70')
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    expect(mocks.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId: second.tenders[0].payment_id, amountCents: 3270 })
    // Their seat stays paid by the first payment.
    expect((await getLedger(cls.id)).lines[0]).toMatchObject({ state: 'confirmed', square: { orderId: first.id } })
    expect(mocks.refundEmail.mock.calls[0][0]).toMatchObject({ keptSeat: true })
  })

  it('It’s already sorted clears it with nothing refunded (audited)', async () => {
    const { bookingId, state } = await begun()
    const first = orderFor(bookingId, 3270)
    await post({ action: 'return', data: paidReturn(state, first.id) })
    const second = orderFor(bookingId, 3270)
    await handleOrder(second, NOW)
    const item = (await itemFor('reader-extra', bookingId))!
    const done = await decide(item.id, 'sorted', {}, by, NOW)
    expect(done.decided.what).toBe('Already sorted. Nothing was refunded')
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    expect(audits('seat.reader-extra-sorted')).toHaveLength(1)
    expect(await itemFor('reader-extra', bookingId)).toBeUndefined()
  })

  it('a payment that didn’t match, then one that did: the one that didn’t becomes a second payment to refund', async () => {
    const { bookingId, state } = await begun()
    const wrong = orderFor(bookingId, 1000)
    await post({ action: 'return', data: paidReturn(state, wrong.id) })
    const right = orderFor(bookingId, 3270)
    mocks.search = [right]
    expect((await post({ action: 'check', bookingId })).body.data.outcome).toBe('paid')
    const item = (await itemFor('reader-extra', bookingId))!
    expect(item.detail).toMatchObject({ orderId: wrong.id, cents: 1000 })
    expect(await itemFor('reader-waiting', bookingId)).toBeUndefined()
  })
})

describe('R3: a late payment seated over capacity', () => {
  it('counts as late: owners texted, To decide (and the warnings line) carry Keep them / Refund and free the seat', async () => {
    const { cls, bookingId } = await begun(1)
    // The 30-minute hold runs out, nobody taps Let go, a walk-in takes the last seat.
    const later = new Date(NOW.getTime() + 45 * 60_000)
    vi.setSystemTime(later)
    const walkIn = await post({ action: 'start', classId: cls.id, passId: 'all', tickets: { adult: 1 }, ...person, givenName: 'Walk', attempt: `attempt-${++attemptN}-y`, sendEmail: false })
    expect(walkIn.status).toBe(200)
    const order = orderFor(bookingId, 3270, { created_at: later.toISOString() })
    await handleOrder(order, later)
    expect((await getLedger(cls.id)).lines.find((l) => l.bookingId === bookingId)).toMatchObject({ state: 'confirmed', overCapacity: true })
    expect(mocks.alert.mock.calls.map(([t]) => t)).toContain('A reader payment came in after its 30-minute hold ran out: Gia Winner, Clay Camp, $32.70. They have their seat (over capacity). Open /admin › To decide › Reader payment came in late to keep them or refund it.')
    const item = (await itemFor('reader-late', bookingId, later))!
    expect(item).toMatchObject({ title: 'Reader payment came in late', detail: { overCapacity: true } })
    const { readerDecideItems } = await import('@lib/classes/reader-decide')
    expect((await readerDecideItems(new Set(), later)).find((w) => w.id === item.id)!.warning).toMatch(/reader payment came in late; they have their seat \(over capacity\)/)
    const done = await decide(item.id, 'refund', {}, by, later)
    expect(done.decided.what).toBe('Refunded $32.70 and freed the seat')
    expect(mocks.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId: order.tenders[0].payment_id, amountCents: 3270 })
  })

  it('Keep them closes it with nothing refunded', async () => {
    const { cls, bookingId } = await begun()
    await post({ action: 'let-go', bookingId })
    await handleOrder(orderFor(bookingId, 3270), NOW)
    const item = (await itemFor('reader-late', bookingId))!
    expect((await decide(item.id, 'keep', {}, by, NOW)).decided.what).toBe('Kept them in the class')
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    expect((await getLedger(cls.id)).lines.some((l) => l.state === 'confirmed')).toBe(true)
  })
})

describe('R5: the return refuses a counter sale', () => {
  it('an order with catalog items (another sale’s money) never seats the reader sale', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270, { tenders: [{ id: 'PX', payment_id: 'PX', type: 'CARD' }], line_items: [{ uid: 'L', catalog_object_id: 'VAR_CLAY', quantity: '1' }] })
    const r = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(r.body.data.outcome).toBe('refused')
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
    // Not this sale's money: Keep/Refund aren't offered; Let the seat go is.
    const item = (await itemFor('reader-waiting', bookingId))!
    expect(item.detail.choices).toEqual(['check', 'let-go'])
  })
})
