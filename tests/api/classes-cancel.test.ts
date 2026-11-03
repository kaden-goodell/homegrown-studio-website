// @vitest-environment node
// D2: customers cancel their own class seats from the "Can't make it?" link.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  refundPayment: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
  alert: vi.fn(),
  runWaitlist: vi.fn(),
  keys: new Map<string, any>(),
  /** F4: a crash in the refund step, before its request is saved or after */
  boom: null as null | 'before' | 'after',
}))
vi.mock('@lib/booking-core/refund-runner', async (orig) => {
  const real = await orig<typeof import('@lib/booking-core/refund-runner')>()
  return {
    ...real,
    runRefund: async (...args: Parameters<typeof real.runRefund>) => {
      if (m.boom === 'before') throw new Error('blob blip')
      if (m.boom === 'after') {
        try { return await real.runRefund(...args) } catch { throw new Error('crash after the request was saved') }
      }
      return real.runRefund(...args)
    },
  }
})
// Money I2: Ask Square reads Square's own list of refunds on the payment (PENDING counts as still going through).
vi.mock('@config/providers', () => ({
  providers: {
    payment: {
      refundPayment: m.refundPayment,
      readPayment: async (id: string) => ({
        id, orderId: null, status: 'COMPLETED', amountCents: 6540, refundedCents: 0, createdAt: null,
        refunds: [...m.keys.values()].filter((r) => r.paymentId === id).map((r) => ({ id: r.id, paymentId: id, amountCents: r.amountCents, status: r.status, createdAt: null })),
      }),
    },
  },
}))
vi.mock('@lib/audit', () => ({ recordAudit: m.audit }))
vi.mock('@lib/email', () => ({ sendRefundEmail: m.email }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: m.alert }))
vi.mock('@lib/classes/waitlist-runner', () => ({ runWaitlist: m.runWaitlist, decideUnclear: vi.fn(), UnclearError: class extends Error {} }))
// F3: Ask Square reads the payment (read only): what Square refunded on it is every refund it made (by key).
vi.mock('@lib/classes/square-api', async (orig) => ({
  ...(await orig<typeof import('@lib/classes/square-api')>()),
  squareFetch: vi.fn(async (path: string) => {
    const p = /^\/payments\/([^/]+)$/.exec(path)
    if (!p) throw new Error(`unexpected Square call ${path}`)
    const id = decodeURIComponent(p[1])
    const back = [...m.keys.values()].filter((r) => r.paymentId === id && r.status === 'COMPLETED').reduce((s, r) => s + r.amountCents, 0)
    return { payment: { id, status: 'COMPLETED', total_money: { amount: 6540 }, refunded_money: { amount: back } } }
  }),
}))

import * as route from '@pages/api/classes/cancel.json'
import { createClass } from '@lib/classes/class-store'
import { getLedger, type LedgerLine } from '@lib/classes/seat-ledger'
import { makeKvStore } from '@lib/blob-store'
import { cancelToken, readCancelToken } from '@lib/classes/self-cancel-token'
import { getCancelRecord } from '@lib/classes/self-cancel'
import { decide, listToDecide } from '@lib/classes/to-decide'
import * as toDecideRoute from '@pages/api/admin/to-decide.json'
import { adminCookie } from '@lib/admin-auth'
import { CANCEL_WHY } from '@lib/classes/self-cancel-rules'
import type { ClassContent } from '@lib/classes/types'

const ledgerKv = makeKvStore('seat-ledger', 'seat-ledger')

function content(): ClassContent {
  return {
    name: 'Candles', description: 'Make a thing.', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'person', label: 'Person' }],
    passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
  }
}
let n = 0
let bk = 0
function line(over: Partial<LedgerLine>): LedgerLine {
  return {
    id: `led_c${++n}`, bookingId: 'bkg_c1', sessionIds: ['ses_c1'], ticketTypeId: 'person', passId: 'all', seat: 1,
    priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
    state: 'confirmed', holdExpiresAt: null,
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '(402) 980-2907' },
    square: { orderId: 'o1', paymentId: 'pay_1', lineUid: null, chargedCents: 6540 }, by: null, refunds: [], at: new Date().toISOString(),
    ...over,
  }
}
/** A class `hours` from now with these seats; returns the class id and the booking's token. */
async function setup(lines: (bookingId: string) => LedgerLine[], hours = 7 * 24) {
  const start = new Date(Date.now() + hours * 3_600_000)
  const sessions = [{ id: 'ses_c1', startIso: start.toISOString(), endIso: new Date(start.getTime() + 5400e3).toISOString(), capacity: 12 }]
  const cls = await createClass({ content: content(), sessions, status: 'open', by: { id: 'admin', name: 'Owner' } })
  const bookingId = `bkg_c${++bk}x`
  const ls = lines(bookingId)
  await ledgerKv.set(`ledger-${cls.id}`, JSON.stringify({ classId: cls.id, lines: ls }))
  return { classId: cls.id, bookingId, t: cancelToken(cls.id, bookingId), lines: ls }
}
const two = (bookingId: string) => [line({ bookingId, seat: 1 }), line({ bookingId, seat: 2 })]

async function get(t: string) {
  const res: Response = await route.GET({ url: new URL(`https://x.test/api/classes/cancel.json?t=${encodeURIComponent(t)}`), clientAddress: `198.51.100.${(n % 200) + 1}` } as any)
  return { status: res.status, body: await res.json() }
}
async function post(body: unknown) {
  const request = new Request('https://x.test/api/classes/cancel.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res: Response = await route.POST({ request, clientAddress: `203.0.113.${(++n % 200) + 1}` } as any)
  return { status: res.status, body: await res.json() }
}
const byId = async (classId: string) => Object.fromEntries((await getLedger(classId)).lines.map((l) => [l.id, l]))
const attempt = () => `att_${Math.random().toString(36).slice(2, 12)}`

beforeEach(() => {
  m.keys.clear()
  // Square hands back the same refund for the same key (never two).
  m.refundPayment.mockReset().mockImplementation(async (i: any) => {
    if (!m.keys.has(i.idempotencyKey)) m.keys.set(i.idempotencyKey, { id: `rf_${m.keys.size + 1}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' })
    return m.keys.get(i.idempotencyKey)
  })
  m.audit.mockReset().mockResolvedValue(undefined)
  m.email.mockReset().mockResolvedValue({ sent: true })
  m.alert.mockReset().mockResolvedValue({ attempted: 1, sent: 1 })
  m.runWaitlist.mockReset().mockResolvedValue({})
  m.boom = null
})

describe('the link', () => {
  it('is signed: a changed class, booking or signature reads as missing, the same 404 as a booking that isn’t there', async () => {
    const { classId, bookingId, t } = await setup(two)
    expect(readCancelToken(t)).toEqual({ classId, bookingId })
    const [c, b, sig] = t.split('.')
    for (const bad of [`${c}.bkg_other.${sig}`, `${c}.${b}.${sig.slice(0, -1)}x`, `${c}.${b}`, 'junk', `${t}.x`]) {
      const r = await get(bad)
      expect(r.status, bad).toBe(404)
      expect(r.body.error).toMatch(/^We couldn’t find that booking\./)
    }
    const missing = await get(cancelToken(classId, 'bkg_nothere'))
    expect(missing.status).toBe(404)
  })
})

describe('48+ hours ahead: cancel and refund', () => {
  it('shows each seat with what it gives back; cancelling one refunds exactly that seat, frees it, runs the waitlist, emails, texts the owners, audits', async () => {
    const { classId, bookingId, t, lines } = await setup(two)
    const v = await get(t)
    expect(v.status).toBe(200)
    expect(v.body.data).toMatchObject({ className: 'Candles', state: 'open', mode: 'self', policyHours: 48, wholeOnly: false })
    expect(v.body.data.seats.map((s: any) => [s.seat, s.cents, s.canPick])).toEqual([[1, 3270, true], [2, 3270, true]])

    const r = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(r.status).toBe(200)
    expect(r.body.data).toMatchObject({ result: 'cancelled', cents: 3270 })
    expect(m.refundPayment).toHaveBeenCalledTimes(1)
    expect(m.refundPayment.mock.calls[0][0]).toMatchObject({ paymentId: 'pay_1', amountCents: 3270 })
    const after = await byId(classId)
    expect(after[lines[0].id]).toMatchObject({ state: 'refunded' })
    expect(after[lines[0].id].refunds[0]).toMatchObject({ cents: 3270, freedSeat: true, by: { id: 'customer-online', name: 'Ada Lovelace (online)' } })
    expect(after[lines[1].id].state).toBe('confirmed')
    expect(m.runWaitlist).toHaveBeenCalledWith(classId, { reason: 'seat-freed' })
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.com', cents: 3270, keptSeat: false }))
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/^Ada Lovelace cancelled 1 seat of Candles \(.+\) online and got \$32\.70 back\. The seat is back on sale\.$/)
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-self-cancel', details: expect.objectContaining({ bookingId, cents: 3270 }) }))
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-refund' }))
    // The page now: seat 1 cancelled, seat 2 still pickable.
    expect(r.body.data.view.seats.map((s: any) => [s.state, s.canPick])).toEqual([['cancelled', false], ['booked', true]])
    expect(r.body.data.view.refundedCents).toBe(3270)
    // Catherine sees it on the class sheet, with the booking's own link.
    const { classBookings } = await import('@lib/classes/admin-actions')
    const row = (await classBookings(classId)).bookings.find((b) => b.bookingId === bookingId)!
    expect(row.cancelPath).toBe(`/classes/cancel/${t}`)
    expect(row.cancelLine).toBe('Cancelled online by the customer · 1 seat, $32.70 refunded')
  })

  it('a double tap (the same press twice) and a reused link never refund twice', async () => {
    const { t, lines } = await setup(two)
    const a = attempt()
    const [x, y] = await Promise.all([post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a }), post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a })])
    expect([x.status, y.status]).toEqual([200, 200])
    expect(new Set(m.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)).size).toBe(1)
    const again = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a })
    expect(again.body.data).toMatchObject({ result: 'cancelled', cents: 3270 })
    // A new press for the same seat (another tab, later): it isn't booked any more.
    const later = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(later.status).toBe(409)
    expect(later.body.code).toBe('changed')
    expect(new Set(m.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)).size).toBe(1)
    expect(m.alert).toHaveBeenCalledTimes(1)
  })

  it('two tabs cancelling the same seat at once: one refund, written once', async () => {
    const { classId, t, lines } = await setup(two)
    const [x, y] = await Promise.all([
      post({ t, action: 'cancel', lineIds: [lines[1].id], attempt: attempt() }),
      post({ t, action: 'cancel', lineIds: [lines[1].id], attempt: attempt() }),
    ])
    expect([x, y].some((r) => r.status === 200 && r.body.data.result === 'cancelled')).toBe(true)
    for (const r of [x, y]) expect([200, 409]).toContain(r.status)
    expect(new Set(m.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)).size).toBe(1)
    expect((await byId(classId))[lines[1].id].refunds).toHaveLength(1)
    // F2: one refund is one try: one owner text, one audit, and the totals count it once.
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.audit.mock.calls.filter(([e]: any[]) => e.action === 'class-self-cancel')).toHaveLength(1)
    const loser = [x, y].find((r) => r.status === 409)
    if (loser) expect(loser.body.view).toBeTruthy()
    expect((await get(t)).body.data.refundedCents).toBe(3270)
    const rec = (await getCancelRecord((await getLedger(classId)).lines[1].bookingId))!
    expect(rec.tries.filter((x) => x.state === 'done')).toHaveLength(1)
    const { cancelWords } = await import('@lib/classes/self-cancel')
    expect(cancelWords(rec, (await getLedger(classId)).lines, new Date())).toBe('Cancelled online by the customer · 1 seat, $32.70 refunded')
  })

  it('F2: a second tab pressing after the first finished is refused with the booking as it stands (nothing sent)', async () => {
    const { t, lines } = await setup(two)
    await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    const again = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(again.status).toBe(409)
    expect(again.body.view.seats[0].state).toBe('cancelled')
    expect(m.refundPayment).toHaveBeenCalledTimes(1)
    expect(m.alert).toHaveBeenCalledTimes(1)
  })

  it('a booking for several dates is cancelled whole; some of its seats are refused', async () => {
    const { t, lines } = await setup((bookingId) => [line({ bookingId, seat: 1, sessionIds: ['ses_c1', 'ses_c2'] }), line({ bookingId, seat: 2, sessionIds: ['ses_c1', 'ses_c2'] })])
    const v = await get(t)
    expect(v.body.data.wholeOnly).toBe(true)
    const part = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(part.status).toBe(409)
    expect(part.body.error).toBe('This booking covers more than one date, so all of its seats are cancelled together.')
    expect(m.refundPayment).not.toHaveBeenCalled()
    const whole = await post({ t, action: 'cancel', lineIds: lines.map((l) => l.id), attempt: attempt() })
    expect(whole.body.data).toMatchObject({ result: 'cancelled', cents: 6540 })
  })

  it('prices never come from the page: the amount is the booking’s, whatever is sent', async () => {
    const { t, lines } = await setup(two)
    await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt(), cents: 99999 })
    expect(m.refundPayment.mock.calls[0][0].amountCents).toBe(3270)
  })
})

describe('when Square doesn’t answer, or says no', () => {
  it('no answer: the seats stay held as cancelling, owners texted once, To decide › Ask Square sends the same request and finishes it', async () => {
    const { classId, bookingId, t, lines } = await setup(two)
    // Square made the refund, but its answer never reached us.
    const lost = async (i: any) => {
      if (!m.keys.has(i.idempotencyKey)) m.keys.set(i.idempotencyKey, { id: `rf_${m.keys.size + 1}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' })
      throw new Error('timeout')
    }
    m.refundPayment.mockImplementationOnce(lost)
    const a = attempt()
    const r = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a })
    expect(r.status).toBe(200)
    expect(r.body.data.result).toBe('cancelling')
    expect(r.body.data.view.state).toBe('cancelling')
    expect(r.body.data.view.seats[0]).toMatchObject({ state: 'cancelling', canPick: false })
    expect((await byId(classId))[lines[0].id].state).toBe('confirmed') // not freed until the refund is known
    expect(m.runWaitlist).not.toHaveBeenCalled()
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/Square didn’t answer the \$32\.70 refund\. Their seats stay held\. Open \/admin › To decide and tap Ask Square\./)
    const firstKey = m.refundPayment.mock.calls[0][0].idempotencyKey
    // The same press again (a retry from the page) keeps it unclear and doesn't text again.
    m.refundPayment.mockImplementationOnce(lost)
    await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a })
    expect(m.alert).toHaveBeenCalledTimes(1)

    const { items } = await listToDecide()
    const item = items.find((i) => i.kind === 'cancel-unclear' && i.detail.bookingId === bookingId)!
    expect(item.title).toBe('Customer’s cancel, refund unclear')
    expect(item.head).toMatch(/^Ada Lovelace cancelled 1 seat of Candles .* online, and Square didn’t answer the \$32\.70 refund\. Their seats are held until we know\.$/)
    // "Got it" can't hide an unclear refund.
    await expect(decide(item.id, 'seen', {}, { id: 'cat', name: 'Catherine' })).rejects.toThrow(/Ask Square first/)
    const done = await decide(item.id, 'ask', {}, { id: 'cat', name: 'Catherine' })
    expect(done.decided.what).toBe('Square showed the refund. They’re cancelled and got $32.70 back')
    expect(m.refundPayment.mock.calls.at(-1)![0].idempotencyKey).toBe(firstKey)
    expect((await byId(classId))[lines[0].id].refunds).toHaveLength(1)
    expect(m.runWaitlist).toHaveBeenCalledTimes(1)
    expect((await get(t)).body.data.seats[0].state).toBe('cancelled')
  })

  it('merge: /admin’s to-decide route sends Ask Square on a customer’s cancel to the decision (same refund again), not the read-only Ask Square', async () => {
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
    const { classId, bookingId, t, lines } = await setup(two)
    const lost = async (i: any) => {
      if (!m.keys.has(i.idempotencyKey)) m.keys.set(i.idempotencyKey, { id: `rf_${m.keys.size + 1}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' })
      throw new Error('timeout')
    }
    m.refundPayment.mockImplementationOnce(lost)
    await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    const { items } = await listToDecide()
    const item = items.find((i) => i.kind === 'cancel-unclear' && i.detail.bookingId === bookingId)!
    const request = new Request('https://x.test/api/admin/to-decide.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: adminCookie().split(';')[0] }, body: JSON.stringify({ id: item.id, action: 'ask' }),
    })
    const res: Response = await (toDecideRoute as any).POST({ request, url: new URL(request.url) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.asked).toBeUndefined()
    expect(body.data.decided.what).toBe('Square showed the refund. They’re cancelled and got $32.70 back')
    expect((await byId(classId))[lines[0].id].refunds).toHaveLength(1)
    vi.unstubAllEnvs()
  })

  it('turned down: nothing refunded, still booked, the page says try again or send a note; To decide offers Try the refund again / Got it', async () => {
    const { classId, bookingId, t, lines } = await setup(two)
    m.refundPayment.mockResolvedValueOnce({ id: 'rf_x', paymentId: 'pay_1', amountCents: 3270, status: 'FAILED' })
    const r = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(r.status).toBe(502)
    expect(r.body).toMatchObject({ code: 'square', error: 'The refund didn’t go through just now, so nothing changed and your seats are still booked. Try again in a few minutes, or send us a note.' })
    expect((await byId(classId))[lines[0].id].state).toBe('confirmed')
    const { items } = await listToDecide()
    const item = items.find((i) => i.kind === 'cancel-unclear' && i.detail.bookingId === bookingId)!
    expect(item.detail.state).toBe('turned-down')
    const seen = await decide(item.id, 'seen', {}, { id: 'cat', name: 'Catherine' })
    expect(seen.decided.what).toBe('Seen. They’re still booked')
  })
})

describe('F3: a refund Square never answers never leaves Catherine stuck', () => {
  const cat = { id: 'cat', name: 'Catherine' }
  async function unanswered() {
    const env = await setup(two)
    m.refundPayment.mockRejectedValueOnce(new Error('timeout')) // Square never got it: no refund on the payment
    const a = attempt()
    const r = await post({ t: env.t, action: 'cancel', lineIds: [env.lines[0].id], attempt: a })
    expect(r.body.data.result).toBe('cancelling')
    const item = (await listToDecide()).items.find((i) => i.kind === 'cancel-unclear' && i.detail.bookingId === env.bookingId)!
    return { ...env, a, item }
  }

  it('Ask Square reads the payment first: no refund shown → said so (nothing sent); then "try again" sends the very same request', async () => {
    const { classId, lines, item } = await unanswered()
    const firstKey = m.refundPayment.mock.calls[0][0].idempotencyKey
    await expect(decide(item.id, 'retry', {}, cat)).rejects.toThrow(/Ask Square first/)
    await expect(decide(item.id, 'ask', {}, cat)).rejects.toMatchObject({ status: 409, extra: { noRefund: true } })
    expect(m.refundPayment).toHaveBeenCalledTimes(1) // asking sent nothing
    const again = (await listToDecide()).items.find((i) => i.id === item.id)!
    expect(again.detail).toMatchObject({ noRefundSeen: true })
    expect(again.hint).toBe('Try again, or release the seats')
    const done = await decide(item.id, 'retry', {}, cat)
    expect(done.decided.what).toBe('The refund went through. They’re cancelled and got $32.70 back')
    expect(m.refundPayment).toHaveBeenCalledTimes(2)
    expect(m.refundPayment.mock.calls[1][0].idempotencyKey).toBe(firstKey)
    expect((await byId(classId))[lines[0].id].refunds).toHaveLength(1)
  })

  it('money I2: Square shows the refund still PENDING → Ask Square says wait (nothing decided); Keep their booking is refused; once COMPLETED it finishes, once', async () => {
    const { classId, lines, item } = await unanswered()
    const sent = m.refundPayment.mock.calls[0][0]
    m.keys.set('square-made-it', { id: 'rf_pending', paymentId: sent.paymentId, amountCents: sent.amountCents, status: 'PENDING' })
    await expect(decide(item.id, 'ask', {}, cat)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/still going through/) })
    await expect(decide(item.id, 'release', {}, cat)).rejects.toThrow(/Ask Square first|still going through/)
    expect(m.refundPayment).toHaveBeenCalledTimes(1)
    m.keys.get('square-made-it').status = 'COMPLETED'
    m.refundPayment.mockImplementationOnce(async () => m.keys.get('square-made-it'))
    const done = await decide(item.id, 'ask', {}, cat)
    expect(done.decided.what).toMatch(/They’re cancelled and got \$32\.70 back/)
    expect((await byId(classId))[lines[0].id].refunds).toHaveLength(1)
  })

  it('Keep their booking (no refund): only after Square showed none; the request is cleared (audited), the seats stop being held, nothing refunded', async () => {
    const { t, lines, item } = await unanswered()
    await expect(decide(item.id, 'release', {}, cat)).rejects.toThrow(/Ask Square first/)
    await expect(decide(item.id, 'ask', {}, cat)).rejects.toMatchObject({ extra: { noRefund: true } })
    const done = await decide(item.id, 'release', {}, cat)
    expect(done.decided.what).toBe('Square showed no refund. Seats released; they’re still booked and nothing was refunded')
    expect(m.refundPayment).toHaveBeenCalledTimes(1)
    expect(m.audit.mock.calls.some(([e]: any[]) => e.action === 'class-self-cancel-released')).toBe(true)
    expect(m.audit.mock.calls.some(([e]: any[]) => e.action === 'class-refund-checked' || /checked/.test(e.action))).toBe(true)
    const v = (await get(t)).body.data
    expect(v.seats[0]).toMatchObject({ state: 'booked', canPick: true })
    expect((await listToDecide()).items.filter((i) => i.kind === 'cancel-unclear' && !i.done)).toHaveLength(0)
    expect(lines).toHaveLength(2)
  })

  it('a day on, the nightly run raises no second, generic "Refund with no answer" for a customer’s cancel (one item, not two)', async () => {
    await unanswered()
    const { flagUnconfirmedRequests } = await import('@lib/classes/square-events')
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(Date.now() + 25 * 3_600_000))
      expect(await flagUnconfirmedRequests(new Date())).toBe(0)
      const items = (await listToDecide()).items.filter((i) => !i.done)
      expect(items.some((i) => i.kind === 'refund-unconfirmed')).toBe(false)
      expect(items.some((i) => i.kind === 'cancel-unclear')).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('a request cleared as turned down (by anyone) never leaves the seats held: the try reads turned-down', async () => {
    const { classId, bookingId, t, a } = await unanswered()
    const { listRefundRequests } = await import('@lib/classes/refund-requests')
    const { clearRequest } = await import('@lib/booking-core/refund-runner')
    const { classRefundBook } = await import('@lib/classes/refunds')
    const r = (await listRefundRequests(classId, bookingId))[0]
    await clearRequest(await classRefundBook(classId, bookingId), r.id, 'did-not-go-through', 'checked', { by: cat, role: 'owner' })
    expect((await get(t)).body.data.seats[0].state).toBe('booked')
    const item = (await listToDecide()).items.find((i) => i.kind === 'cancel-unclear' && i.detail.attempt === a && !i.done)!
    expect(item.detail.state).toBe('turned-down')
  })
})

describe('F4: a crash in the middle of a press', () => {
  it('before anything was saved: the press stops, nothing stays held, the page says nothing changed; a new press works', async () => {
    const { t, lines } = await setup(two)
    m.boom = 'before'
    const r = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/Nothing changed/)
    expect((await get(t)).body.data.seats[0]).toMatchObject({ state: 'booked', canPick: true })
    expect(m.alert).not.toHaveBeenCalled()
    m.boom = null
    expect((await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })).body.data.result).toBe('cancelled')
  })

  it('after the refund request was saved: treated as no answer — seats held, owners texted and To decide shows it at once', async () => {
    const { bookingId, t, lines } = await setup(two)
    m.boom = 'after'
    m.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    const r = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(r.status).toBe(200)
    expect(r.body.data.result).toBe('cancelling')
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/Open \/admin › To decide and tap Ask Square/)
    expect((await listToDecide()).items.some((i) => i.kind === 'cancel-unclear' && i.detail.bookingId === bookingId)).toBe(true)
  })
})

describe('F5, F7, F8: notes', () => {
  it('F5: every seat already has a goodwill refund but is still booked → the page explains and offers a note (never a dead end)', async () => {
    const { t } = await setup((b) => [
      line({ bookingId: b, seat: 1, state: 'refunded', refunds: [{ id: 'rfe_1', cents: 500, at: new Date().toISOString(), by: { id: 'cat', name: 'Catherine' }, reason: 'goodwill', freedSeat: false } as any] }),
    ])
    const v = (await get(t)).body.data
    expect(v).toMatchObject({ mode: 'request', why: CANCEL_WHY.partly })
    expect(v.state).not.toBe('over')
  })

  it('F7: a long note is cut in the owner text so “Open /admin › To decide” always fits; To decide keeps it whole', async () => {
    const { bookingId, t } = await setup(two, 30)
    const note = 'x'.repeat(400)
    await post({ t, action: 'request', note })
    const text = m.alert.mock.calls[0][0] as string
    expect(text).toMatch(/Open \/admin › To decide to refund, free the seat or keep their booking\.$/)
    expect(text.length).toBeLessThanOrEqual(300)
    const item = (await listToDecide()).items.find((i) => i.kind === 'cancel-request' && i.detail.bookingId === bookingId)!
    expect(item.detail.note).toBe(note)
    expect(item.detail.reason).toBe('inside')
  })

  it('F8: at most 3 owner texts a day per booking link; later notes still save and show', async () => {
    const { bookingId, t } = await setup(two, 30)
    for (const n of ['one', 'two', 'three', 'four']) await post({ t, action: 'request', note: n })
    expect(m.alert).toHaveBeenCalledTimes(3)
    expect((await getCancelRecord(bookingId))!.asks.map((a) => a.note)).toEqual(['one', 'two', 'three', 'four'])
    const item = (await listToDecide()).items.find((i) => i.kind === 'cancel-request' && i.detail.bookingId === bookingId)!
    expect(item.detail.note).toBe('four')
  })
})

describe('inside 48 hours and the other request cases: a note, Catherine decides', () => {
  it('inside 48 hours: cancelling is refused (nothing sent), the page shows the policy, a note reaches the owners and To decide', async () => {
    const { classId, bookingId, t, lines } = await setup(two, 30)
    const v = await get(t)
    expect(v.body.data).toMatchObject({ mode: 'request', why: CANCEL_WHY.inside(48) })
    const refused = await post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: attempt() })
    expect(refused.status).toBe(409)
    expect(refused.body.code).toBe('request-only')
    expect(m.refundPayment).not.toHaveBeenCalled()

    const note = await post({ t, action: 'request', note: 'My kid is sick, can we get credit?' })
    expect(note.status).toBe(200)
    expect(note.body.data.view).toMatchObject({ state: 'requested', request: { note: 'My kid is sick, can we get credit?' } })
    // a double tap is one note, one text
    await post({ t, action: 'request', note: 'My kid is sick, can we get credit?' })
    expect(m.alert).toHaveBeenCalledTimes(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/^Ada Lovelace asked to cancel 2 seats of Candles \(.+\), inside 48 hours: “My kid is sick, can we get credit\?”\. Open \/admin › To decide/)
    expect((await getCancelRecord(bookingId))!.asks).toHaveLength(1)

    const { items } = await listToDecide()
    const item = items.find((i) => i.kind === 'cancel-request' && i.detail.bookingId === bookingId)!
    expect(item).toMatchObject({ title: 'Customer asked to cancel', classId })
    expect(item.detail).toMatchObject({ canRefund: true, refundCents: 6540, seats: 2, inside: true })
    const done = await decide(item.id, 'refund', {}, { id: 'cat', name: 'Catherine' })
    expect(done.decided.what).toBe('Refunded $65.40 and freed 2 seats')
    expect(m.refundPayment.mock.calls[0][0].amountCents).toBe(6540)
    expect(Object.values(await byId(classId)).every((l) => l.state === 'refunded')).toBe(true)
    // decided: it doesn't show again
    expect((await listToDecide()).items.find((i) => i.id === item.id)?.done).toBe('Refunded $65.40 and freed 2 seats')
  })

  it('Free the seat, no refund (with Undo) and Keep their booking', async () => {
    const one = await setup(two, 30)
    await post({ t: one.t, action: 'request', note: 'Can’t come' })
    const other = await setup(two, 30)
    await post({ t: other.t, action: 'request', note: '' })
    const { items } = await listToDecide()
    const i1 = items.find((i) => i.kind === 'cancel-request' && i.detail.bookingId === one.bookingId)!
    const freed = await decide(i1.id, 'free', {}, { id: 'cat', name: 'Catherine' })
    expect(freed.decided.what).toBe('Freed 2 seats. No refund')
    expect(freed.decided.undo?.entries).toHaveLength(2)
    expect(m.refundPayment).not.toHaveBeenCalled()
    const i2 = items.find((i) => i.kind === 'cancel-request' && i.detail.bookingId === other.bookingId)!
    const kept = await decide(i2.id, 'keep', {}, { id: 'cat', name: 'Catherine' })
    expect(kept.decided.what).toBe('Kept their booking')
    expect(Object.values(await byId(other.classId)).every((l) => l.state === 'confirmed')).toBe(true)
  })

  it('a gift seat goes to a note (no refund offered); a seat paid at the counter too', async () => {
    const comp = await setup((bookingId) => [line({ bookingId, source: 'comp', square: { orderId: null, paymentId: null, lineUid: null } })])
    expect((await get(comp.t)).body.data).toMatchObject({ mode: 'request', why: CANCEL_WHY.comp })
    await post({ t: comp.t, action: 'request', note: 'Thanks but we can’t come' })
    const item = (await listToDecide()).items.find((i) => i.kind === 'cancel-request' && i.detail.bookingId === comp.bookingId)!
    expect(item.detail.canRefund).toBe(false)
    const counter = await setup((bookingId) => [line({ bookingId, source: 'door-counter', square: { orderId: null, paymentId: null, lineUid: null } })])
    expect((await get(counter.t)).body.data).toMatchObject({ mode: 'request', why: CANCEL_WHY.studio })
  })

  it('a note over 500 characters is refused in words', async () => {
    const { t } = await setup(two, 30)
    const r = await post({ t, action: 'request', note: 'x'.repeat(501) })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Keep the note under 500 characters.')
  })
})

describe('a free ($0) booking', () => {
  it('cancels with nothing refunded, any time before it starts; a double tap is fine', async () => {
    const { classId, t, lines } = await setup((bookingId) => [line({ bookingId, priceCents: 0, taxCents: 0, square: { orderId: null, paymentId: null, lineUid: null, chargedCents: 0 } })], 3)
    expect((await get(t)).body.data.mode).toBe('free')
    const a = attempt()
    const [x, y] = await Promise.all([post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a }), post({ t, action: 'cancel', lineIds: [lines[0].id], attempt: a })])
    expect([x.body.data?.result, y.body.data?.result]).toEqual(['cancelled', 'cancelled'])
    expect(x.body.data.cents).toBe(0)
    expect(m.refundPayment).not.toHaveBeenCalled()
    expect((await byId(classId))[lines[0].id].refunds).toHaveLength(1)
    expect(m.alert.mock.calls[0][0]).toMatch(/It was a free booking, so nothing was refunded\. The seat is back on sale\.$/)
    expect((await get(t)).body.data.state).toBe('cancelled')
  })
})
