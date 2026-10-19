// @vitest-environment node
/**
 * The shared refund runner, driven by a fake in-memory book (no class, no
 * ledger): saved requests before Square (R29), the same ask continues the same
 * request and key, "Already refunded" / "Refund again" (R31), turned down,
 * no answer, a save that fails after Square took it, and one email + one
 * audit whoever finishes it (R30).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refundPayment = vi.hoisted(() => vi.fn())
vi.mock('@config/providers', () => ({ providers: { payment: { refundPayment } } }))

import {
  claimSquareRefundWith, clearRequest, runRefund,
  type RefundBook, type RefundScope,
} from '@lib/booking-core/refund-runner'
import { refundBookFor } from '@lib/booking-core/refund-books'
import {
  AGAIN_IS_STALE, RefundError, refundKey, refundKeyRaw, SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE,
  type RefundPlan,
} from '@lib/booking-core/refund-words'
import { hashOf, listRefundRequests, type SavedRefundRequest } from '@lib/classes/refund-requests'

const owner = { by: { id: 'owner1', name: 'Owner' }, role: 'owner' as const }
const crew = { by: { id: 'sam', name: 'Sam' }, role: 'crew' as const }

interface Written { requestId: string; squareRefundId: string | null; cents: number }

/** One fake booking: what was written, emails, audits, failures. */
function fakeBooking(bookingId = `bk_${Math.random().toString(36).slice(2, 10)}`) {
  const state = {
    written: [] as Written[],
    failures: {} as Record<string, number>,
    emails: [] as string[],
    audits: [] as { id: string; squareRefundId: string; how?: string }[],
    checks: [] as string[],
    afterWrites: 0,
    planned: 0,
    writeFails: 0,
    emailWorks: true,
  }
  const scope = { classId: 'fake', bookingId }
  const book = (cents: number): RefundBook<Written[]> => ({
    scope,
    label: 'the Fake booking',
    kind: 'custom',
    logTag: 'fake/refund',
    unreachable: "The fake records couldn't be reached. Try again.",
    inputHash: hashOf('fake', bookingId, cents),
    async plan(): Promise<RefundPlan> {
      state.planned++
      const left = 10_000 - state.written.reduce((s, w) => s + w.cents, 0)
      if (cents > left) throw new RefundError(400, 'That is more than is left to refund on this booking.')
      const prior = new Set(state.written.map((w) => w.squareRefundId ?? w.requestId)).size
      const rawKey = refundKeyRaw(bookingId, ['x'], cents, prior)
      return { lines: [{ id: 'x', cents }], totalCents: cents, paymentId: 'pay_1', freeSeat: false, prior, failures: state.failures[rawKey] ?? 0, rawKey }
    },
    async stillFits(rec) {
      return rec.totalCents <= 10_000 - state.written.reduce((s, w) => s + w.cents, 0)
    },
    async noteFailed(rawKey) {
      state.failures[rawKey] = (state.failures[rawKey] ?? 0) + 1
    },
    async write(rec, squareRefundId) {
      if (state.writeFails > 0) { state.writeFails--; throw new Error('blob down') }
      if (!state.written.some((w) => w.requestId === rec.id)) state.written.push({ requestId: rec.id, squareRefundId, cents: rec.totalCents })
      return state.written.filter((w) => w.requestId === rec.id)
    },
    async afterWrite() { state.afterWrites++ },
    async current(rec) { return state.written.filter((w) => w.requestId === rec.id) },
    async describe(rec) { return { requestId: rec.id, cents: rec.totalCents } },
    canEmail: () => true,
    async email(rec) { state.emails.push(rec.id); return state.emailWorks },
    async audit(rec, squareRefundId, how) { state.audits.push({ id: rec.id, squareRefundId, ...(how ? { how } : {}) }) },
    async auditCheck(rec) { state.checks.push(rec.id) },
  })
  return { scope, book, state }
}

let books = new Map<string, ReturnType<typeof fakeBooking>>()
/** The fake kind's books, as booking-core/refund-books finds the real ones. */
const fakeBookFor = async (s: RefundScope) => (s.classId === 'fake' ? books.get(s.bookingId)?.book(0) ?? null : null) as RefundBook<unknown> | null
const claimSquareRefund = (...a: [Parameters<typeof claimSquareRefundWith>[1], Parameters<typeof claimSquareRefundWith>[2]]) => claimSquareRefundWith(fakeBookFor, ...a)

let n = 0
beforeEach(() => {
  books = new Map()
  refundPayment.mockReset().mockImplementation(async (i: any) => ({ id: `rf_${++n}`, paymentId: i.paymentId, amountCents: i.amountCents, status: 'PENDING' }))
})
const setup = () => { const b = fakeBooking(); books.set(b.scope.bookingId, b); return b }
const refusal = async (p: Promise<unknown>) => {
  try { await p } catch (e) { return e as RefundError }
  throw new Error('expected a refusal')
}

describe('runRefund', () => {
  it('saves the request before Square, sends once, writes, emails once, audits once', async () => {
    const { book, state, scope } = setup()
    refundPayment.mockImplementationOnce(async (i: any) => {
      // The request is already saved, pending, when Square is called.
      const saved = await listRefundRequests(scope.classId, scope.bookingId)
      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({ status: 'pending', idempotencyKey: i.idempotencyKey, totalCents: 1500 })
      return { id: 'rf_a', status: 'PENDING' }
    })
    const r = await runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: 'Sick' }, owner)
    expect(r).toMatchObject({ refundId: 'rf_a', cents: 1500, freeSeat: false, emailed: true })
    expect(r.written).toEqual([{ requestId: expect.any(String), squareRefundId: 'rf_a', cents: 1500 }])
    expect(refundPayment).toHaveBeenCalledWith({ paymentId: 'pay_1', amountCents: 1500, idempotencyKey: refundKey(scope.bookingId, ['x'], 1500, 0), reason: 'Sick' })
    expect(state.emails).toHaveLength(1)
    expect(state.audits).toEqual([{ id: r.written[0].requestId, squareRefundId: 'rf_a' }])
    expect(state.afterWrites).toBe(1)
    expect((await listRefundRequests(scope.classId, scope.bookingId))[0]).toMatchObject({ status: 'done', squareRefundId: 'rf_a', answered: true, emailedAt: expect.any(String) })
  })

  it('R29: an unanswered request blocks a different ask, naming it', async () => {
    const { book, state } = setup()
    refundPayment.mockRejectedValueOnce(new Error('timeout'))
    const first = await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    expect(first).toMatchObject({ status: 502, message: SQUARE_NO_ANSWER })
    const other = await refusal(runRefund(book(700), { attempt: 'tok_bbbbbb', reason: '' }, owner))
    expect(other).toMatchObject({ status: 409, message: STILL_WAITING_ON_SQUARE, extra: { pending: { cents: 1500 } } })
    expect(refundPayment).toHaveBeenCalledTimes(1)
    expect(state.written).toEqual([])
  })

  it('no answer keeps the key: the same ask after a reload continues the saved request and sends the same key', async () => {
    const { book, state, scope } = setup()
    refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    // A reload: a new screen token, the same inputs.
    const r = await runRefund(book(1500), { attempt: 'tok_reload', reason: '' }, owner)
    expect(refundPayment).toHaveBeenCalledTimes(2)
    expect(refundPayment.mock.calls[1][0].idempotencyKey).toBe(refundPayment.mock.calls[0][0].idempotencyKey)
    expect(state.planned).toBe(1)
    expect(r.cents).toBe(1500)
    expect(await listRefundRequests(scope.classId, scope.bookingId)).toHaveLength(1)
  })

  it('a done ask answers "Already refunded" with nothing sent; "Refund again" of the latest makes a second; a stale of is refused', async () => {
    const { book, state } = setup()
    const first = await runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner)
    const again = await runRefund(book(1500), { attempt: 'tok_bbbbbb', reason: '' }, crew)
    expect(refundPayment).toHaveBeenCalledTimes(1)
    expect(again.already).toMatchObject({ message: expect.stringMatching(/^Already refunded on .+ by Owner\.$/), count: 1, latest: { cents: 1500 } })
    const of = again.already!.latest.requestId
    expect(of).toBe(first.written[0].requestId)

    const repeat = await runRefund(book(1500), { again: { of, token: 'tok_again1' }, reason: '' }, owner)
    expect(repeat.already).toBeUndefined()
    expect(refundPayment).toHaveBeenCalledTimes(2)
    expect(refundPayment.mock.calls[1][0].idempotencyKey).not.toBe(refundPayment.mock.calls[0][0].idempotencyKey)
    expect(state.written).toHaveLength(2)

    // The first one is no longer the latest: a stale screen.
    const stale = await refusal(runRefund(book(1500), { again: { of, token: 'tok_again2' }, reason: '' }, owner))
    expect(stale).toMatchObject({ status: 409, message: AGAIN_IS_STALE })
    const twice = await runRefund(book(1500), { reason: '' }, owner)
    expect(twice.already?.message).toMatch(/^Refunded twice already, last on .+ by Owner\.$/)
    expect(refundPayment).toHaveBeenCalledTimes(2)
  })

  it('turned down: nothing written, failure noted, the next try is a new key', async () => {
    const { book, state, scope } = setup()
    refundPayment.mockResolvedValueOnce({ id: 'rf_x', status: 'FAILED' })
    const e = await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    expect(e).toMatchObject({ status: 502, message: SQUARE_TURNED_DOWN })
    const raw = refundKeyRaw(scope.bookingId, ['x'], 1500, 0)
    expect(state.failures[raw]).toBe(1)
    const [rec] = await listRefundRequests(scope.classId, scope.bookingId)
    expect(rec).toMatchObject({ status: 'turned-down', failures: 1, idempotencyKey: refundKey(scope.bookingId, ['x'], 1500, 0, 1) })
    expect(state.written).toEqual([])

    await runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner)
    expect(refundPayment.mock.calls[1][0].idempotencyKey).toBe(refundKey(scope.bookingId, ['x'], 1500, 0, 1))
    expect(state.written).toHaveLength(1)
  })

  it('a save that fails after Square took it: 500, and a retry only writes', async () => {
    const { book, state } = setup()
    state.writeFails = 1
    const e = await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    expect(e).toMatchObject({ status: 500, message: "The refund went through in Square but didn't save here. Do the same refund again to save it." })
    expect(state.emails).toEqual([])
    expect(state.audits).toEqual([])
    const r = await runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner)
    expect(refundPayment).toHaveBeenCalledTimes(1)
    expect(r.refundId).toBe('rf_' + n)
    expect(state.written).toHaveLength(1)
    expect(state.emails).toHaveLength(1)
    expect(state.audits).toHaveLength(1)
  })

  it('two finishers (Square\'s webhook, then the asker\'s retry): one email, one audit', async () => {
    const { book, state, scope } = setup()
    refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    // Square's webhook sees the refund first (same payment, same amount, our request unanswered).
    expect(await claimSquareRefund({ id: 'rf_hook', paymentId: 'pay_1', cents: 1500 }, [scope])).toBe(true)
    expect(state.audits).toEqual([{ id: expect.any(String), squareRefundId: 'rf_hook', how: 'square-webhook' }])
    expect(state.emails).toHaveLength(1)
    // The asker tries again: answered as that refund, nothing sent, nothing emailed or audited again.
    const r = await runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner)
    expect(r).toMatchObject({ refundId: 'rf_hook', cents: 1500, emailed: true })
    expect(r.already).toBeUndefined()
    expect(refundPayment).toHaveBeenCalledTimes(1)
    expect(state.emails).toHaveLength(1)
    expect(state.audits).toHaveLength(1)
    // The webhook replayed: still one.
    expect(await claimSquareRefund({ id: 'rf_hook', paymentId: 'pay_1', cents: 1500 }, [scope])).toBe(true)
    expect(state.written).toHaveLength(1)
    expect(state.emails).toHaveLength(1)
    expect(state.audits).toHaveLength(1)
  })

  it('an email that did not send gives the claim back, so a later finisher may send it', async () => {
    const { book, state, scope } = setup()
    state.emailWorks = false
    const r = await runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner)
    expect(r.emailed).toBe(false)
    expect((await listRefundRequests(scope.classId, scope.bookingId))[0].emailedAt).toBeNull()
  })
})

describe('clearRequest ("I checked Square")', () => {
  it('went through: written as asked, one email, one audit + check; a second check is refused', async () => {
    const { book, state, scope } = setup()
    refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    const [rec] = await listRefundRequests(scope.classId, scope.bookingId)
    const r = await clearRequest(book(0), rec.id, 'went-through', 'Saw it', crew)
    expect(r?.written).toEqual([{ requestId: rec.id, squareRefundId: null, cents: 1500 }])
    expect(state.emails).toEqual([rec.id])
    expect(state.audits).toEqual([{ id: rec.id, squareRefundId: '', how: 'checked-in-square' }])
    expect(state.checks).toEqual([rec.id])
    expect((await listRefundRequests(scope.classId, scope.bookingId))[0]).toMatchObject({ status: 'done', answered: false, cleared: { outcome: 'went-through', by: crew.by } })
    const again = await refusal(clearRequest(book(0), rec.id, 'did-not-go-through', '', owner))
    expect(again.status).toBe(409)
  })

  it("didn't go through: nothing written, the request stops blocking; asking again re-sends its key", async () => {
    const { book, state, scope } = setup()
    refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    const [rec] = await listRefundRequests(scope.classId, scope.bookingId)
    expect(await clearRequest(book(0), rec.id, 'did-not-go-through', 'Not there', owner)).toBeNull()
    expect(state.written).toEqual([])
    expect(state.checks).toEqual([rec.id])
    await runRefund(book(1500), { attempt: 'tok_bbbbbb', reason: '' }, owner)
    expect(refundPayment.mock.calls[1][0].idempotencyKey).toBe(rec.idempotencyKey)
  })

  it('a write that fails puts it back as waiting, with the book\'s own words', async () => {
    const { book, state, scope } = setup()
    refundPayment.mockRejectedValueOnce(new Error('timeout'))
    await refusal(runRefund(book(1500), { attempt: 'tok_aaaaaa', reason: '' }, owner))
    const [rec] = await listRefundRequests(scope.classId, scope.bookingId)
    state.writeFails = 1
    const e = await refusal(clearRequest(book(0), rec.id, 'went-through', 'Saw it', owner))
    expect(e).toMatchObject({ status: 503, message: "The fake records couldn't be reached. Try again." })
    expect((await listRefundRequests(scope.classId, scope.bookingId))[0]).toMatchObject({ status: 'pending' })
    expect((await listRefundRequests(scope.classId, scope.bookingId))[0].cleared).toBeUndefined()
  })
})

describe('refundBookFor (booking-core/refund-books, a static list)', () => {
  it('a class scope gets the class book', async () => {
    const book = await refundBookFor({ classId: 'cls_none', bookingId: 'bkg_1' })
    expect(book?.scope).toEqual({ classId: 'cls_none', bookingId: 'bkg_1' })
    expect(book?.logTag).toBe('classes/refund')
  })

  it("'party' is never a class: no such party → null", async () => {
    expect(await refundBookFor({ classId: 'party', bookingId: 'pty_nothere' })).toBeNull()
  })

  it('an unknown scope throws (a wiring miss surfaces instead of recording twice)', async () => {
    await expect(refundBookFor({ classId: 'fake', bookingId: 'bk_1' })).rejects.toThrow(/No refund book/)
  })

  it('a scope with nothing to write to → Square\'s refund is not claimed', async () => {
    const lost = { classId: 'fake', bookingId: 'bk_gone' }
    expect(await fakeBookFor(lost)).toBeNull()
    expect(await claimSquareRefund({ id: 'rf_z', paymentId: 'pay_1', cents: 1 }, [lost])).toBe(false)
  })
})

// Shape check: the saved request format is unchanged (old documents keep loading).
const _shape: SavedRefundRequest['classId'] = 'party'
void _shape
