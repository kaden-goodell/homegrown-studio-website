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
const ledgerFail = vi.hoisted(() => ({ n: 0 }))
vi.mock('@lib/classes/seat-ledger', async (orig) => {
  const real = await orig<typeof import('@lib/classes/seat-ledger')>()
  return {
    ...real,
    recordRefund: async (...a: Parameters<typeof real.recordRefund>) => {
      if (ledgerFail.n > 0) { ledgerFail.n--; throw new Error('blob down') }
      return real.recordRefund(...a)
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
import { refundKey, refundKeyRaw, SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN } from '@lib/classes/refunds'
import { makeKvStore } from '@lib/blob-store'
import { handleRefund } from '@lib/classes/square-events'
import type { ClassContent } from '@lib/classes/types'

const ledgerKv = makeKvStore('seat-ledger', 'seat-ledger')
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
    await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 1000 })
    const [k1, k2] = mocks.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)
    expect(k1).not.toBe(k2)
    expect(k2).toBe(refundKey('bkg_r1', [a.id], 1000, 1))
    await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(mocks.refundPayment.mock.calls[2][0].amountCents).toBe(1270)
    const done = await admin({ classId, bookingId: 'bkg_r1', kind: 'booking' })
    expect(done.status).toBe(400)
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

  it('a turned-down refund on one request leaves another request’s retry key alone', async () => {
    const a = line({ seat: 1 }), b = line({ seat: 2 })
    const classId = await setup([a, b])
    // X: no answer (it went through at Square but we never heard), nothing recorded
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })).status).toBe(502)
    const x1 = mocks.refundPayment.mock.calls[0][0].idempotencyKey
    // Y: a different request, Square says FAILED
    mocks.refundPayment.mockResolvedValueOnce({ id: 'rf_y', paymentId: 'pay_1', amountCents: 500, status: 'FAILED' })
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'custom', cents: 500, lineIds: [b.id] })).status).toBe(502)
    // retry X: must replay X's original key so Square can't refund it twice
    expect((await admin({ classId, bookingId: 'bkg_r1', kind: 'person', lineIds: [a.id] })).status).toBe(200)
    expect(mocks.refundPayment.mock.calls[2][0].idempotencyKey).toBe(x1)
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
    expect((await admin({ ...ask, attempt: 'att-replay-2' })).status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2)
    expect((await byId(classId))[a.id].refunds.map((r) => r.cents)).toEqual([1000, 1000])
  })
})
