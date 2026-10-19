// @vitest-environment node
/**
 * The party refund book (src/lib/parties/refunds.ts): every RefundBook field,
 * planning one charge, writing a request once (by request id and Square
 * refund id), refunds made in Square recorded once, and the static scope →
 * book list in booking-core/refund-books.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ audit: vi.fn(async () => undefined), email: vi.fn(async () => ({ sent: true })) }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/email', () => ({ sendRefundEmail: mocks.email }))

import { createPartyRecord, getPartyRecord, type PartyRecord, type PartyRefund } from '@lib/party-store'
import { partyLabel, partyRefundBook, planPartyRefund, recordSquarePartyRefund, MORE_THAN_LEFT } from '@lib/parties/refunds'
import { refundBookFor } from '@lib/booking-core/refund-books'
import { NOT_PAID_HERE, refundKeyRaw } from '@lib/booking-core/refund-words'
import type { SavedRefundRequest } from '@lib/classes/refund-requests'

let n = 0
const uid = (p: string) => `${p}${++n}${Date.now().toString(36)}`
function record(over: Partial<PartyRecord> = {}): PartyRecord {
  const id = uid('pty_')
  return {
    bookingId: id, hostToken: 't', craftName: 'Pails', startIso: '2026-11-14T19:30:00.000Z', durationMinutes: 90, hostName: 'Stefanie Justice',
    hostEmail: 'stef@example.com', guestCount: 12, title: null, dropOff: false, createdAt: '2026-10-19T00:00:00.000Z', source: 'ours', status: 'booked',
    items: [{ id: 'itm_pkg', kind: 'package', refId: 'pkg_whole', label: 'Whole Studio Party — studio fee', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId: 'chg_1', addedAt: '', by: null }],
    charges: [{ id: 'chg_1', via: 'online', orderId: 'o1', paymentId: `pay_${id}`, cents: 30000, quotedCents: 30000, itemIds: ['itm_pkg'], receiptUrl: null, at: '', by: null }],
    refunds: [],
    ...over,
  }
}
const refund = (r: PartyRecord, cents: number, role: PartyRefund['role']): PartyRefund => ({
  id: uid('prf_'), chargeId: 'chg_1', paymentId: r.charges![0].paymentId, cents, reason: '', by: null, role, squareRefundId: uid('sq_'), requestId: null, at: '',
})
const saved = (r: PartyRecord, over: Partial<SavedRefundRequest> = {}): SavedRefundRequest => ({
  id: uid('req'), inputHash: 'h', classId: 'party', bookingId: r.bookingId, paymentId: r.charges![0].paymentId, kind: 'amount', freeSeat: false,
  reason: 'Sick', by: { id: 'k', name: 'Kaden' }, role: 'owner', lines: [{ id: 'chg_1', cents: 5000 }], totalCents: 5000, prior: 0,
  rawKey: 'raw', failures: 0, idempotencyKey: 'refund:x', status: 'sent', squareRefundId: null, answered: false, createdAt: '', updatedAt: '',
  ...over,
})

beforeEach(() => { mocks.audit.mockClear(); mocks.email.mockClear() })

describe('partyLabel', () => {
  it('names the party by the host\'s last name', () => {
    expect(partyLabel({ hostName: 'Stefanie Justice' })).toBe('the Justice party')
    expect(partyLabel({ hostName: '  ' })).toBe('the party')
  })
})

describe('partyRefundBook', () => {
  it('implements every field of the RefundBook interface', async () => {
    const r = record()
    await createPartyRecord(r)
    const book = (await partyRefundBook(r.bookingId, { ask: { partyId: r.bookingId, chargeId: 'chg_1', cents: 100, reason: '' } }))!
    const fields = ['scope', 'label', 'kind', 'logTag', 'unreachable', 'inputHash', 'plan', 'stillFits', 'noteFailed', 'write', 'afterWrite', 'current', 'describe', 'canEmail', 'email', 'audit', 'auditCheck']
    for (const f of fields) expect(book[f as keyof typeof book], f).toBeDefined()
    expect(book).toMatchObject({ scope: { classId: 'party', bookingId: r.bookingId }, label: 'the Justice party', kind: 'amount', logTag: 'parties/refund' })
    expect(book.inputHash).not.toBe('')
    expect(await partyRefundBook('pty_nothere')).toBeNull()
  })

  it('a book from the scope alone writes but cannot plan', async () => {
    const r = record()
    await createPartyRecord(r)
    const book = (await partyRefundBook(r.bookingId))!
    expect(book.inputHash).toBe('')
    await expect(book.plan()).rejects.toMatchObject({ status: 400 })
  })

  it('write is once per request and per Square refund; a refund Square already recorded becomes the request\'s', async () => {
    const r = record()
    await createPartyRecord(r)
    const book = (await partyRefundBook(r.bookingId))!
    const req = saved(r)
    await book.write(req, null)
    await book.write(req, null)
    let now = (await getPartyRecord(r.bookingId))!
    expect(now.refunds).toEqual([expect.objectContaining({ requestId: req.id, cents: 5000, squareRefundId: null, role: 'owner' })])
    // Square's id arrives later: kept on the same entry, no new money.
    await book.write(req, 'sq_late')
    now = (await getPartyRecord(r.bookingId))!
    expect(now.refunds).toEqual([expect.objectContaining({ requestId: req.id, squareRefundId: 'sq_late' })])
    // A refund Square's webhook recorded as made in Square, then claimed as ours: adopted, not added.
    await recordSquarePartyRefund(r.bookingId, 'chg_1', { id: 'sq_2', paymentId: r.charges![0].paymentId, cents: 2000 })
    const req2 = saved(r, { totalCents: 2000, lines: [{ id: 'chg_1', cents: 2000 }] })
    await book.write(req2, 'sq_2')
    now = (await getPartyRecord(r.bookingId))!
    expect(now.refunds!.map((f) => [f.cents, f.role, f.requestId])).toEqual([[5000, 'owner', req.id], [2000, 'owner', req2.id]])
    // The party itself is untouched.
    expect(now).toMatchObject({ status: 'booked', items: r.items, charges: r.charges, startIso: r.startIso })
  })

  it('the email names the party and whether they are still booked; the audits name the party', async () => {
    const r = record()
    await createPartyRecord(r)
    const book = (await partyRefundBook(r.bookingId))!
    const req = saved(r)
    expect(book.canEmail(req, { ...r, hostEmail: '' })).toBe(false)
    expect(await book.email(req, r)).toBe(true)
    expect(mocks.email).toHaveBeenCalledWith({ to: 'stef@example.com', givenName: 'Stefanie', className: 'the Justice party', cents: 5000, keptSeat: true })
    await book.audit(req, 'sq_1', 'square-webhook')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'party-refund', target: { kind: 'party', id: r.bookingId, label: 'the Justice party' }, details: expect.objectContaining({ via: 'square-webhook' }) }))
    await book.auditCheck(req, { at: '', by: { id: 'sam', name: 'Sam' }, role: 'crew', outcome: 'did-not-go-through', reason: 'Not there' })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'party-refund-checked', by: { id: 'sam', name: 'Sam', role: 'crew' } }))
  })
})

describe('planPartyRefund', () => {
  it('one charge, up to what it has left; the key leaves out refunds made in Square; failures come from the saved requests', () => {
    const r = record()
    r.refunds = [refund(r, 1000, 'owner'), refund(r, 1000, 'square')]
    const plan = planPartyRefund(r, { partyId: r.bookingId, chargeId: 'chg_1', cents: 28000 }, [])
    expect(plan).toMatchObject({ lines: [{ id: 'chg_1', cents: 28000 }], totalCents: 28000, paymentId: r.charges![0].paymentId, freeSeat: false, prior: 1, failures: 0 })
    expect(() => planPartyRefund(r, { partyId: r.bookingId, chargeId: 'chg_1', cents: 28001 }, [])).toThrow(MORE_THAN_LEFT)
    const raw = refundKeyRaw(r.bookingId, ['chg_1'], 500, 1)
    expect(planPartyRefund(r, { partyId: r.bookingId, chargeId: 'chg_1', cents: 500 }, [saved(r, { rawKey: raw, failures: 2, status: 'turned-down' })]).failures).toBe(2)
    expect(() => planPartyRefund(record({ source: undefined }), { partyId: 'x', chargeId: 'chg_1', cents: 1 }, [])).toThrow(NOT_PAID_HERE)
    expect(() => planPartyRefund(r, { partyId: r.bookingId, chargeId: 'chg_1', cents: 0 }, [])).toThrow('Enter an amount to refund.')
    expect(() => planPartyRefund(r, { partyId: r.bookingId, chargeId: 'chg_1', cents: 1.5 }, [])).toThrow('Enter an amount to refund.')
  })
})

describe('recordSquarePartyRefund', () => {
  it('records a refund made in Square once, as money on that charge', async () => {
    const r = record()
    await createPartyRecord(r)
    const sq = { id: 'sq_once', paymentId: r.charges![0].paymentId, cents: 7500 }
    expect(await recordSquarePartyRefund(r.bookingId, 'chg_1', sq)).toBe(7500)
    expect(await recordSquarePartyRefund(r.bookingId, 'chg_1', sq)).toBe(0)
    expect((await getPartyRecord(r.bookingId))!.refunds).toEqual([expect.objectContaining({ cents: 7500, role: 'square', by: { id: 'square', name: 'Square' }, requestId: null, squareRefundId: 'sq_once' })])
  })
})

describe('booking-core/refund-books', () => {
  it("'party' → the party book; a class id → the class book; anything else throws", async () => {
    const r = record()
    await createPartyRecord(r)
    expect((await refundBookFor({ classId: 'party', bookingId: r.bookingId }))?.logTag).toBe('parties/refund')
    expect((await refundBookFor({ classId: 'cls_any', bookingId: 'bkg_1' }))?.logTag).toBe('classes/refund')
    await expect(refundBookFor({ classId: 'kits', bookingId: 'x' })).rejects.toThrow(/No refund book/)
  })
})
