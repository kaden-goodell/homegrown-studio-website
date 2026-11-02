/**
 * Stage 4 (R1/R2): refunding a reader payment that isn't a seat's, from
 * /admin › To decide (never the Square dashboard):
 *   - "Refund it and let the seat go": Square shows a payment for a reader
 *     sale that didn't match (a different amount, another location, split…)
 *   - "Refund it": a second reader payment for a sale that was already paid
 *
 * One request per Square payment, through the shared refund runner
 * (booking-core/refund-runner): the request is saved before Square is called,
 * a retry re-sends the same key (Square never refunds twice), the customer
 * gets the refund email once, it is audited once. Scope READER_SCOPE,
 * bookingId `{reader booking id}~{payment id}`.
 *
 * The payment is read from Square first: what it shows already refunded is
 * never refunded again, and a cash or outside payment is refused (it can't go
 * back to a card). Server only.
 */
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import type { By } from '@lib/staff-auth'
import { READER_SCOPE, runRefund, type RefundBook } from '@lib/booking-core/refund-runner'
import { RefundError, refundKeyRaw } from '@lib/booking-core/refund-words'
import { hashOf, listRefundRequests, type SavedRefundRequest } from './refund-requests'
import { getReaderSale, updateReaderSale, type ReaderSale } from './reader-store'
import { squareFetch } from './square-api'
import type { Cents } from './types'

export const readerRefundRef = (bookingId: string, paymentId: string) => `${bookingId}~${paymentId}`

function parseRef(ref: string): { bookingId: string; paymentId: string } | null {
  const i = ref.lastIndexOf('~')
  return i > 0 && i < ref.length - 1 ? { bookingId: ref.slice(0, i), paymentId: ref.slice(i + 1) } : null
}

/** What a refund on a reader payment is for: the order that didn't match, or a second payment. */
export type ReaderRefundFor = 'mismatch' | 'extra'

export interface ReaderRefunded { bookingId: string; paymentId: string; orderId: string; firstName: string; email: string; className: string; keptSeat: boolean }

/** The order a payment is on, when it is one an owner may refund now (an undecided mismatch or second payment). */
function targetOf(sale: ReaderSale, paymentId: string, orderId?: string): { orderId: string; why: ReaderRefundFor } | null {
  const extra = (sale.extraPayments ?? []).find((x) => !x.decided && x.paymentIds.includes(paymentId) && (!orderId || x.orderId === orderId))
  if (extra) return { orderId: extra.orderId, why: 'extra' }
  if (sale.state === 'waiting' && sale.problem && (!orderId || sale.problem.orderId === orderId)) return { orderId: sale.problem.orderId, why: 'mismatch' }
  return null
}

/** What Square shows on a payment: how much, how much went back already, and how it was paid. Throws RefundError 503 when unreachable. */
export async function readPayment(paymentId: string): Promise<{ amountCents: Cents; backCents: Cents; status: string; sourceType: string; orderId: string | null; last4: string | null }> {
  let p: any
  try {
    p = (await squareFetch(`/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' }))?.payment
  } catch {
    throw new RefundError(503, 'Couldn’t reach Square to check the payment first. Nothing was refunded. Try again in a minute.')
  }
  if (!p) throw new RefundError(503, 'Couldn’t reach Square to check the payment first. Nothing was refunded. Try again in a minute.')
  const n = (m: any) => (typeof m?.amount === 'number' ? m.amount : Number(m?.amount) || 0)
  return {
    // Everything they paid on it, a tip included: a payment that isn't a seat's goes back whole.
    amountCents: p.total_money ? n(p.total_money) : n(p.amount_money),
    backCents: n(p.refunded_money),
    status: String(p.status ?? ''),
    sourceType: String(p.source_type ?? ''),
    orderId: typeof p.order_id === 'string' ? p.order_id : null,
    last4: typeof p.card_details?.card?.last_4 === 'string' ? p.card_details.card.last_4 : null,
  }
}

/** Refused: cash or an outside payment can't be sent back to a card from here. */
export const NOT_A_CARD = 'That payment wasn’t by card or gift card, so it can’t be refunded from here. Keep it instead, or give the money back in person.'

/** The reader side of the shared refund runner (built for an ask, or resolved from its scope by refund-books). */
export async function readerRefundBook(ref: string, opts: { orderId?: string } = {}): Promise<RefundBook<ReaderRefunded>> {
  const parsed = parseRef(ref)
  const sale = parsed ? await getReaderSale(parsed.bookingId).catch(() => null) : null
  const paymentId = parsed?.paymentId ?? ''
  const target = sale ? targetOf(sale, paymentId, opts.orderId) : null
  const shown: ReaderRefunded = {
    bookingId: parsed?.bookingId ?? '', paymentId, orderId: target?.orderId ?? opts.orderId ?? '',
    firstName: sale?.customer.givenName.trim().split(/\s+/)[0] ?? '', email: sale?.customer.email ?? '', className: sale?.className ?? 'your class',
    // A second payment refunded: their seat stays (it's paid by the first one).
    keptSeat: target?.why === 'extra' || sale?.state === 'paid',
  }
  const audited = (r: SavedRefundRequest) => ({ ...r.by, role: r.role })
  return {
    scope: { classId: READER_SCOPE, bookingId: ref },
    label: shown.firstName ? `${shown.firstName}’s reader payment` : 'a reader payment',
    kind: 'reader-payment',
    logTag: 'classes/reader-refund',
    unreachable: 'The reader sales couldn’t be reached. Try again.',
    inputHash: hashOf('reader-refund', ref),
    async plan() {
      const fresh = parsed ? await getReaderSale(parsed.bookingId) : null
      if (!fresh || !targetOf(fresh, paymentId, opts.orderId)) throw new RefundError(404, 'This isn’t waiting any more.')
      const sq = await readPayment(paymentId)
      if (sq.status !== 'COMPLETED') throw new RefundError(409, 'Square doesn’t show that payment as finished, so nothing was refunded. Try again in a few minutes.')
      if (/^(CASH|EXTERNAL)$/i.test(sq.sourceType)) throw new RefundError(409, NOT_A_CARD)
      const left = Math.max(0, sq.amountCents - sq.backCents)
      if (left <= 0) throw new RefundError(409, 'Square shows this payment already refunded, so nothing more was refunded.', { squareSaid: 'already-refunded' })
      const saved = await listRefundRequests(READER_SCOPE, ref)
      const rawKey = refundKeyRaw(`rdr:${ref}`, [paymentId], left, 0)
      const failures = saved.filter((s) => s.rawKey === rawKey).reduce((m, s) => Math.max(m, s.failures), 0)
      return { lines: [{ id: paymentId, cents: left }], totalCents: left, paymentId, freeSeat: false, prior: 0, failures, rawKey }
    },
    stillFits: async () => {
      const fresh = parsed ? await getReaderSale(parsed.bookingId).catch(() => null) : null
      return !!fresh && !!targetOf(fresh, paymentId, opts.orderId)
    },
    noteFailed: async () => undefined,
    // Idempotent by request id: a replay writes nothing twice.
    async write(r, squareRefundId) {
      if (parsed) {
        await updateReaderSale(parsed.bookingId, (cur) => ((cur.refunds ?? []).some((x) => x.requestId === r.id) ? null : {
          ...cur,
          refunds: [...(cur.refunds ?? []), { paymentId, orderId: shown.orderId, cents: r.totalCents, squareRefundId: squareRefundId ?? null, requestId: r.id, at: new Date().toISOString(), by: r.by }],
        }))
      }
      return shown
    },
    current: async () => shown,
    describe: async (r: SavedRefundRequest) => ({ requestId: r.id, status: r.status, cents: r.totalCents, at: r.createdAt, by: r.by }),
    canEmail: (_r, w) => !!w.email,
    async email(r, w) {
      return (await sendRefundEmail({ to: w.email, givenName: w.firstName, className: w.className, cents: r.totalCents, keptSeat: w.keptSeat })).sent
    },
    audit: (r, squareRefundId, how) => recordAudit({
      by: audited(r), action: 'seat.reader-refund',
      target: { kind: 'workshop', id: sale?.classId ?? shown.bookingId, label: shown.className },
      details: { bookingId: shown.bookingId, orderId: shown.orderId, paymentId, cents: r.totalCents, reason: r.reason, requestId: r.id, squareRefundId, ...(how ? { via: how } : {}) },
    }),
    auditCheck: (r, cleared) => recordAudit({
      by: { ...cleared.by, role: cleared.role }, action: 'seat.reader-refund-checked',
      target: { kind: 'workshop', id: sale?.classId ?? shown.bookingId, label: shown.className },
      details: { bookingId: shown.bookingId, paymentId, requestId: r.id, outcome: cleared.outcome, cents: r.totalCents },
    }),
  }
}

/**
 * Refunds every payment on one order of a reader sale (exactly what Square
 * shows left on each). A payment Square already refunded counts as done.
 * Throws RefundError (nothing more is sent after the first refusal).
 */
export async function refundReaderPayments(
  bookingId: string, orderId: string, paymentIds: string[], reason: string, by: By,
): Promise<{ cents: Cents; emailed: boolean }> {
  let cents = 0
  let emailed = false
  for (const paymentId of paymentIds) {
    const book = await readerRefundBook(readerRefundRef(bookingId, paymentId), { orderId })
    try {
      const r = await runRefund(book, { reason }, { by, role: 'owner' })
      cents += r.cents
      emailed = emailed || r.emailed
    } catch (e) {
      if (e instanceof RefundError && e.extra?.squareSaid === 'already-refunded') continue
      throw e
    }
  }
  return { cents, emailed }
}
