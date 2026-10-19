// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  refundPayment: vi.fn(),
  audit: vi.fn(),
  email: vi.fn(),
  staff: null as null | { id: string; name: string; role: 'owner' | 'crew' },
}))
vi.mock('@config/providers', () => ({ providers: { payment: { refundPayment: mocks.refundPayment } } }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
// Lets a test make the ledger save fail after Square took the refund.
const ledgerFail = vi.hoisted(() => ({ n: 0, onRead: null as null | (() => Promise<void>) }))
vi.mock('@lib/classes/seat-ledger', async (orig) => {
  const real = await orig<typeof import('@lib/classes/seat-ledger')>()
  return {
    ...real,
    recordRefund: async (...a: Parameters<typeof real.recordRefund>) => {
      if (ledgerFail.n > 0) { ledgerFail.n--; throw new Error('blob down') }
      return real.recordRefund(...a)
    },
    recordRequestRefund: async (...a: Parameters<typeof real.recordRequestRefund>) => {
      if (ledgerFail.n > 0) { ledgerFail.n--; throw new Error('blob down') }
      return real.recordRequestRefund(...a)
    },
    // Lets a test run a second request in the gap between planning from the ledger and saving the new request.
    getLedger: async (...a: Parameters<typeof real.getLedger>) => {
      const read = await real.getLedger(...a)
      const run = ledgerFail.onRead
      if (run) { ledgerFail.onRead = null; await run() }
      return read
    },
  }
})
// Lets a test make marking a request done fail after the money was saved.
const requestFail = vi.hoisted(() => ({ done: 0 }))
vi.mock('@lib/classes/refund-requests', async (orig) => {
  const real = await orig<typeof import('@lib/classes/refund-requests')>()
  return {
    ...real,
    markRequestDone: async (...a: Parameters<typeof real.markRequestDone>) => {
      if (requestFail.done > 0) { requestFail.done--; throw new Error('blob down') }
      return real.markRequestDone(...a)
    },
  }
})
vi.mock('@lib/email', () => ({ sendRefundEmail: mocks.email }))
vi.mock('@lib/staff-auth', () => ({
  staffAuthorized: () => mocks.staff,
  byOf: (m: any) => ({ id: m.id, name: m.name }),
}))

import * as adminRoute from '@pages/api/admin/classes/refund.json'
import * as staffRoute from '@pages/api/staff/class-refund.json'
import { adminCookie } from '@lib/admin-auth'
import { createClass } from '@lib/classes/class-store'
import { getLedger, type LedgerLine } from '@lib/classes/seat-ledger'
import { refundKey, refundKeyRaw, SAVED_SPLIT_NO_LONGER_FITS, SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE } from '@lib/classes/refunds'
import { listRefundRequests } from '@lib/classes/refund-requests'
import { makeKvStore } from '@lib/blob-store'
import { handleRefund } from '@lib/classes/square-events'
import type { ClassContent } from '@lib/classes/types'

const ledgerKv = makeKvStore('seat-ledger', 'seat-ledger')
const requestsKv = makeKvStore('refund-requests', 'refund-requests')
const cookie = () => adminCookie().split(';')[0]
async function post(route: any, body: unknown, signedIn = true) {
  const request = new Request('https://x.test/api/refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signedIn ? { cookie: cookie() } : {}) },
    body: JSON.stringify(body),
  })
  const res: Response = await route.POST({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const admin = (body: unknown, signedIn = true) => post(adminRoute, body, signedIn)
const staff = (body: unknown) => post(staffRoute, body, false)

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
function line(over: Partial<LedgerLine>): LedgerLine {
  return {
    id: `led_r${++n}`, bookingId: 'bkg_r1', sessionIds: ['ses_r1'], ticketTypeId: 'person', passId: 'all', seat: 1,
    priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0, answers: {}, source: 'online',
    state: 'confirmed', holdExpiresAt: null,
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '4029802907' },
    square: { orderId: 'o1', paymentId: 'pay_1', lineUid: null }, by: null, refunds: [], at: new Date().toISOString(),
    ...over,
  }
}
async function setup(lines: LedgerLine[]) {
  const start = new Date(Date.now() + 7 * 864e5)
  const sessions = ['ses_r1', 'ses_r2', 'ses_r3'].map((id, i) => ({
    id, startIso: new Date(start.getTime() + i * 864e5).toISOString(), endIso: new Date(start.getTime() + i * 864e5 + 5400e3).toISOString(), capacity: 12,
  }))
  const cls = await createClass({ content: content(), sessions, status: 'open', by: { id: 'admin', name: 'Owner' } })
  await ledgerKv.set(`ledger-${cls.id}`, JSON.stringify({ classId: cls.id, lines }))
  return cls.id
}
const byId = async (classId: string) => Object.fromEntries((await getLedger(classId)).lines.map((l) => [l.id, l]))

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.refundPayment.mockReset().mockImplementation(async (i: any) => ({ id: `rf_${++n}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' }))
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.email.mockReset().mockResolvedValue({ sent: true })
  mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
  ledgerFail.n = 0
  ledgerFail.onRead = null
  requestFail.done = 0
})
afterEach(() => vi.unstubAllEnvs())

describe('owner refunds', () => {
  it('needs the owner cookie', async () => {
    const r = await admin({}, false)
    expect(r.status).toBe(401)
  })

  it('whole booking: every line, full remaining, one Square call, seats freed, emailed, audited', async () => {
    const a = line({ seat: 1 }), b = line({ seat: 2 })
    const classId = await setup([a, b])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(r.status).toBe(200)
    expect(r.body.data.cents).toBe(6540)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    const call = mocks.refundPayment.mock.calls[0][0]
    expect(call).toMatchObject({ paymentId: 'pay_1', amountCents: 6540 })
    expect(call.idempotencyKey).toBe(refundKey('bkg_r1', [a.id, b.id], 6540, 0))
    expect(call.idempotencyKey.length).toBeLessThanOrEqual(45)
    const after = await byId(classId)
    for (const l of [after[a.id], after[b.id]]) {
      expect(l.state).toBe('refunded')
      expect(l.refunds).toHaveLength(1)
      expect(l.refunds[0]).toMatchObject({ cents: 3270, freedSeat: true, squareRefundId: call && expect.stringMatching(/^rf_/), by: { id: 'admin', name: 'Owner' } })
    }
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.com', givenName: 'Ada', className: 'Candles', cents: 6540 }))
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'class-refund',
      by: { id: 'admin', name: 'Owner', role: 'owner' },
      details: expect.objectContaining({ cents: 6540, freeSeat: true, lines: [a.id, b.id].join(','), kind: 'booking' }),
    }))
  })

  it('one person: one line, full remaining; the seat can be kept', async () => {
    const a = line({ seat: 1 }), b = line({ seat: 2 })
    const classId = await setup([a, b])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id], freeSeat: false, reason: 'Sick' })
    expect(r.status).toBe(200)
    expect(mocks.refundPayment.mock.calls[0][0].amountCents).toBe(3270)
    const after = await byId(classId)
    expect(after[a.id].state).toBe('confirmed')
    expect(after[b.id].refunds[0]).toMatchObject({ cents: 3270, freedSeat: false, reason: 'Sick' })
  })

  it('one session of a pass: seat price ÷ sessions rounded down, plus that share’s tax; add-ons not prorated', async () => {
    const a = line({ sessionIds: ['ses_r1', 'ses_r2', 'ses_r3'], priceCents: 10000, taxCents: 900, addOnCents: 500, addOnTaxCents: 45 })
    const classId = await setup([a])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'session', lineIds: [a.id] })
    expect(r.status).toBe(200)
    // floor(10000 / 3) = 3333; tax on 3333 at 900/10000 = 299.97 → 300
    expect(mocks.refundPayment.mock.calls[0][0].amountCents).toBe(3633)
    expect((await byId(classId))[a.id].refunds[0]).toMatchObject({ cents: 3633, freedSeat: false })
  })

  it('one session refuses a seat that is for one session only', async () => {
    const a = line({})
    const classId = await setup([a])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'session', lineIds: [a.id] })
    expect(r.status).toBe(400)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('custom amount spreads in seat order, never past a line’s remaining, and keeps the seat by default', async () => {
    const a = line({ seat: 2 }), b = line({ seat: 1, refunds: [{ at: 'x', cents: 270, reason: '', by: { id: 'admin', name: 'Owner' }, freedSeat: false, squareRefundId: 'rf_old' }], state: 'refunded' })
    const classId = await setup([a, b])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 4000 })
    expect(r.status).toBe(200)
    const call = mocks.refundPayment.mock.calls[0][0]
    expect(call.amountCents).toBe(4000)
    expect(call.idempotencyKey).toBe(refundKey('bkg_r1', [a.id, b.id], 4000, 1))
    const after = await byId(classId)
    expect(after[b.id].refunds[1]).toMatchObject({ cents: 3000, freedSeat: false })
    expect(after[a.id].refunds[0]).toMatchObject({ cents: 1000, freedSeat: false })
  })

  it('refuses more than is left to refund, before Square', async () => {
    const a = line({})
    const classId = await setup([a])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 3271 })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/\.$/)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('refuses a comp, POS or counter seat with no payment here', async () => {
    const a = line({ source: 'comp', square: { orderId: null, paymentId: null, lineUid: null } })
    const classId = await setup([a])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('Refund this one in Square, where it was paid.')
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('refuses a 21st refund on one payment (Square allows 20)', async () => {
    const refunds = Array.from({ length: 20 }, (_, i) => ({ at: 'x', cents: 1, reason: '', by: { id: 'admin', name: 'Owner' }, freedSeat: false, squareRefundId: `rf_p${i}` }))
    const a = line({ state: 'refunded', refunds })
    const classId = await setup([a])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 100 })
    expect(r.status).toBe(409)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('unknown class or booking is a 404', async () => {
    const classId = await setup([line({})])
    expect((await admin({ classId: 'cls_nope', bookingId: 'bkg_r1', kind: 'booking' })).status).toBe(404)
    expect((await admin({ classId, bookingId: 'bkg_nope', kind: 'booking' })).status).toBe(404)
  })

  it('a Square error leaves the ledger untouched and replies 502', async () => {
    const a = line({})
    const classId = await setup([a])
    const before = await getLedger(classId)
    mocks.refundPayment.mockRejectedValueOnce(new Error('CARD_DECLINED'))
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(r.status).toBe(502)
    expect(r.body.error).toBe(SQUARE_NO_ANSWER)
    expect(r.body.error).not.toMatch(/in Square/)
    expect(await getLedger(classId)).toEqual(before)
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(mocks.email).not.toHaveBeenCalled()
  })

  it('an email failure never fails the refund', async () => {
    const classId = await setup([line({})])
    mocks.email.mockRejectedValueOnce(new Error('smtp down'))
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(r.status).toBe(200)
    expect(r.body.data.emailed).toBe(false)
  })

  it('a second deliberate refund gets a new key; nothing left after a full refund is refused', async () => {
    const a = line({})
    const classId = await setup([a])
    await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 1000 })
    // the same refund again is answered "already refunded" unless the owner asks for it again on purpose
    const same = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 1000 })
    expect(same.body.data.already).toMatchObject({ by: { id: 'admin', name: 'Owner' } })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 1000, again: true })
    const [k1, k2] = mocks.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)
    expect(k1).not.toBe(k2)
    expect(k2).toBe(refundKey('bkg_r1', [a.id], 1000, 1))
    await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(mocks.refundPayment.mock.calls[2][0].amountCents).toBe(1270)
    const done = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(done.status).toBe(200)
    expect(done.body.data.already).toBeTruthy()
    expect(mocks.refundPayment).toHaveBeenCalledTimes(3)
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'booking', again: true })).status).toBe(400)
  })
})

describe('fix round 1', () => {
  it('free-seat defaults: whole booking and one person free it; one session and custom keep it', async () => {
    const a = line({ seat: 1, sessionIds: ['ses_r1', 'ses_r2'] }), b = line({ seat: 2, sessionIds: ['ses_r1', 'ses_r2'] })
    const classId = await setup([a, b])
    await admin({ classId, bookingId: 'bkg_r1', kind: 'session', lineIds: [a.id] })
    await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 100, lineIds: [b.id] })
    let after = await byId(classId)
    expect(after[a.id].refunds.at(-1)!.freedSeat).toBe(false)
    expect(after[b.id].refunds.at(-1)!.freedSeat).toBe(false)
    await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })
    after = await byId(classId)
    expect(after[a.id].refunds.at(-1)!.freedSeat).toBe(true)
    await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    after = await byId(classId)
    expect(after[b.id].refunds.at(-1)!.freedSeat).toBe(true)
  })

  it('free their seat: no money, no Square, audited, and it does not count toward the 20 or the key', async () => {
    const a = line({ seat: 1 }), b = line({ seat: 2 })
    const classId = await setup([a, b])
    const r = await admin({ action: 'free-seat', classId, bookingId: 'bkg_r1', lineIds: [a.id] })
    expect(r.status).toBe(200)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    const after = await byId(classId)
    expect(after[a.id].refunds).toEqual([expect.objectContaining({ cents: 0, freedSeat: true, squareRefundId: null })])
    expect(after[b.id].refunds).toEqual([])
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-free-seat', by: { id: 'admin', name: 'Owner', role: 'owner' } }))
    expect((await admin({ action: 'free-seat', classId, bookingId: 'bkg_r1', lineIds: [a.id] })).status).toBe(409)
    await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })
    expect(mocks.refundPayment.mock.calls[0][0].idempotencyKey).toBe(refundKey('bkg_r1', [a.id], 3270, 0))
  })

  it('seat-only frees do not use up the 20-refund cap', async () => {
    const refunds = Array.from({ length: 20 }, () => ({ at: 'x', cents: 0, reason: '', by: { id: 'admin', name: 'Owner' }, freedSeat: true, squareRefundId: null }))
    const classId = await setup([line({ state: 'refunded', refunds })])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 100 })
    expect(r.status).toBe(200)
  })

  it('crew freeing a seat needs a reason and is audited as them', async () => {
    const a = line({})
    const classId = await setup([a])
    expect((await staff({ action: 'free-seat', classId, bookingId: 'bkg_r1', reason: '' })).status).toBe(400)
    const r = await staff({ action: 'free-seat', classId, bookingId: 'bkg_r1', reason: 'Called to cancel' })
    expect(r.status).toBe(200)
    expect((await byId(classId))[a.id].refunds[0]).toMatchObject({ cents: 0, freedSeat: true, by: { id: 'sam', name: 'Sam' } })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-free-seat', by: { id: 'sam', name: 'Sam', role: 'crew' } }))
  })

  it('a refund Square turns down makes the next try a new key; no answer keeps the same key', async () => {
    const a = line({})
    const classId = await setup([a])
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new Error('timeout'))
    await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    const [t1, t2] = mocks.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)
    expect(t1).toBe(t2)
    mocks.refundPayment.mockResolvedValueOnce({ id: 'rf_x', paymentId: 'pay_1', amountCents: 3270, status: 'FAILED' })
    const failed = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(failed.status).toBe(502)
    expect(failed.body.error).toBe(SQUARE_TURNED_DOWN)
    expect((await byId(classId))[a.id]).toMatchObject({ refunds: [], refundFailures: { [refundKeyRaw('bkg_r1', [a.id], 3270, 0)]: 1 }, state: 'confirmed' })
    const ok = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(ok.status).toBe(200)
    const last = mocks.refundPayment.mock.calls.at(-1)![0].idempotencyKey
    expect(last).not.toBe(t1)
    expect(last).toBe(refundKey('bkg_r1', [a.id], 3270, 0, 1))
  })

  it('while one refund has no answer from Square, a different refund on the booking is refused; the same one retried reuses its key', async () => {
    const a = line({ seat: 1 }), b = line({ seat: 2 })
    const classId = await setup([a, b])
    // X: no answer (it may have gone through at Square), nothing recorded
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })).status).toBe(502)
    const x1 = mocks.refundPayment.mock.calls[0][0].idempotencyKey
    // Y: a different request is refused before Square
    const y = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 500, lineIds: [b.id] })
    expect(y.status).toBe(409)
    expect(y.body.error).toBe(STILL_WAITING_ON_SQUARE)
    expect(STILL_WAITING_ON_SQUARE).toBe('A refund on this booking is still waiting on Square. Check it in Square first.')
    expect(y.body.pending).toMatchObject({ requestId: expect.any(String), cents: 3270 })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    // retry X: must replay X's original key so Square can't refund it twice
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })).status).toBe(200)
    expect(mocks.refundPayment.mock.calls[1][0].idempotencyKey).toBe(x1)
  })

  it('our refund that Square took but did not save here, then recorded from Square\'s webhook: doing it again reuses the key and our record replaces Square\'s', async () => {
    // Square's webhook spread the 32.70 over seat 1 (seat order), as for any plain refund made in Square.
    const fromSquare = { at: new Date().toISOString(), cents: 3270, reason: 'Refunded in Square (amount only)', by: { id: 'square', name: 'Square' }, freedSeat: false, squareRefundId: 'rf_took' }
    const a = line({ seat: 1, state: 'refunded', refunds: [fromSquare] }), b = line({ seat: 2 })
    const classId = await setup([a, b])
    mocks.refundPayment.mockImplementationOnce(async (i: any) => ({ id: 'rf_took', paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }))
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id], reason: 'Sick' })
    expect(r.status).toBe(200)
    // the same key as the first try (Square's own record of it doesn't count as an earlier refund), so Square can't refund twice
    expect(mocks.refundPayment.mock.calls[0][0].idempotencyKey).toBe(refundKey('bkg_r1', [b.id], 3270, 0))
    const after = await byId(classId)
    expect(after[a.id]).toMatchObject({ state: 'confirmed', refunds: [] })
    expect(after[b.id].refunds).toEqual([expect.objectContaining({ cents: 3270, freedSeat: true, squareRefundId: 'rf_took', by: { id: 'admin', name: 'Owner' } })])
  })

  it('a capped whole-booking refund still frees seats trimmed to nothing', async () => {
    const charged = { orderId: 'o1', paymentId: 'pay_1', lineUid: null, chargedCents: 3270 }
    const a = line({ seat: 1, square: charged }), b = line({ seat: 2, square: charged })
    const classId = await setup([a, b])
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(r.status).toBe(200)
    expect(mocks.refundPayment.mock.calls[0][0].amountCents).toBe(3270)
    const after = await byId(classId)
    expect(after[a.id].refunds[0]).toMatchObject({ cents: 3270, freedSeat: true })
    expect(after[b.id].refunds[0]).toMatchObject({ cents: 0, freedSeat: true, squareRefundId: expect.stringMatching(/^rf_/) })
    expect(after[b.id].state).toBe('refunded')
  })

  it('caps a booking at what Square charged, less refunds', async () => {
    const charged = { orderId: 'o1', paymentId: 'pay_1', lineUid: null, chargedCents: 6000 }
    const a = line({ seat: 1, square: charged }), b = line({ seat: 2, square: charged })
    const classId = await setup([a, b])
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 6001 })).status).toBe(400)
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(r.status).toBe(200)
    expect(mocks.refundPayment.mock.calls[0][0].amountCents).toBe(6000)
    const after = await byId(classId)
    expect(after[a.id].refunds[0].cents).toBe(3270)
    expect(after[b.id].refunds[0].cents).toBe(2730)
  })

  it('an email failure logs no address', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const classId = await setup([line({})])
    mocks.email.mockRejectedValueOnce(Object.assign(new Error('Invalid recipient ada@example.com'), { code: 'EENVELOPE' }))
    await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('EENVELOPE')
    expect(logged).not.toContain('ada@example.com')
    warn.mockRestore()
  })
})

describe('crew refunds', () => {
  it('needs a staff sign-in', async () => {
    mocks.staff = null
    expect((await staff({})).status).toBe(401)
  })

  it('needs a reason of at least 3 characters', async () => {
    const classId = await setup([line({})])
    const r = await staff({ classId, bookingId: 'bkg_r1', kind: 'booking', reason: 'no' })
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/reason/i)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('refunds and audits as the crew member', async () => {
    const a = line({})
    const classId = await setup([a])
    const r = await staff({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id], reason: 'Kid was sick' })
    expect(r.status).toBe(200)
    expect((await byId(classId))[a.id].refunds[0]).toMatchObject({ by: { id: 'sam', name: 'Sam' }, reason: 'Kid was sick', freedSeat: true })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'class-refund',
      by: { id: 'sam', name: 'Sam', role: 'crew' },
      details: expect.objectContaining({ reason: 'Kid was sick', cents: 3270 }),
    }))
  })
})

describe('fix round 2: one saved request per refund, so a retry never refunds twice', () => {
  const paidWith = (paymentId: string, chargedCents?: number) => ({ orderId: 'o1', paymentId, lineUid: null, ...(chargedCents ? { chargedCents } : {}) })
  /** a $25 seat, no tax */
  const seat = (n: number, paymentId: string, charged?: number) => line({ seat: n, priceCents: 2500, taxCents: 0, square: paidWith(paymentId, charged) })
  /** a refund as Square's webhook (or ListPaymentRefunds) shows it */
  const fromSquare = (id: string, paymentId: string, cents: number) => ({ id, status: 'COMPLETED', payment_id: paymentId, amount_money: { amount: cents, currency: 'USD' }, location_id: 'LOC1' })
  const took = (id: string) => async (i: any) => ({ id, paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' })

  it('the reviewer\'s case: custom $20 on 2 × $25; Square took it, we never heard, the webhook landed; the retry refunds nothing more', async () => {
    const a = seat(1, 'pay_rv', 5000), b = seat(2, 'pay_rv', 5000)
    const classId = await setup([a, b])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'custom', cents: 2000, attempt: 'att-reviewer-1' }
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    const first = await admin(ask)
    expect(first.status).toBe(502)
    expect(first.body.error).toBe(SQUARE_NO_ANSWER)
    expect(await handleRefund(fromSquare('rf_rv', 'pay_rv', 2000), new Date())).toMatchObject({ action: 'ignored', why: 'ours' })
    let after = await byId(classId)
    expect(after[a.id].refunds).toEqual([expect.objectContaining({ cents: 2000, squareRefundId: 'rf_rv', by: { id: 'admin', name: 'Owner' }, freedSeat: false })])
    expect(after[b.id].refunds).toEqual([])
    const again = await admin(ask)
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ refundId: 'rf_rv', cents: 2000 })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    after = await byId(classId)
    expect(after[a.id].refunds).toHaveLength(1)
    expect(after[b.id].refunds).toEqual([])
  })

  it('no answer and no webhook: the retry re-sends the saved split and key exactly, even after the ledger changed', async () => {
    const a = seat(1, 'pay_ns', 5000), b = seat(2, 'pay_ns', 5000)
    const classId = await setup([a, b])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'custom', cents: 2000, attempt: 'att-nosplit-1' }
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    expect((await admin(ask)).status).toBe(502)
    // meanwhile a different $6 refund is made at the register and recorded from Square on seat 1 (re-planning would now split 19 + 1)
    expect(await handleRefund(fromSquare('rf_pos6', 'pay_ns', 600), new Date())).toMatchObject({ action: 'flagged' })
    mocks.refundPayment.mockImplementationOnce(took('rf_ns'))
    expect((await admin(ask)).status).toBe(200)
    const [c1, c2] = mocks.refundPayment.mock.calls.map((c) => c[0])
    expect(c2.idempotencyKey).toBe(c1.idempotencyKey)
    expect(c2.amountCents).toBe(2000)
    // the $20 Square refunded is still saved in full: seat 1 takes what it has left, the rest goes on seat 2
    const after = await byId(classId)
    expect(after[a.id].refunds.find((r) => r.squareRefundId === 'rf_ns')).toMatchObject({ cents: 1900 })
    expect(after[b.id].refunds.find((r) => r.squareRefundId === 'rf_ns')).toMatchObject({ cents: 100 })
  })

  it('the save failed after Square took it: the retry saves it without asking Square again (with or without an attempt token)', async () => {
    const a = seat(1, 'pay_fs', 5000), b = seat(2, 'pay_fs', 5000)
    const classId = await setup([a, b])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'custom', cents: 2000 }
    ledgerFail.n = 1
    mocks.refundPayment.mockImplementationOnce(took('rf_fs'))
    const first = await admin(ask)
    expect(first.status).toBe(500)
    const again = await admin(ask)
    expect(again.status).toBe(200)
    expect(again.body.data).toMatchObject({ refundId: 'rf_fs', cents: 2000 })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    const after = await byId(classId)
    expect(after[a.id].refunds).toEqual([expect.objectContaining({ cents: 2000, squareRefundId: 'rf_fs', by: { id: 'admin', name: 'Owner' } })])
    // and a late webhook for it changes nothing
    expect(await handleRefund(fromSquare('rf_fs', 'pay_fs', 2000), new Date())).toMatchObject({ action: 'ignored' })
    expect((await byId(classId))[a.id].refunds).toHaveLength(1)
  })

  it('the webhook lands before our save: one record, as the owner, one audit, one Square refund', async () => {
    const a = seat(1, 'pay_rc', 5000), b = seat(2, 'pay_rc', 5000)
    const classId = await setup([a, b])
    mocks.refundPayment.mockImplementationOnce(async (i: any) => {
      await handleRefund(fromSquare('rf_race', 'pay_rc', i.amountCents), new Date())
      return { id: 'rf_race', paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }
    })
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id], reason: 'Sick', attempt: 'att-race-1' })
    expect(r.status).toBe(200)
    const after = await byId(classId)
    expect(after[a.id].refunds).toEqual([])
    expect(after[b.id].refunds).toEqual([expect.objectContaining({ cents: 2500, freedSeat: true, reason: 'Sick', squareRefundId: 'rf_race', by: { id: 'admin', name: 'Owner' } })])
    expect(mocks.audit.mock.calls.filter((c) => c[0].action === 'class-refund')).toHaveLength(1)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
  })

  it('charged less than the seat prices: a person refund retried after the webhook is not made again, and the cap still holds', async () => {
    const a = seat(1, 'pay_lo', 4000), b = seat(2, 'pay_lo', 4000)
    const classId = await setup([a, b])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id], attempt: 'att-low-1' }
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    expect((await admin(ask)).status).toBe(502)
    expect(mocks.refundPayment.mock.calls[0][0].amountCents).toBe(2500)
    await handleRefund(fromSquare('rf_lo', 'pay_lo', 2500), new Date())
    const again = await admin(ask)
    expect(again.status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    expect((await byId(classId))[b.id].refunds).toEqual([expect.objectContaining({ cents: 2500, freedSeat: true, squareRefundId: 'rf_lo' })])
    // what's left on the booking is what was charged less that refund
    mocks.refundPayment.mockImplementationOnce(took('rf_lo2'))
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'booking', attempt: 'att-low-2' })).status).toBe(200)
    expect(mocks.refundPayment.mock.calls[1][0].amountCents).toBe(1500)
  })

  it('the same attempt after a success is a replay; a new attempt is a new refund', async () => {
    const a = seat(1, 'pay_rp', 5000)
    const classId = await setup([a])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'custom', cents: 1000, attempt: 'att-replay-1' }
    expect((await admin(ask)).status).toBe(200)
    const replay = await admin(ask)
    expect(replay.status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    expect((await admin({ ...ask, attempt: 'att-replay-2', again: true })).status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2)
    expect((await byId(classId))[a.id].refunds.map((r) => r.cents)).toEqual([1000, 1000])
  })
})

describe('fix round 3: a refund still waiting on Square, checked by a person; one email per refund', () => {
  const paidWith = (paymentId: string, chargedCents?: number) => ({ orderId: 'o1', paymentId, lineUid: null, ...(chargedCents ? { chargedCents } : {}) })
  const seat = (n: number, paymentId: string) => line({ seat: n, priceCents: 2500, taxCents: 0, square: paidWith(paymentId, 5000) })
  const fromSquare = (id: string, paymentId: string, cents: number) => ({ id, status: 'COMPLETED', payment_id: paymentId, amount_money: { amount: cents, currency: 'USD' }, location_id: 'LOC1' })
  /** X: a $20 custom refund that Square never answered */
  async function waiting(paymentId: string) {
    const a = seat(1, paymentId), b = seat(2, paymentId)
    const classId = await setup([a, b])
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    const ask = { classId, bookingId: 'bkg_r1', kind: 'custom', cents: 2000, reason: 'Sick', attempt: `att-${paymentId}` }
    expect((await admin(ask)).status).toBe(502)
    const refused = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id] })
    expect(refused.status).toBe(409)
    return { a, b, classId, ask, requestId: refused.body.pending.requestId as string }
  }

  it('"It went through": saved as asked, by who asked, cleared by who checked; one email; Square\'s refund later changes nothing', async () => {
    const { a, b, classId, ask, requestId } = await waiting('pay_wt')
    const r = await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'went-through', reason: 'Saw it in Square' })
    expect(r.status).toBe(200)
    let after = await byId(classId)
    expect(after[a.id].refunds).toEqual([expect.objectContaining({ cents: 2000, freedSeat: false, by: { id: 'admin', name: 'Owner' }, reason: 'Sick' })])
    expect(after[b.id].refunds).toEqual([])
    const [req] = await listRefundRequests(classId, 'bkg_r1')
    expect(req).toMatchObject({ status: 'done', cleared: { outcome: 'went-through', by: { id: 'admin', name: 'Owner' }, reason: 'Saw it in Square' } })
    expect(mocks.email).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'class-refund', details: expect.objectContaining({ via: 'checked-in-square', cents: 2000 }) }))
    // Square's own refund shows up later: it is ours, nothing new written, no second email
    expect(await handleRefund(fromSquare('rf_wt', 'pay_wt', 2000), new Date())).toMatchObject({ action: 'ignored', why: 'ours' })
    after = await byId(classId)
    expect(after[a.id].refunds).toHaveLength(1)
    expect(mocks.email).toHaveBeenCalledTimes(1)
    // the retry of the same ask is answered as done, nothing sent again
    expect((await admin(ask)).status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    expect(mocks.email).toHaveBeenCalledTimes(1)
    // and a different refund may now be made
    mocks.refundPayment.mockImplementationOnce(async (i: any) => ({ id: 'rf_next', paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }))
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id] })).status).toBe(200)
  })

  it('"It didn\'t go through": nothing saved, a different refund may be made, and the same one again reuses its key', async () => {
    const { classId, ask, b, requestId } = await waiting('pay_dn')
    const x1 = mocks.refundPayment.mock.calls[0][0].idempotencyKey
    const r = await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'did-not-go-through' })
    expect(r.status).toBe(200)
    expect(Object.values(await byId(classId)).every((l) => l.refunds.length === 0)).toBe(true)
    expect((await listRefundRequests(classId, 'bkg_r1'))[0]).toMatchObject({ status: 'turned-down', cleared: { outcome: 'did-not-go-through' } })
    expect(mocks.email).not.toHaveBeenCalled()
    mocks.refundPayment.mockImplementationOnce(async (i: any) => ({ id: 'rf_other', paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }))
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id] })).status).toBe(200)
    mocks.refundPayment.mockImplementationOnce(async (i: any) => ({ id: 'rf_again', paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }))
    expect((await admin(ask)).status).toBe(200)
    // if it had in fact gone through, Square hands back that refund instead of making a second
    expect(mocks.refundPayment.mock.calls.at(-1)![0].idempotencyKey).toBe(x1)
  })

  it('clearing needs the request to still be waiting, and crew must give a reason (logged as them)', async () => {
    const { classId, requestId } = await waiting('pay_cr')
    mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
    const noReason = await staff({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'did-not-go-through' })
    expect(noReason.status).toBe(400)
    const ok = await staff({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'did-not-go-through', reason: 'Not in Square' })
    expect(ok.status).toBe(200)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'class-refund-checked', by: { id: 'sam', name: 'Sam', role: 'crew' },
      details: expect.objectContaining({ outcome: 'did-not-go-through', reason: 'Not in Square', requestId }),
    }))
    const again = await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'went-through' })
    expect(again.status).toBe(409)
    expect((await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId: 'nope', outcome: 'went-through' })).status).toBe(404)
    expect((await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'maybe' })).status).toBe(400)
  })

  it('finished by Square\'s webhook: the customer is emailed once; the retry answered as done does not email again', async () => {
    const a = seat(1, 'pay_em'), b = seat(2, 'pay_em')
    const classId = await setup([a, b])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id], attempt: 'att-email-1' }
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    expect((await admin(ask)).status).toBe(502)
    await handleRefund(fromSquare('rf_em', 'pay_em', 2500), new Date())
    await handleRefund(fromSquare('rf_em', 'pay_em', 2500), new Date())
    expect(mocks.email).toHaveBeenCalledTimes(1)
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.com', cents: 2500, className: 'Candles' }))
    expect((await admin(ask)).status).toBe(200)
    expect(mocks.email).toHaveBeenCalledTimes(1)
  })

  it('our own successful refund emails once even when the webhook landed first', async () => {
    const a = seat(1, 'pay_e2'), b = seat(2, 'pay_e2')
    const classId = await setup([a, b])
    mocks.refundPayment.mockImplementationOnce(async (i: any) => {
      await handleRefund(fromSquare('rf_e2', 'pay_e2', i.amountCents), new Date())
      return { id: 'rf_e2', paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }
    })
    const r = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id], attempt: 'att-e2' })
    expect(r.status).toBe(200)
    expect(r.body.data.emailed).toBe(true)
    expect(mocks.email).toHaveBeenCalledTimes(1)
  })
})

describe('fix round 4: identical refunds match forever, atomic refund state, Square refunds never lost', () => {
  const paidWith = (paymentId: string, chargedCents?: number) => ({ orderId: 'o1', paymentId, lineUid: null, ...(chargedCents ? { chargedCents } : {}) })
  const seat = (n: number, paymentId: string, over: Partial<LedgerLine> = {}) =>
    line({ seat: n, priceCents: 2500, taxCents: 0, square: paidWith(paymentId, 5000), ...over })
  const fromSquare = (id: string, paymentId: string, cents: number) => ({ id, status: 'COMPLETED', payment_id: paymentId, amount_money: { amount: cents, currency: 'USD' }, location_id: 'LOC1' })
  /** Square's own behaviour: the same idempotency key hands back the same refund. */
  const squareByKey = () => mocks.refundPayment.mockImplementation(async (i: any) => ({ id: `rf_${i.idempotencyKey.slice(-8)}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'COMPLETED' }))
  const refundAudits = () => mocks.audit.mock.calls.filter((c) => c[0].action === 'class-refund')
  async function waiting(paymentId: string) {
    const a = seat(1, paymentId, { customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '4029802907' } })
    const b = seat(2, paymentId, { customer: { givenName: 'Bea', familyName: 'Lovelace', email: 'ada@example.com', phone: '4029802907' } })
    const classId = await setup([a, b])
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id], reason: 'Sick', attempt: `att-${paymentId}` }
    expect((await admin(ask)).status).toBe(502)
    const refused = await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 100, lineIds: [a.id] })
    expect(refused.status).toBe(409)
    return { a, b, classId, ask, requestId: refused.body.pending.requestId as string, refused }
  }

  describe('I1: the same refund re-entered is never planned fresh', () => {
    it('"It went through" by someone else, then the asker re-enters it from a reloaded screen: nothing goes to Square', async () => {
      const { classId, ask, requestId } = await waiting('pay_i1')
      mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
      expect((await staff({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'went-through', reason: 'Saw it in Square' })).status).toBe(200)
      // the asker hasn't been told yet
      expect((await listRefundRequests(classId, 'bkg_r1'))[0].answered).toBe(false)
      for (const attempt of ['att-reloaded', undefined]) {
        const r = await admin({ ...ask, attempt })
        expect(r.status).toBe(200)
        expect(r.body.data.already).toMatchObject({ by: { id: 'admin', name: 'Owner' }, at: expect.any(String) })
        expect(r.body.data.already.message).toMatch(/^Already refunded on .+ by Owner\.$/)
        expect(r.body.data.cents).toBe(2500)
      }
      expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
      expect((await listRefundRequests(classId, 'bkg_r1'))[0].answered).toBe(true)
    })

    it('finished by Square more than 24 hours ago: the same ask still matches it', async () => {
      const a = seat(1, 'pay_old'), b = seat(2, 'pay_old')
      const classId = await setup([a, b])
      const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id] }
      mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
      expect((await admin({ ...ask, attempt: 'att-old-1' })).status).toBe(502)
      await handleRefund(fromSquare('rf_old', 'pay_old', 2500), new Date())
      // make it three days old
      const key = (await requestsKv.list()).find((k) => k.includes(classId))!
      const old = new Date(Date.now() - 3 * 864e5).toISOString()
      const list = JSON.parse((await requestsKv.get(key))!)
      await requestsKv.set(key, JSON.stringify(list.map((r: any) => ({ ...r, createdAt: old, updatedAt: old, doneAt: old }))))
      const r = await admin({ ...ask, attempt: 'att-old-2' })
      expect(r.status).toBe(200)
      expect(r.body.data.already).toBeTruthy()
      expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
      expect((await byId(classId))[b.id].refunds).toHaveLength(1)
    })

    it('"Refund again" (again: true) makes a genuinely new refund with a new key', async () => {
      const a = seat(1, 'pay_ag')
      const classId = await setup([a])
      const ask = { classId, bookingId: 'bkg_r1', kind: 'custom', cents: 500 }
      expect((await admin({ ...ask, attempt: 'att-ag-1' })).status).toBe(200)
      expect((await admin({ ...ask, attempt: 'att-ag-2' })).body.data.already).toBeTruthy()
      const r = await admin({ ...ask, attempt: 'att-ag-3', again: true })
      expect(r.status).toBe(200)
      expect(r.body.data.already).toBeUndefined()
      const [k1, k2] = mocks.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)
      expect(k2).not.toBe(k1)
      expect((await byId(classId))[a.id].refunds.map((x) => x.cents)).toEqual([500, 500])
    })
  })

  describe('M1: the waiting check and the save are one step', () => {
    it('two different refunds at once: exactly one goes to Square, the other gets the 409', async () => {
      const a = seat(1, 'pay_m1'), b = seat(2, 'pay_m1')
      const classId = await setup([a, b])
      squareByKey()
      let other: Awaited<ReturnType<typeof admin>> | null = null
      // while the first is being planned, a second person's different refund lands and gets no answer
      ledgerFail.onRead = async () => {
        mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
        other = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id] })
      }
      const first = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })
      expect(other!.status).toBe(502)
      expect(first.status).toBe(409)
      expect(first.body.error).toBe(STILL_WAITING_ON_SQUARE)
      expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
      expect(await listRefundRequests(classId, 'bkg_r1')).toHaveLength(1)
    })

    it('a different refund finished in the gap: the one planned before it is refused, not sent', async () => {
      const a = seat(1, 'pay_m1b'), b = seat(2, 'pay_m1b')
      const classId = await setup([a, b])
      squareByKey()
      ledgerFail.onRead = async () => { expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })).status).toBe(200) }
      const first = await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })
      expect(first.status).toBe(409)
      expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
      expect((await byId(classId))[a.id].refunds).toHaveLength(1)
    })

    it('double-click with no token, the first still waiting on Square: one request, one audit, one email', async () => {
      const a = seat(1, 'pay_dc')
      const classId = await setup([a])
      squareByKey()
      const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] }
      ledgerFail.onRead = async () => {
        mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
        expect((await admin(ask)).status).toBe(502)
      }
      expect((await admin(ask)).status).toBe(200)
      expect(await listRefundRequests(classId, 'bkg_r1')).toHaveLength(1)
      const keys = new Set(mocks.refundPayment.mock.calls.map((c) => c[0].idempotencyKey))
      expect(keys.size).toBe(1)
      expect(refundAudits()).toHaveLength(1)
      expect(mocks.email).toHaveBeenCalledTimes(1)
      expect((await byId(classId))[a.id].refunds).toHaveLength(1)
    })

    it('double-click with no token, the first already finished: answered as already done, one audit, one email', async () => {
      const a = seat(1, 'pay_dd')
      const classId = await setup([a])
      squareByKey()
      const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] }
      ledgerFail.onRead = async () => { expect((await admin(ask)).status).toBe(200) }
      const second = await admin(ask)
      expect(second.status).toBe(200)
      expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
      expect(refundAudits()).toHaveLength(1)
      expect(mocks.email).toHaveBeenCalledTimes(1)
    })
  })

  describe('M2/M3: money first by Square refund id, then the request; a replay finishes the missing half', () => {
    it('webhook: the request save fails after the money was written; the replay finishes it (spill-over included) without doubling', async () => {
      const a = seat(1, 'pay_m2'), b = seat(2, 'pay_m2')
      const classId = await setup([a, b])
      mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
      // a $20 refund on seat 2
      expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 2000, lineIds: [b.id], attempt: 'att-m2' })).status).toBe(502)
      // seat 2 is short since: $10 of it was refunded in Square, so $5 of the $20 spills onto seat 1
      const led = JSON.parse((await ledgerKv.get(`ledger-${classId}`))!)
      led.lines = led.lines.map((l: any) => (l.id === b.id ? { ...l, state: 'refunded', refunds: [{ at: 'x', cents: 1000, reason: 'r', by: { id: 'square', name: 'Square' }, freedSeat: false, squareRefundId: 'rf_reg' }] } : l))
      await ledgerKv.set(`ledger-${classId}`, JSON.stringify(led))
      requestFail.done = 1
      await expect(handleRefund(fromSquare('rf_m2', 'pay_m2', 2000), new Date())).rejects.toThrow()
      let after = await byId(classId)
      expect(after[b.id].refunds.filter((r) => r.squareRefundId === 'rf_m2').map((r) => r.cents)).toEqual([1500])
      expect(after[a.id].refunds.filter((r) => r.squareRefundId === 'rf_m2').map((r) => r.cents)).toEqual([500])
      expect((await listRefundRequests(classId, 'bkg_r1'))[0].status).not.toBe('done')
      // Square sends it again (or the nightly run finds it)
      expect(await handleRefund(fromSquare('rf_m2', 'pay_m2', 2000), new Date())).toMatchObject({ action: 'ignored', why: 'ours' })
      expect(await handleRefund(fromSquare('rf_m2', 'pay_m2', 2000), new Date())).toMatchObject({ action: 'ignored' })
      after = await byId(classId)
      expect(after[b.id].refunds.filter((r) => r.squareRefundId === 'rf_m2')).toHaveLength(1)
      expect(after[a.id].refunds.filter((r) => r.squareRefundId === 'rf_m2')).toHaveLength(1)
      expect((await listRefundRequests(classId, 'bkg_r1'))[0]).toMatchObject({ status: 'done', squareRefundId: 'rf_m2' })
      expect(refundAudits()).toHaveLength(1)
      expect(mocks.email).toHaveBeenCalledTimes(1)
    })

    it('webhook: a ledger save that fails writes nothing at all (asked seats and spill-over go together)', async () => {
      const a = seat(1, 'pay_m2b'), b = seat(2, 'pay_m2b')
      const classId = await setup([a, b])
      mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
      expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 3000, lineIds: [b.id, a.id], attempt: 'att-m2b' })).status).toBe(502)
      ledgerFail.n = 1
      await expect(handleRefund(fromSquare('rf_m2b', 'pay_m2b', 3000), new Date())).rejects.toThrow()
      expect(Object.values(await byId(classId)).every((l) => l.refunds.length === 0)).toBe(true)
      await handleRefund(fromSquare('rf_m2b', 'pay_m2b', 3000), new Date())
      const after = await byId(classId)
      expect(after[a.id].refunds.map((r) => r.cents)).toEqual([2500])
      expect(after[b.id].refunds.map((r) => r.cents)).toEqual([500])
    })

    it('"It went through": the request save fails after the money was written; doing it again finishes it, never writes twice', async () => {
      const { a, b, classId, requestId } = await waiting('pay_m3')
      requestFail.done = 1
      const first = await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'went-through', reason: 'Saw it' })
      expect(first.status).toBe(503)
      expect((await byId(classId))[b.id].refunds).toHaveLength(1)
      // it can't now be marked "didn't go through": the money is on the ledger
      expect((await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'did-not-go-through' })).status).toBe(409)
      const again = await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'went-through', reason: 'Saw it' })
      expect(again.status).toBe(200)
      const after = await byId(classId)
      expect(after[b.id].refunds).toEqual([expect.objectContaining({ cents: 2500, freedSeat: true })])
      expect(after[a.id].refunds).toEqual([])
      expect((await listRefundRequests(classId, 'bkg_r1'))[0].status).toBe('done')
      expect(refundAudits()).toHaveLength(1)
      expect(mocks.email).toHaveBeenCalledTimes(1)
      // and Square's refund turning up later is that one
      expect(await handleRefund(fromSquare('rf_m3', 'pay_m3', 2500), new Date())).toMatchObject({ action: 'ignored', why: 'ours' })
      expect((await byId(classId))[b.id].refunds).toHaveLength(1)
    })

    it('"It went through" half done, then Square\'s refund arrives: it finishes the request, money written once', async () => {
      const { b, classId, requestId } = await waiting('pay_m3b')
      requestFail.done = 1
      expect((await admin({ action: 'clear-request', classId, bookingId: 'bkg_r1', requestId, outcome: 'went-through' })).status).toBe(503)
      expect(await handleRefund(fromSquare('rf_m3b', 'pay_m3b', 2500), new Date())).toMatchObject({ action: 'ignored', why: 'ours' })
      expect((await byId(classId))[b.id].refunds).toHaveLength(1)
      expect((await listRefundRequests(classId, 'bkg_r1'))[0]).toMatchObject({ status: 'done', squareRefundId: 'rf_m3b' })
      expect(mocks.email).toHaveBeenCalledTimes(1)
    })
  })

  it('M4: a replayed "done" answer says whether the customer was emailed', async () => {
    const a = seat(1, 'pay_m4')
    const classId = await setup([a])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id], attempt: 'att-m4' }
    expect((await admin(ask)).body.data.emailed).toBe(true)
    const replay = await admin(ask)
    expect(replay.body.data.emailed).toBe(true)
    expect(mocks.email).toHaveBeenCalledTimes(1)
  })

  it('M5: re-sending a refund Square turned down re-checks what is left; a split that no longer fits is refused before Square', async () => {
    const a = seat(1, 'pay_m5'), b = seat(2, 'pay_m5')
    const classId = await setup([a, b])
    const ask = { classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [b.id] }
    mocks.refundPayment.mockResolvedValueOnce({ id: 'rf_no', paymentId: 'pay_m5', amountCents: 2500, status: 'FAILED' })
    expect((await admin(ask)).status).toBe(502)
    // $40 refunded at the register since: seat 1 all, seat 2 $15 → seat 2 has $10 left
    await handleRefund(fromSquare('rf_reg5', 'pay_m5', 4000), new Date())
    const r = await admin(ask)
    expect(r.status).toBe(409)
    expect(r.body.error).toBe(SAVED_SPLIT_NO_LONGER_FITS)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    // asking again plans it from what's left now
    const fresh = await admin(ask)
    expect(fresh.status).toBe(200)
    expect(mocks.refundPayment.mock.calls.at(-1)![0].amountCents).toBe(1000)
  })

  describe('M6: the waiting refund is named, and the routes list a booking\'s refunds', () => {
    it('the 409 says who, when, how much and which people and dates', async () => {
      const { refused, b } = await waiting('pay_m6')
      expect(refused.body.pending).toMatchObject({
        cents: 2500, by: { id: 'admin', name: 'Owner' }, at: expect.any(String), kind: 'person', freeSeat: true,
        people: [{ lineId: b.id, seat: 2, name: 'Bea Lovelace' }],
        dates: [expect.any(String)],
      })
    })

    it('GET lists a booking\'s refund requests (owner and crew, signed in only)', async () => {
      const { classId, requestId } = await waiting('pay_m6g')
      const get = async (route: any, signedIn: boolean) => {
        const request = new Request(`https://x.test/api/refund?classId=${classId}&bookingId=bkg_r1`, { headers: signedIn ? { cookie: cookie() } : {} })
        const res: Response = await route.GET({ request, url: new URL(request.url) } as any)
        return { status: res.status, body: await res.json() }
      }
      expect((await get(adminRoute, false)).status).toBe(401)
      const r = await get(adminRoute, true)
      expect(r.status).toBe(200)
      expect(r.body.data.requests).toEqual([expect.objectContaining({ requestId, status: 'pending', cents: 2500, people: [expect.objectContaining({ name: 'Bea Lovelace' })] })])
      expect(r.body.data.requests[0].idempotencyKey).toBeUndefined()
      expect((await get(staffRoute, false)).status).toBe(200) // mocks.staff signed in
      mocks.staff = null
      expect((await get(staffRoute, false)).status).toBe(401)
    })
  })
})
