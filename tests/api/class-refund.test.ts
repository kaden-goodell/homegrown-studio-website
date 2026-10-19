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
import { refundKey } from '@lib/classes/refunds'
import { makeKvStore } from '@lib/blob-store'
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
    expect((await byId(classId))[a.id].refunds[0].cents).toBe(3633)
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
    expect(r.body.error).toMatch(/\.$/)
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
