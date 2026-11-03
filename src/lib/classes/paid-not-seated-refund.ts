/**
 * "Paid, no seat" › Refund it: Square shows one of our online class bookings
 * paid, with no seat to give it (its seats were let go, or a second payment
 * on a booking already paid). The refund goes through the shared refund
 * runner (booking-core/refund-runner): the request is saved before Square is
 * called, a retry re-sends the same key (never twice), the customer gets the
 * refund email once, it is audited once. Saved requests use the scope
 * PAID_NOT_SEATED_SCOPE with the paid-not-seated entry id as the booking.
 *
 * Square is read first (the payment and every refund on it): money it already
 * sent back is noted on the item and never refunded twice. Server only.
 */
import { recordAudit } from '@lib/audit'
import { sendRefundEmail } from '@lib/email'
import { formatMoney } from '@lib/money'
import type { By } from '@lib/staff-auth'
import { assertClassWritesAllowed } from './test-site-guard'
import { PAID_NOT_SEATED_SCOPE, retrySavedRequest, runRefund, type RefundBook } from '@lib/booking-core/refund-runner'
import { RefundError, refundKeyRaw } from '@lib/booking-core/refund-words'
import { alreadyRefundedText, backText, PaidElsewhereError, refundedNote, squareSays, unfinishedRefund } from '@lib/parties/paid-elsewhere'
import { getClass } from './class-store'
import { getLedger } from './seat-ledger'
import { hashOf, listRefundRequests, type SavedRefundRequest } from './refund-requests'
import { squareFetch } from './square-api'
import { getPaidNotSeated, notePaidNotSeated, resolvePaidNotSeated, type PaidNotSeated } from './square-events'
import type { Cents } from './types'

export const PNS_NOT_WAITING = 'This isn’t waiting any more.'
export const PNS_SEATED = 'They have their seat now, and this payment pays for it. Refund it from the class booking if it should go back.'

/** The customer on the Square order, read only (name and email for the confirm and the refund email). Null when none or unreadable. */
export async function pnsCustomer(customerId: string | null): Promise<{ givenName: string; familyName: string; email: string } | null> {
  if (!customerId) return null
  try {
    const c = (await squareFetch(`/customers/${encodeURIComponent(customerId)}`, { method: 'GET' }))?.customer
    if (!c) return null
    return { givenName: String(c.given_name ?? ''), familyName: String(c.family_name ?? ''), email: String(c.email_address ?? '') }
  } catch {
    return null
  }
}

export interface PnsRefunded { paidId: string; classId: string; className: string; firstName: string; email: string; why: PaidNotSeated['why'] }

const inputHashOf = (paidId: string, paymentId: string, cents: Cents) => hashOf('class-paid-not-seated-refund', paidId, paymentId, cents)

const waiting = async (paidId: string) => {
  const p = await getPaidNotSeated(paidId)
  return p && !p.resolved && p.paymentId ? p : null
}

/** The paid-no-seat side of the shared refund runner (built for an ask, or resolved from its scope by refund-books). */
export async function paidNotSeatedRefundBook(
  paidId: string, opts: { entry?: PaidNotSeated | null; customer?: Awaited<ReturnType<typeof pnsCustomer>>; cents?: Cents } = {},
): Promise<RefundBook<PnsRefunded>> {
  const entry = opts.entry !== undefined ? opts.entry : await getPaidNotSeated(paidId).catch(() => null)
  const customer = opts.customer !== undefined ? opts.customer : await pnsCustomer(entry?.customerId ?? null)
  const cls = entry ? await getClass(entry.classId).catch(() => null) : null
  const cents = opts.cents ?? entry?.chargedCents ?? 0
  const shown: PnsRefunded = {
    paidId, classId: entry?.classId ?? '', className: cls?.content.name ?? 'your class',
    firstName: customer?.givenName.trim().split(/\s+/)[0] ?? '', email: customer?.email ?? '', why: entry?.why ?? 'no-seats',
  }
  const label = shown.firstName ? `${shown.firstName}’s payment` : 'a class payment'
  return {
    scope: { classId: PAID_NOT_SEATED_SCOPE, bookingId: paidId },
    label,
    kind: 'paid-not-seated',
    logTag: 'classes/paid-not-seated-refund',
    unreachable: 'The class payments couldn’t be reached. Try again.',
    inputHash: entry?.paymentId ? inputHashOf(paidId, entry.paymentId, cents) : '',
    async plan() {
      const now = await waiting(paidId)
      if (!now || !entry || now.paymentId !== entry.paymentId) throw new RefundError(404, PNS_NOT_WAITING)
      if (cents <= 0 || cents > now.chargedCents) throw new RefundError(409, PNS_NOT_WAITING)
      // Seated meanwhile (by an owner, or the customer's own retry): this payment pays for that seat now.
      if ((await getLedger(now.classId)).lines.some((l) => l.bookingId === now.bookingId && l.square.orderId === now.orderId && (l.state === 'confirmed' || l.state === 'refunded'))) {
        throw new RefundError(409, PNS_SEATED, { reload: true })
      }
      const saved = await listRefundRequests(PAID_NOT_SEATED_SCOPE, paidId)
      const rawKey = refundKeyRaw(`pns:${paidId}`, [now.paymentId!], cents, 0)
      const failures = saved.filter((s) => s.rawKey === rawKey).reduce((m, s) => Math.max(m, s.failures), 0)
      return { lines: [{ id: now.paymentId!, cents }], totalCents: cents, paymentId: now.paymentId!, freeSeat: false, prior: 0, failures, rawKey }
    },
    stillFits: async () => !!(await waiting(paidId)),
    noteFailed: async () => undefined,
    // Refunded: the entry is resolved (it leaves To decide and is never raised again: the order echo is resolved).
    async write(r) {
      await resolvePaidNotSeated(paidId, r.by, 'refunded')
      return shown
    },
    current: async () => shown,
    describe: async (r: SavedRefundRequest) => ({ requestId: r.id, status: r.status, cents: r.totalCents, at: r.createdAt, by: r.by }),
    canEmail: (_r, w) => !!w.email,
    async email(r, w) {
      return (await sendRefundEmail({
        to: w.email, givenName: w.firstName, className: w.className, cents: r.totalCents, keptSeat: false,
        duplicate: w.why === 'other-order' ? 'class-twice' as const : 'class-no-seats' as const,
      })).sent
    },
    audit: (r, squareRefundId, how) => recordAudit({
      by: { ...r.by, role: r.role },
      action: 'class-paid-not-seated-refund',
      target: { kind: 'class', id: shown.classId || paidId, label: shown.className },
      details: { paidId, paymentId: r.paymentId, cents: r.totalCents, reason: r.reason, requestId: r.id, squareRefundId, ...(how ? { via: how } : {}) },
    }),
    auditCheck: (r, cleared) => recordAudit({
      by: { ...cleared.by, role: cleared.role },
      action: 'class-paid-not-seated-refund-checked',
      target: { kind: 'class', id: shown.classId || paidId, label: shown.className },
      details: { paidId, requestId: r.id, outcome: cleared.outcome, reason: cleared.reason, cents: r.totalCents },
    }),
  }
}

/**
 * "Refund it" on Paid, no seat: exactly that Square payment (what Square
 * shows left on it). A refund already started is continued with its own key.
 * `cents` = what the owner confirmed: refused when Square now shows a
 * different amount left. Throws RefundError.
 */
export async function refundPaidNotSeated(
  paidId: string, reason: string, by: By, opts: { cents?: Cents; now?: Date } = {},
): Promise<{ cents: Cents; emailed: boolean; firstName: string; email: string }> {
  assertClassWritesAllowed()
  const entry = await waiting(paidId)
  const saved = await listRefundRequests(PAID_NOT_SEATED_SCOPE, paidId)
  if (!entry) {
    const done = saved.find((r) => r.status === 'done')
    if (done) return { cents: done.totalCents, emailed: !!done.emailedAt, firstName: '', email: '' }
    throw new RefundError(404, PNS_NOT_WAITING)
  }
  const actor = { by, role: 'owner' as const }
  const going = unfinishedRefund(saved)
  if (going) {
    const out = await finalAnswer(entry, async () => retrySavedRequest(await paidNotSeatedRefundBook(paidId, { entry, cents: going.totalCents }), going.id, actor), opts.now)
    return { cents: out.cents, emailed: out.emailed, firstName: out.written.firstName, email: out.written.email }
  }
  const sq = await readSquare(entry.paymentId!)
  const total = sq.amountCents || entry.chargedCents
  const left = Math.max(0, total - sq.backCents)
  const at = (opts.now ?? new Date()).toISOString()
  await notePaidNotSeated(paidId, refundedNote(sq, at))
  if (left <= 0) throw new RefundError(409, `Square shows this ${formatMoney(total)} payment already refunded, so nothing more was refunded. Tap It’s already sorted to clear this.`, { reload: true })
  const shown = opts.cents ?? (entry.chargedCents - (entry.squareRefunded?.cents ?? 0))
  if (shown !== left) {
    throw new RefundError(409, `${backText(sq.backCents, total)}, so ${formatMoney(left)} is left. Look at it again before refunding. Nothing was refunded.`, { reload: true })
  }
  const book = await paidNotSeatedRefundBook(paidId, { entry, cents: left })
  const out = await finalAnswer(entry, () => runRefund(book, { reason }, actor), opts.now)
  return { cents: out.cents, emailed: out.emailed, firstName: out.written.firstName, email: out.written.email }
}

async function readSquare(paymentId: string) {
  try {
    return await squareSays(paymentId)
  } catch (e) {
    if (e instanceof PaidElsewhereError) throw new RefundError(e.status, e.message)
    throw e
  }
}

async function finalAnswer<T>(entry: PaidNotSeated, fn: () => Promise<T>, now?: Date): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof RefundError) || e.extra?.squareSaid !== 'already-refunded') throw e
    const sq = await squareSays(entry.paymentId!).catch(() => null)
    if (sq) await notePaidNotSeated(entry.id, refundedNote(sq, (now ?? new Date()).toISOString())).catch(() => undefined)
    throw new RefundError(409, alreadyRefundedText(e.message, sq, entry.chargedCents), { reload: true })
  }
}
