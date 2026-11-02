// @vitest-environment node
/**
 * Stage 4 Task 11: Charge on the reader, end to end on our own stores (temp
 * dir): start → the Square app link → every way the app can come back →
 * the order checked with Square (mocked; nothing real is called) → the seat.
 * Plus Check again, Let the seat go, Square's own notice, To decide, and the
 * /admin on/off switch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  staff: { id: 'sam', name: 'Sam', role: 'crew' } as null | { id: string; name: string; role: 'owner' | 'crew' },
  audit: vi.fn(async (_e: any) => undefined),
  alert: vi.fn(async (_t: string) => undefined),
  confirmation: vi.fn(async (_x: any) => true),
  orders: new Map<string, any>(),
  search: [] as any[],
  squareDown: false,
}))
vi.mock('@lib/staff-auth', async (orig) => ({ ...(await orig<typeof import('@lib/staff-auth')>()), staffAuthorized: () => mocks.staff }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: mocks.alert }))
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
    throw new Error(`unexpected Square call ${path}`)
  }),
}))

import * as readerRoute from '@pages/api/staff/reader.json'
import * as adminReaderRoute from '@pages/api/admin/reader.json'
import { adminCookie } from '@lib/admin-auth'
import { createClass } from '@lib/classes/class-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { getReaderSale, linkReaderOrder } from '@lib/classes/reader-store'
import { saveReaderSetting } from '@lib/classes/reader-setting'
import { signState, READER_DECIDE_AFTER_MS } from '@lib/classes/reader'
import { signingSecret } from '@lib/reuse-token'
import { handleOrder, listUnmatchedPos } from '@lib/classes/square-events'
import { decide, listToDecide } from '@lib/classes/to-decide'
import { makeKvStore } from '@lib/blob-store'
import { defaultRules } from '@lib/classes/validate'
import type { ClassContent } from '@lib/classes/types'

const NOW = new Date('2026-11-07T21:00:00.000Z') // Sat Nov 7, 3 PM studio time
const by = { id: 'admin', name: 'Owner' }
const settingsKv = makeKvStore('studio-settings', 'studio-settings')

function content(over: Partial<ClassContent> = {}): ClassContent {
  return {
    name: 'Clay Camp', description: 'Make pots.', imageUrl: null, instructor: null, rules: defaultRules(),
    ticketTypes: [{ id: 'adult', label: 'Adult' }],
    passes: [{ id: 'all', label: 'Class', covers: { kind: 'all' } }],
    prices: { all: { adult: 3500 } }, questions: [], addOns: [], defaultCapacity: 2, defaultMinutes: 120,
    // D4: the door charges the current price, the early-bird while it runs.
    earlyBird: { untilYmd: '2026-11-07', prices: { all: { adult: 3000 } } },
    ...over,
  }
}
const sessions = () => [{ id: 'ses_1', startIso: '2026-11-07T22:30:00.000Z', endIso: '2026-11-08T00:30:00.000Z', capacity: 2 }]
const person = { givenName: 'Gia', familyName: 'Winner', email: 'gia@example.com', phone: '(402) 980-2907' }
let attemptN = 0

async function call(route: any, body: unknown, method: 'POST' | 'GET' = 'POST', headers: Record<string, string> = {}) {
  const request = new Request('https://studio.test/api/staff/reader.json', {
    method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (method === 'POST' ? route.POST : route.GET)({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const post = (body: unknown) => call(readerRoute, body)

async function newClass(over: Partial<ClassContent> = {}) {
  return createClass({ content: content(over), sessions: sessions(), status: 'open', by })
}
async function start(classId: string, extra: Record<string, unknown> = {}) {
  return post({ action: 'start', classId, passId: 'all', tickets: { adult: 1 }, ...person, attempt: `attempt-${++attemptN}-x`, sendEmail: true, ...extra })
}
const dataOf = (posUrl: string) => JSON.parse(decodeURIComponent(posUrl.split('?data=')[1]))
/** The order Square would show for a sale (override any part). */
function orderFor(bookingId: string, amount: number, over: Record<string, unknown> = {}) {
  return {
    id: `ORD_${bookingId.slice(-8)}`, location_id: 'LOC1', state: 'COMPLETED', created_at: new Date(NOW.getTime() + 60_000).toISOString(),
    total_money: { amount, currency: 'USD' }, total_tip_money: { amount: 0 },
    tenders: [{ id: `PAY_${bookingId.slice(-8)}`, payment_id: `PAY_${bookingId.slice(-8)}`, type: 'CARD', note: `Hometown ${bookingId} · Clay Camp` }],
    ...over,
  }
}
const paidReturn = (state: string, orderId: string) => JSON.stringify({ status: 'ok', transaction_id: orderId, client_transaction_id: 'C1', state })
const errorReturn = (state: string, code: string) => JSON.stringify({ status: 'error', error_code: code, state })
const audits = (action: string) => mocks.audit.mock.calls.filter(([e]) => e.action === action)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubEnv('SQUARE_POS_CLIENT_ID', 'sq0idp-TEST')
  vi.stubEnv('READER_ENABLED', 'true')
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  await settingsKv.set('reader', '')
  mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
  mocks.audit.mockClear(); mocks.alert.mockClear(); mocks.confirmation.mockClear()
  mocks.orders.clear(); mocks.search = []; mocks.squareDown = false
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

describe('turning it on and off', () => {
  it('READER_ENABLED off → the sheet hides it and start answers 404, nothing held', async () => {
    vi.stubEnv('READER_ENABLED', '')
    const cls = await newClass()
    expect((await call(readerRoute, null, 'GET')).body.data).toMatchObject({ on: false })
    const r = await start(cls.id)
    expect(r.status).toBe(404)
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
  })

  it('an owner turns it on in /admin (no Netlify), and off again, audited', async () => {
    vi.stubEnv('READER_ENABLED', '')
    const cookie = adminCookie().split(';')[0]
    const off = await call(adminReaderRoute, null, 'GET', { cookie })
    expect(off.body.data).toMatchObject({ on: false, linked: true, source: 'site', updatedAt: null })
    const on = await call(adminReaderRoute, { enabled: true, expectedUpdatedAt: null }, 'POST', { cookie })
    expect(on.status).toBe(200)
    expect(on.body.data).toMatchObject({ on: true, source: 'saved' })
    expect((await call(readerRoute, null, 'GET')).body.data).toMatchObject({ on: true, linked: true, message: null })
    // Someone else's screen still has the old one: refused, not written over.
    expect((await call(adminReaderRoute, { enabled: false, expectedUpdatedAt: null }, 'POST', { cookie })).status).toBe(409)
    const offAgain = await call(adminReaderRoute, { enabled: false, expectedUpdatedAt: on.body.data.updatedAt }, 'POST', { cookie })
    expect(offAgain.body.data.on).toBe(false)
    expect(audits('reader.turned-on')).toHaveLength(1)
    expect(audits('reader.turned-off')).toHaveLength(1)
    expect((await call(adminReaderRoute, { enabled: true }, 'POST')).status).toBe(401)
  })

  it('on, but no client id → a plain message, not a dead end; start refuses and holds nothing', async () => {
    vi.stubEnv('SQUARE_POS_CLIENT_ID', '')
    const cls = await newClass()
    const g = await call(readerRoute, null, 'GET')
    expect(g.body.data).toEqual({ on: true, linked: false, message: 'Charge on the reader isn’t linked to the Square app yet, so it can’t be used. Pay on the iPad and Pay at the counter still work.' })
    const r = await start(cls.id)
    expect(r.status).toBe(409)
    expect(r.body.error).toMatch(/Pay on the iPad and Pay at the counter still work/)
    expect((await getLedger(cls.id)).lines).toHaveLength(0)
  })

  it('a saved Off beats READER_ENABLED=true', async () => {
    await saveReaderSetting(false, by, null)
    const cls = await newClass()
    expect((await start(cls.id)).status).toBe(404)
  })
})

describe('start', () => {
  it('holds the seat as a reader sale at the early-bird price and hands back the Square app link', async () => {
    const cls = await newClass()
    const r = await start(cls.id)
    expect(r.status).toBe(200)
    const { bookingId, amountCents, posUrl } = r.body.data
    expect(amountCents).toBe(3270) // $30 early-bird + 9%
    const data = dataOf(posUrl)
    expect(data).toMatchObject({
      amount_money: { amount: 3270, currency_code: 'USD' }, callback_url: 'https://studio.test/staff/pos-return', client_id: 'sq0idp-TEST', version: '1.3',
      options: { supported_tender_types: ['CREDIT_CARD', 'SQUARE_GIFT_CARD'], clear_default_fees: true, auto_return: true },
    })
    expect(data.notes).toBe(`Hometown ${bookingId} · Clay Camp Sat, Nov 7 · Gia Winner`)
    expect(data.state.startsWith(`${bookingId}.`)).toBe(true)
    const [line] = (await getLedger(cls.id)).lines
    expect(line).toMatchObject({ bookingId, source: 'door-reader', state: 'held', priceCents: 3000, taxCents: 270, by: { id: 'sam', name: 'Sam' } })
    expect(Date.parse(line.holdExpiresAt!) - NOW.getTime()).toBe(30 * 60_000)
    expect(await getReaderSale(bookingId)).toMatchObject({ state: 'waiting', amountCents: 3270, classId: cls.id })
    expect(audits('seat.reader-started')).toHaveLength(1)
  })

  it('a retry of the same sheet gives the same sale and amount, never a second hold', async () => {
    const cls = await newClass()
    const ask = { action: 'start', classId: cls.id, passId: 'all', tickets: { adult: 1 }, ...person, attempt: 'same-attempt-1' }
    const a = await post(ask)
    const b = await post(ask)
    expect(b.body.data).toMatchObject({ bookingId: a.body.data.bookingId, amountCents: 3270, replayed: true })
    expect((await getLedger(cls.id)).lines).toHaveLength(1)
  })

  it('a full day refuses until the crew squeeze one more in', async () => {
    const cls = await newClass()
    await start(cls.id, { tickets: { adult: 2 } })
    const full = await start(cls.id)
    expect(full.status).toBe(409)
    expect(full.body.code).toBe('sold_out')
    expect((await start(cls.id, { overCapacity: true })).status).toBe(200)
  })

  it('needs the staff sign-in', async () => {
    const cls = await newClass()
    mocks.staff = null
    expect((await start(cls.id)).status).toBe(401)
  })
})

describe('the app comes back', () => {
  async function begun(over: Partial<ClassContent> = {}) {
    const cls = await newClass(over)
    const r = await start(cls.id)
    const { bookingId, amountCents, posUrl } = r.body.data
    return { cls, bookingId, amountCents, state: dataOf(posUrl).state as string }
  }

  it('paid: Square’s order checks out → the seat is paid (door-reader, order and payment linked), one email', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270)
    mocks.orders.set(order.id, order)
    const r = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ outcome: 'paid', message: 'Paid $32.70 on the reader. Gia is on the class list.', classId: cls.id })
    const [line] = (await getLedger(cls.id)).lines
    expect(line).toMatchObject({ source: 'door-reader', state: 'confirmed', holdExpiresAt: null, square: { orderId: order.id, paymentId: order.tenders[0].id, chargedCents: 3270 } })
    expect(await getReaderSale(bookingId)).toMatchObject({ state: 'paid', paid: { orderId: order.id, how: 'return' } })
    expect(mocks.confirmation).toHaveBeenCalledTimes(1)
    expect(mocks.confirmation.mock.calls[0][0]).toMatchObject({ bookingId, totalChargedCents: 3270, email: 'gia@example.com' })
    expect(audits('seat.sold-on-reader')).toHaveLength(1)
  })

  it('replay: the same return again gets the same answer, one confirm, one email', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270)
    mocks.orders.set(order.id, order)
    const first = await post({ action: 'return', data: paidReturn(state, order.id) })
    const again = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(again.body.data).toEqual(first.body.data)
    expect((await getLedger(cls.id)).lines).toHaveLength(1)
    expect(mocks.confirmation).toHaveBeenCalledTimes(1)
    expect(audits('seat.sold-on-reader')).toHaveLength(1)
  })

  it('double return at the same moment: one paid seat, one email, one audit', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270)
    mocks.orders.set(order.id, order)
    const [a, b] = await Promise.all([post({ action: 'return', data: paidReturn(state, order.id) }), post({ action: 'return', data: paidReturn(state, order.id) })])
    expect([a.body.data.outcome, b.body.data.outcome]).toEqual(['paid', 'paid'])
    expect((await getLedger(cls.id)).lines.filter((l) => l.state === 'confirmed')).toHaveLength(1)
    expect(mocks.confirmation).toHaveBeenCalledTimes(1)
    expect(audits('seat.sold-on-reader')).toHaveLength(1)
  })

  it('forged state → 400, nothing changes (no Square call, seat still held)', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270)
    mocks.orders.set(order.id, order)
    const forged = signState(bookingId, 'not-our-secret', NOW)
    const r = await post({ action: 'return', data: paidReturn(forged, order.id) })
    expect(r.status).toBe(400)
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
    expect((await getReaderSale(bookingId))!.state).toBe('waiting')
    // Junk that isn't Square's answer at all.
    expect((await post({ action: 'return', data: 'hello' })).status).toBe(400)
    // A real state for a booking we never sold.
    expect((await post({ action: 'return', data: paidReturn(signState('bkg_never', signingSecret(), NOW), order.id) })).status).toBe(404)
    expect(state).toBeTruthy()
  })

  it('an expired state → 410 with Check again; nothing changes', async () => {
    const { cls, bookingId, state } = await begun()
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3_600_000))
    const r = await post({ action: 'return', data: paidReturn(state, 'ORD_X') })
    expect(r.status).toBe(410)
    expect(r.body.error).toMatch(/Check again/)
    expect((await getReaderSale(bookingId))!.state).toBe('waiting')
    expect((await getLedger(cls.id)).lines.every((l) => l.state === 'held')).toBe(true)
  })

  it('cancel → the seat is let go, "Nothing was charged"', async () => {
    const { cls, bookingId, state } = await begun()
    const r = await post({ action: 'return', data: errorReturn(state, 'payment_canceled') })
    expect(r.body.data).toMatchObject({ outcome: 'cancelled', message: 'Cancelled on the reader. Nothing was charged, and the seat was let go.' })
    expect((await getLedger(cls.id)).lines[0].state).toBe('released')
    expect((await getReaderSale(bookingId))!.state).toBe('cancelled')
    expect(mocks.alert).not.toHaveBeenCalled()
    // The same answer again: the same words, nothing more.
    expect((await post({ action: 'return', data: errorReturn(state, 'payment_canceled') })).body.data.outcome).toBe('cancelled')
  })

  it('the iPad isn’t signed in to Square → let go, with how to fix it', async () => {
    const { cls, state } = await begun()
    const r = await post({ action: 'return', data: errorReturn(state, 'not_logged_in') })
    expect(r.body.data.message).toMatch(/isn’t signed in.*Sign in to the studio’s account in the Square app/)
    expect((await getLedger(cls.id)).lines[0].state).toBe('released')
  })

  it('a setup error (the app refused our link) → let go, owners told with the in-app switch', async () => {
    const { state } = await begun()
    await post({ action: 'return', data: errorReturn(state, 'client_not_authorized') })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.alert.mock.calls[0][0]).toMatch(/\/admin › More › Register setup/)
  })

  it('wrong amount → refused, seat still held, owners alerted (once)', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 100)
    mocks.orders.set(order.id, order)
    const r = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(r.body.data.outcome).toBe('refused')
    expect(r.body.data.message).toMatch(/different amount/)
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
    expect(await getReaderSale(bookingId)).toMatchObject({ state: 'waiting', problem: { why: 'amount', orderId: order.id } })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
    expect(mocks.alert.mock.calls[0][0]).toMatch(/Square shows \$1\.00.*\/admin › To decide/)
    await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(mocks.alert).toHaveBeenCalledTimes(1)
  })

  it('another location / an OPEN order / an old order / cash → not marked paid', async () => {
    const { cls, bookingId, state } = await begun()
    const cases: [Record<string, unknown>, string][] = [
      [{ location_id: 'LOC2' }, 'refused'],
      [{ state: 'OPEN' }, 'waiting'],
      [{ created_at: new Date(NOW.getTime() - 3_600_000).toISOString() }, 'refused'],
      [{ tenders: [{ id: 'CASH1', type: 'CASH', note: `Hometown ${bookingId}` }] }, 'refused'],
    ]
    for (const [i, [over, outcome]] of cases.entries()) {
      const order = orderFor(bookingId, 3270, { id: `ORD_case${i}`, ...over })
      mocks.orders.set(order.id, order)
      const r = await post({ action: 'return', data: paidReturn(state, order.id) })
      expect(r.body.data.outcome).toBe(outcome)
    }
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
    expect((await getReaderSale(bookingId))!.state).toBe('waiting')
  })

  it('an order already used for another booking → refused (never two seats from one payment)', async () => {
    const { cls, bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270)
    mocks.orders.set(order.id, order)
    await linkReaderOrder({ orderId: order.id, bookingId: 'bkg_someone_else', classId: cls.id, netCents: 3000, taxCents: 270, at: NOW.toISOString() })
    const r = await post({ action: 'return', data: paidReturn(state, order.id) })
    expect(r.body.data).toMatchObject({ outcome: 'refused', message: expect.stringMatching(/already paid for another seat/) })
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
  })

  it('Square can’t be reached → the seat stays held, try Check again', async () => {
    const { cls, state } = await begun()
    mocks.squareDown = true
    const r = await post({ action: 'return', data: paidReturn(state, 'ORD_ANY') })
    expect(r.body.data).toMatchObject({ outcome: 'unknown', message: expect.stringMatching(/Check again/) })
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
  })

  it('offline payment → the seat is held a day while Square finishes it', async () => {
    const { cls, bookingId, state } = await begun()
    const r = await post({ action: 'return', data: JSON.stringify({ status: 'ok', client_transaction_id: 'C9', state }) })
    expect(r.body.data).toMatchObject({ outcome: 'waiting', message: expect.stringMatching(/offline/) })
    const [line] = (await getLedger(cls.id)).lines
    expect(Date.parse(line.holdExpiresAt!) - NOW.getTime()).toBe(24 * 3_600_000)
    expect((await getReaderSale(bookingId))!.offline).toMatchObject({ clientTransactionId: 'C9' })
  })

  it('the return needs no staff sign-in (the signed state lets it in)', async () => {
    const { bookingId, state } = await begun()
    const order = orderFor(bookingId, 3270)
    mocks.orders.set(order.id, order)
    mocks.staff = null
    expect((await post({ action: 'return', data: paidReturn(state, order.id) })).body.data.outcome).toBe('paid')
  })
})

describe('no return: Check again, Let the seat go, To decide', () => {
  async function begun() {
    const cls = await newClass()
    const r = await start(cls.id)
    return { cls, bookingId: r.body.data.bookingId as string }
  }

  it('the roster shows it waiting; Check again finds the payment by its note and seats it', async () => {
    const { cls, bookingId } = await begun()
    expect((await post({ action: 'check', bookingId })).body.data).toMatchObject({ outcome: 'not-found' })
    mocks.search = [orderFor('bkg_other_sale', 3270, { id: 'ORD_other' }), orderFor(bookingId, 3270)]
    const r = await post({ action: 'check', bookingId })
    expect(r.body.data.outcome).toBe('paid')
    expect((await getLedger(cls.id)).lines[0]).toMatchObject({ state: 'confirmed', square: { orderId: `ORD_${bookingId.slice(-8)}` } })
    expect(await getReaderSale(bookingId)).toMatchObject({ paid: { how: 'check' } })
  })

  it('Let the seat go is refused when Square shows it paid (and the seat is theirs)', async () => {
    const { cls, bookingId } = await begun()
    mocks.search = [orderFor(bookingId, 3270)]
    const r = await post({ action: 'let-go', bookingId })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ code: 'paid', error: expect.stringMatching(/Square shows this paid/) })
    expect((await getLedger(cls.id)).lines[0].state).toBe('confirmed')
  })

  it('Let the seat go frees it when Square shows nothing; refused while Square can’t be reached', async () => {
    const { cls, bookingId } = await begun()
    mocks.squareDown = true
    expect((await post({ action: 'let-go', bookingId })).status).toBe(503)
    expect((await getLedger(cls.id)).lines[0].state).toBe('held')
    mocks.squareDown = false
    const r = await post({ action: 'let-go', bookingId })
    expect(r.body.data).toMatchObject({ outcome: 'let-go', message: 'The seat was let go. Nothing was charged.' })
    expect((await getLedger(cls.id)).lines[0].state).toBe('released')
    expect(audits('seat.reader-let-go')).toHaveLength(1)
  })

  it('a payment that turns up after the seat was let go is still seated (the money is taken), and owners hear of it', async () => {
    const { cls, bookingId } = await begun()
    await post({ action: 'let-go', bookingId })
    const order = orderFor(bookingId, 3270)
    expect(await handleOrder(order, NOW)).toMatchObject({ skipped: 'not-ours' })
    expect((await getLedger(cls.id)).lines.filter((l) => l.state === 'confirmed')).toHaveLength(1)
    expect(mocks.alert.mock.calls.some(([t]) => /after its seat was let go/.test(t))).toBe(true)
  })

  it('Square’s notice (webhook / nightly run) seats a waiting reader sale, never as a counter sale or unmatched', async () => {
    const { cls, bookingId } = await begun()
    const order = { ...orderFor(bookingId, 3270), line_items: [{ uid: 'L1', name: 'Custom Amount', quantity: '1', total_money: { amount: 3270 } }] }
    const out = await handleOrder(order, NOW)
    expect(out).toMatchObject({ recorded: 0, unmatched: 0, skipped: 'not-ours' })
    const lines = (await getLedger(cls.id)).lines
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ source: 'door-reader', state: 'confirmed' })
    expect(lines.some((l) => l.source === 'pos')).toBe(false)
    expect((await listUnmatchedPos()).some((u) => u.orderId === order.id)).toBe(false)
    // The same notice again changes nothing.
    await handleOrder(order, NOW)
    expect((await getLedger(cls.id)).lines).toHaveLength(1)
    expect(audits('seat.sold-on-reader')).toHaveLength(1)
  })

  it('To decide lists it after 15 minutes; Ask Square seats it when Square shows it', async () => {
    const { cls, bookingId } = await begun()
    expect((await listToDecide(NOW)).items.some((i) => i.kind === 'reader-waiting' && i.detail.bookingId === bookingId)).toBe(false)
    const later = new Date(NOW.getTime() + READER_DECIDE_AFTER_MS)
    vi.setSystemTime(later)
    const item = (await listToDecide(later)).items.find((i) => i.kind === 'reader-waiting' && i.detail.bookingId === bookingId)!
    expect(item).toMatchObject({ title: 'Reader payment didn’t come back', hint: 'Ask Square, or let the seat go', detail: { bookingId, cents: 3270 } })
    expect(item.head).toMatch(/\$32\.70 was sent to the Square app at 3:00 PM and the payment never came back here/)
    await expect(decide(item.id, 'check', {}, by, later)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/doesn’t show this payment/) })
    mocks.search = [orderFor(bookingId, 3270)]
    const done = await decide(item.id, 'check', {}, by, later)
    expect(done.decided.what).toBe('Square showed it paid. They have their seat')
    expect((await getLedger(cls.id)).lines[0].state).toBe('confirmed')
  })

  it('To decide › Let the seat go frees it (after asking Square)', async () => {
    const { cls, bookingId } = await begun()
    const later = new Date(NOW.getTime() + 2 * 3_600_000)
    vi.setSystemTime(later)
    const item = (await listToDecide(later)).items.find((i) => i.kind === 'reader-waiting' && i.detail.bookingId === bookingId)!
    const done = await decide(item.id, 'let-go', {}, by, later)
    expect(done.decided.what).toMatch(/let go/)
    expect((await getReaderSale(bookingId))!.state).toBe('let-go')
    expect((await listToDecide(later)).items.find((i) => i.id === item.id)?.done).toBeTruthy()
    expect(cls.id).toBeTruthy()
  })

  it('a refused order puts it in To decide at once, named as not matching', async () => {
    const cls = await newClass()
    const r = await start(cls.id)
    const { bookingId, posUrl } = r.body.data
    const order = orderFor(bookingId, 999)
    mocks.orders.set(order.id, order)
    await post({ action: 'return', data: paidReturn(dataOf(posUrl).state, order.id) })
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'reader-waiting' && i.detail.bookingId === bookingId)!
    expect(item.title).toBe('Reader payment didn’t match')
  })
})
