// @vitest-environment node
/**
 * Party refunds from /admin (owners) and /staff (crew, reason required), on
 * the shared refund runner: one charge at a time, never more than it has
 * left, the R29 wait, "Already refunded" / "Refund again" (R31), one email per
 * request (R30), and a refund never changing the party itself.
 */
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

import * as adminRoute from '@pages/api/admin/parties/refund.json'
import * as staffRoute from '@pages/api/staff/party-refund.json'
import { adminCookie } from '@lib/admin-auth'
import { createPartyRecord, getPartyRecord, type PartyRecord, type PartyRefund } from '@lib/party-store'
import { recordPartyPayment } from '@lib/parties/party-payments'
import { listRefundRequests } from '@lib/classes/refund-requests'
import {
  AGAIN_IS_STALE, NOT_PAID_HERE, refundKey, SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE,
} from '@lib/booking-core/refund-words'
import { MORE_THAN_LEFT, recordSquarePartyRefund, SIMULATED_CHARGE } from '@lib/parties/refunds'
import { handleRefund } from '@lib/classes/square-events'

const cookie = () => adminCookie().split(';')[0]
async function call(route: any, method: 'POST' | 'GET', body: unknown, signedIn: boolean, query = '') {
  const request = new Request(`https://x.test/api/party-refund${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(signedIn ? { cookie: cookie() } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await route[method]({ request, url: new URL(request.url) } as any)
  return { status: res.status, body: await res.json() }
}
const admin = (body: unknown, signedIn = true) => call(adminRoute, 'POST', body, signedIn)
const staff = (body: unknown) => call(staffRoute, 'POST', body, false)
const requests = (partyId: string) => call(adminRoute, 'GET', null, true, `?partyId=${partyId}`)

let n = 0
const uid = (p: string) => `${p}${++n}${Date.now().toString(36)}`

/** A paid party of ours: one $300 charge on payment `pay_<id>`. */
async function party(overOf: Partial<PartyRecord> | ((id: string) => Partial<PartyRecord>) = {}) {
  const id = uid('pty_')
  const over = typeof overOf === 'function' ? overOf(id) : overOf
  const rec: PartyRecord = {
    bookingId: id, hostToken: 'tok', craftName: 'Pails', startIso: '2026-11-14T19:30:00.000Z', durationMinutes: 90,
    hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '4029802907', guestCount: 12, title: null, dropOff: false,
    createdAt: '2026-10-19T00:00:00.000Z', source: 'ours', status: 'booked', endIso: '2026-11-14T21:00:00.000Z', packageId: 'pkg_whole',
    items: [{ id: 'itm_pkg', kind: 'package', refId: 'pkg_whole', label: 'Whole Studio Party — studio fee', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: 'chg_1', addedAt: '2026-10-19T00:00:00.000Z', by: null }],
    charges: [{ id: 'chg_1', via: 'online', orderId: `ord_${id}`, paymentId: `pay_${id}`, cents: 30000, quotedCents: 30000, itemIds: ['itm_pkg'], receiptUrl: null, at: '2026-10-19T00:00:00.000Z', by: null }],
    refunds: [],
    paying: null,
    ...over,
  }
  await createPartyRecord(rec)
  return { id, paymentId: `pay_${id}`, rec }
}
const ask = (partyId: string, cents: number, over: Record<string, unknown> = {}) => ({ partyId, chargeId: 'chg_1', cents, reason: '', attempt: uid('tok_'), ...over })

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  mocks.refundPayment.mockReset().mockImplementation(async (i: any) => ({ id: uid('rf_'), paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' }))
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.email.mockReset().mockResolvedValue({ sent: true })
  mocks.staff = { id: 'sam', name: 'Sam', role: 'crew' }
})
afterEach(() => vi.unstubAllEnvs())

describe('who can refund a party', () => {
  it('/admin needs the owner cookie; /staff needs someone signed in', async () => {
    expect((await admin({}, false)).status).toBe(401)
    mocks.staff = null
    expect((await staff({})).status).toBe(401)
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('crew: no reason refused; with a reason it goes through, logged with their name', async () => {
    const p = await party()
    const none = await staff(ask(p.id, 1000, { reason: ' ' }))
    expect(none).toMatchObject({ status: 400, body: { error: 'Add a reason for the refund.' } })
    expect(mocks.refundPayment).not.toHaveBeenCalled()
    const r = await staff(ask(p.id, 1000, { reason: 'Kid was sick' }))
    expect(r.status).toBe(200)
    expect(r.body.data.refund).toMatchObject({ cents: 1000, by: { id: 'sam', name: 'Sam' }, role: 'crew', reason: 'Kid was sick' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'party-refund', by: { id: 'sam', name: 'Sam', role: 'crew' },
      target: { kind: 'party', id: p.id, label: 'the Justice party' },
      details: expect.objectContaining({ chargeId: 'chg_1', cents: 1000, reason: 'Kid was sick' }),
    }))
  })
})

describe('owner refunds', () => {
  it('partial then the rest of one charge: two Square refunds, both on the party; nothing else changes', async () => {
    const p = await party()
    const first = await admin(ask(p.id, 5000, { reason: 'Fewer kids' }))
    expect(first.status).toBe(200)
    expect(first.body.data).toMatchObject({ cents: 5000, emailed: true, refundable: { chg_1: 25000 } })
    expect(mocks.refundPayment).toHaveBeenLastCalledWith({ paymentId: p.paymentId, amountCents: 5000, idempotencyKey: refundKey(p.id, ['chg_1'], 5000, 0), reason: 'Fewer kids' })
    const rest = await admin(ask(p.id, 25000))
    expect(rest.status).toBe(200)
    expect(rest.body.data.refundable).toEqual({ chg_1: 0 })
    expect(mocks.refundPayment).toHaveBeenLastCalledWith(expect.objectContaining({ amountCents: 25000, idempotencyKey: refundKey(p.id, ['chg_1'], 25000, 1) }))
    const after = (await getPartyRecord(p.id))!
    expect(after.refunds!.map((f) => [f.cents, f.role, f.chargeId])).toEqual([[5000, 'owner', 'chg_1'], [25000, 'owner', 'chg_1']])
    expect(after.refunds!.every((f) => f.squareRefundId && f.requestId)).toBe(true)
    // A refund never changes status, items, the time or a payment in flight.
    expect(after).toMatchObject({ status: 'booked', items: p.rec.items, startIso: p.rec.startIso, endIso: p.rec.endIso, paying: null, charges: p.rec.charges })
    expect(mocks.email).toHaveBeenCalledTimes(2)
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'stef@example.com', givenName: 'Stefanie', className: 'your party', cents: 5000, keptSeat: true, party: { startIso: p.rec.startIso } }))
    expect(mocks.audit.mock.calls.filter((c) => c[0].action === 'party-refund')).toHaveLength(2)
  })

  it('refund caps per charge: more than is left refused; a 21st refund on one payment refused', async () => {
    const p = await party()
    const over = await admin(ask(p.id, 30001))
    expect(over).toMatchObject({ status: 400, body: { error: MORE_THAN_LEFT } })
    // Refunds made here and in Square both count toward Square's cap on the payment.
    const twenty = (id: string): PartyRefund[] => Array.from({ length: 20 }, (_, i) => ({
      id: `prf_${i}`, chargeId: 'chg_1', paymentId: `pay_${id}`, cents: 100, reason: '', by: null, role: i % 2 ? 'square' : 'owner',
      squareRefundId: `sq_${i}`, requestId: null, at: '2026-10-19T00:00:00.000Z',
    }))
    const q = await party((id) => ({ refunds: twenty(id) }))
    const capped = await admin(ask(q.id, 100))
    expect(capped).toMatchObject({ status: 409, body: { error: 'This payment has had 20 refunds, the most Square allows on one payment.' } })
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('a party booked in Square is refunded in Square; a test-booking charge has nothing to refund; an unknown charge is named', async () => {
    const legacy = await party({ source: undefined, status: undefined })
    expect(await admin(ask(legacy.id, 1000))).toMatchObject({ status: 409, body: { error: NOT_PAID_HERE } })
    const sim = await party()
    const simRec = await party({ charges: [{ ...sim.rec.charges![0], simulated: true }] })
    expect(await admin(ask(simRec.id, 1000))).toMatchObject({ status: 409, body: { error: SIMULATED_CHARGE } })
    expect(await admin(ask(sim.id, 1000, { chargeId: 'chg_nope' }))).toMatchObject({ status: 404, body: { error: 'That payment is not on this party.' } })
    expect(await admin(ask('pty_nothere', 1000))).toMatchObject({ status: 404, body: { error: 'That party does not exist.' } })
    expect(mocks.refundPayment).not.toHaveBeenCalled()
  })

  it('a refund after the party was cancelled still goes; the email does not say they are still booked', async () => {
    const p = await party({ status: 'cancelled' })
    expect((await admin(ask(p.id, 30000))).status).toBe(200)
    expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ keptSeat: false }))
    expect((await getPartyRecord(p.id))!.status).toBe('cancelled')
  })
})

describe('R29 waiting blocks', () => {
  it('no answer → 502; a different refund → 409 naming the waiting one; "It went through" finishes it; then the other goes', async () => {
    const p = await party()
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    const first = await admin(ask(p.id, 5000, { attempt: 'tok_first1' }))
    expect(first).toMatchObject({ status: 502, body: { error: SQUARE_NO_ANSWER } })
    expect((await getPartyRecord(p.id))!.refunds).toEqual([])
    const other = await admin(ask(p.id, 2000))
    expect(other).toMatchObject({ status: 409, body: { error: STILL_WAITING_ON_SQUARE, pending: { cents: 5000, chargeId: 'chg_1', status: 'pending' } } })
    const list = await requests(p.id)
    expect(list.body.data.requests).toEqual([expect.objectContaining({ cents: 5000, status: 'pending', chargeId: 'chg_1', by: { id: 'admin', name: 'Owner' } })])
    const requestId = list.body.data.requests[0].requestId
    const cleared = await admin({ action: 'clear', partyId: p.id, requestId, outcome: 'went-through', reason: 'Saw it in Square' })
    expect(cleared).toMatchObject({ status: 200, body: { data: { status: 'done', refundable: { chg_1: 25000 } } } })
    expect((await getPartyRecord(p.id))!.refunds).toEqual([expect.objectContaining({ cents: 5000, squareRefundId: null, requestId })])
    expect(mocks.email).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'party-refund-checked', details: expect.objectContaining({ outcome: 'went-through', requestId }) }))
    expect((await admin(ask(p.id, 2000))).status).toBe(200)
  })

  it('the same retry after no answer re-sends the same key, and Square turning it down asks for a new one', async () => {
    const p = await party()
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await admin(ask(p.id, 5000, { attempt: 'tok_same01' }))
    mocks.refundPayment.mockResolvedValueOnce({ id: 'rf_x', status: 'FAILED' })
    expect(await admin(ask(p.id, 5000, { attempt: 'tok_same01' }))).toMatchObject({ status: 502, body: { error: SQUARE_TURNED_DOWN } })
    const [k1, k2] = mocks.refundPayment.mock.calls.map((c) => c[0].idempotencyKey)
    expect(k2).toBe(k1)
    expect((await admin(ask(p.id, 5000, { attempt: 'tok_same01' }))).status).toBe(200)
    expect(mocks.refundPayment.mock.calls[2][0].idempotencyKey).toBe(refundKey(p.id, ['chg_1'], 5000, 0, 1))
    expect((await getPartyRecord(p.id))!.refunds).toHaveLength(1)
  })
})

describe('the same refund twice (R31)', () => {
  it('entered again after a reload → "Already refunded"; Refund again needs again.of, and only the latest', async () => {
    const p = await party()
    const first = await admin(ask(p.id, 5000))
    const again = await admin(ask(p.id, 5000))
    expect(again.status).toBe(200)
    expect(again.body.data.already).toMatchObject({ count: 1, message: expect.stringMatching(/^Already refunded on .+ by Owner\.$/) })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
    const of = again.body.data.already.latest.requestId
    expect(again.body.data.refund).toMatchObject({ requestId: of, squareRefundId: first.body.data.refundId })
    expect(await admin(ask(p.id, 5000, { again: { of: 'req_stale01', token: 'tok_again1' } }))).toMatchObject({ status: 409, body: { error: AGAIN_IS_STALE } })
    const second = await admin(ask(p.id, 5000, { again: { of, token: 'tok_again2' } }))
    expect(second.status).toBe(200)
    expect(second.body.data.already).toBeUndefined()
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2)
    expect(mocks.refundPayment.mock.calls[1][0].idempotencyKey).toBe(refundKey(p.id, ['chg_1'], 5000, 1))
    expect((await getPartyRecord(p.id))!.refunds!.map((f) => f.cents)).toEqual([5000, 5000])
    // The same "Refund again" retried: nothing more.
    expect((await admin(ask(p.id, 5000, { again: { of, token: 'tok_again2' } }))).status).toBe(200)
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2)
  })
})

describe('one email per request (R30)', () => {
  it("Square's webhook finishes it first, then the asker's retry: one refund on the party, one email, one audit", async () => {
    const p = await party()
    await recordPartyPayment(p.paymentId, p.id, 'chg_1')
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await admin(ask(p.id, 5000, { attempt: 'tok_hook01' }))
    const sq = { id: 'RF_hook_1', status: 'COMPLETED', amount_money: { amount: 5000, currency: 'USD' }, payment_id: p.paymentId }
    expect(await handleRefund(sq, new Date())).toEqual({ action: 'ignored', why: 'ours' })
    const retry = await admin(ask(p.id, 5000, { attempt: 'tok_hook01' }))
    expect(retry.status).toBe(200)
    expect(retry.body.data).toMatchObject({ refundId: 'RF_hook_1', emailed: true })
    expect(await handleRefund(sq, new Date())).toMatchObject({ action: 'ignored' })
    const after = (await getPartyRecord(p.id))!
    expect(after.refunds).toEqual([expect.objectContaining({ cents: 5000, role: 'owner', squareRefundId: 'RF_hook_1' })])
    expect(mocks.email).toHaveBeenCalledTimes(1)
    expect(mocks.audit.mock.calls.filter((c) => c[0].action === 'party-refund')).toHaveLength(1)
    expect((await listRefundRequests('party', p.id))[0]).toMatchObject({ status: 'done', squareRefundId: 'RF_hook_1' })
  })
})

describe('fix round 1', () => {
  it('"It went through", then Square\'s refund arrives (webhook and nightly): one entry, which learns the Square id; one email', async () => {
    const p = await party()
    await recordPartyPayment(p.paymentId, p.id, 'chg_1')
    mocks.refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await admin(ask(p.id, 5000))
    const requestId = (await requests(p.id)).body.data.requests[0].requestId
    expect((await admin({ action: 'clear', partyId: p.id, requestId, outcome: 'went-through', reason: 'Saw it' })).status).toBe(200)
    const sq = { id: 'RF_late_1', status: 'COMPLETED', amount_money: { amount: 5000, currency: 'USD' }, payment_id: p.paymentId }
    expect(await handleRefund(sq, new Date())).toEqual({ action: 'ignored', why: 'ours' })
    expect(await handleRefund(sq, new Date())).toMatchObject({ action: 'ignored' })
    const after = (await getPartyRecord(p.id))!
    expect(after.refunds).toEqual([expect.objectContaining({ cents: 5000, role: 'owner', requestId, squareRefundId: 'RF_late_1' })])
    expect((await listRefundRequests('party', p.id))[0]).toMatchObject({ status: 'done', squareRefundId: 'RF_late_1' })
    expect(mocks.email).toHaveBeenCalledTimes(1)
    // A different Square refund of the same amount is its own money.
    expect(await handleRefund({ ...sq, id: 'RF_other_1' }, new Date())).toMatchObject({ action: 'recorded', recordedCents: 5000 })
    expect((await getPartyRecord(p.id))!.refunds!.map((f) => f.role)).toEqual(['owner', 'square'])
  })

  it('a turned-down refund sent again once the payment reached Square\'s 20-refund cap is refused plainly', async () => {
    const nineteen = (id: string): PartyRefund[] => Array.from({ length: 19 }, (_, i) => ({
      id: `prf_${i}`, chargeId: 'chg_1', paymentId: `pay_${id}`, cents: 100, reason: '', by: null, role: 'owner',
      squareRefundId: `sq19_${i}`, requestId: null, at: '2026-10-19T00:00:00.000Z',
    }))
    const p = await party((id) => ({ refunds: nineteen(id) }))
    mocks.refundPayment.mockResolvedValueOnce({ id: 'rf_no', status: 'FAILED' })
    expect((await admin(ask(p.id, 1000, { attempt: 'tok_cap001' }))).status).toBe(502)
    await recordSquarePartyRefund(p.id, 'chg_1', { id: 'sq_20th', paymentId: p.paymentId, cents: 100 })
    const again = await admin(ask(p.id, 1000, { attempt: 'tok_cap001' }))
    expect(again).toMatchObject({ status: 409, body: { error: 'This payment has had 20 refunds, the most Square allows on one payment.' } })
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1)
  })
})
