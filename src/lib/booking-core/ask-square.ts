/**
 * "Ask Square" about one of our saved refunds that got no answer: the same
 * flow wherever it shows (To decide › Refund with no answer, a class
 * booking's refund row, a party's Payments tab, /staff). It reads the
 * payment's refunds from Square (read only) and says what Square shows, with
 * only the buttons that fit:
 *
 *   done     → It went through (recorded with Square's refund id, the customer emailed once)
 *   none     → Try the refund again (the same saved key: never twice) · It didn't go through
 *   failed   → Try the refund again (a new key, the failed try turned down first) · It didn't go through
 *   pending  → nothing yet ("Ask again later")
 *
 * Each action asks Square again on the server and acts only on what it shows
 * now. The reason is filled in from Square's answer (nobody types what they
 * saw), and every action is audited with who tapped it. The runner's
 * clearRequest stays only as the server path behind It didn't go through.
 *
 * Server only.
 */
import { recordAudit } from '@lib/audit'
import { providers } from '@config/providers'
import type { By } from '@lib/staff-auth'
import { formatMoney } from '@lib/money'
import { studioDate } from '@lib/studio-time'
import { getPartyRecord } from '@lib/party-store'
import { getLedger } from '@lib/classes/seat-ledger'
import { changeRefundRequest, isWaiting, listRefundRequests, type SavedRefundRequest } from '@lib/classes/refund-requests'
import type { Cents } from '@lib/classes/types'
import { clearRequest, PARTY_SCOPE, retrySavedRequest, type RefundScope } from './refund-runner'
import { claimSquareRefund, refundBookFor } from './refund-books'
import { RefundError, refundKey } from './refund-words'

/** What Square says about one of our refunds, with the buttons that fit. */
export interface AskAnswer {
  state: 'done' | 'pending' | 'failed' | 'none'
  cents: Cents
  /** Square's refund, when one matched */
  refundId: string | null
  at: string | null
  message: string
  /** the sheet's heading for the answer, when not about a refund ("Square shows it paid") */
  title?: string
  /** the choices that fit what Square said (action names) */
  next: string[]
}

export type RequestAction = 'went-through' | 'retry' | 'did-not-go-through'
export const REQUEST_ACTIONS: readonly RequestAction[] = ['went-through', 'retry', 'did-not-go-through']

export const SQUARE_ASK_FAILED = 'Square couldn’t be asked just now. Try again in a minute. Nothing was changed.'
export const NOT_WAITING_ON_SQUARE = 'This refund isn’t waiting on Square any more. Reload to see it.'

const dayText = (iso: string | null) => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return ''
  return new Date(`${studioDate(iso)}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
}

/**
 * Square refund ids already recorded on this booking for something else (never matched again as "ours").
 * A refund already written for `exceptRequestId` itself (its money saved, the request not yet marked done)
 * is left out, so Square's refund still reads as this one and It went through finishes it.
 */
export async function knownRefundIds(scope: RefundScope, exceptRequestId = ''): Promise<Set<string>> {
  const ids = new Set<string>()
  const other = (e: { squareRefundId?: string | null; requestId?: string | null; id?: string }) => !!e.squareRefundId && (!exceptRequestId || (e.requestId ?? e.id) !== exceptRequestId)
  for (const r of await listRefundRequests(scope.classId, scope.bookingId)) if (other(r)) ids.add(r.squareRefundId!)
  if (scope.classId === PARTY_SCOPE) {
    for (const f of (await getPartyRecord(scope.bookingId).catch(() => null))?.refunds ?? []) if (other(f)) ids.add(f.squareRefundId!)
  } else if (scope.classId.startsWith('cls_')) {
    for (const l of (await getLedger(scope.classId)).lines) for (const r of l.refunds) if (other(r)) ids.add(r.squareRefundId!)
  }
  return ids
}

/**
 * Reads what Square shows for one waiting request (a refund of that amount on
 * its payment, not on our records). Read only. Throws RefundError: 404 when
 * the request isn't waiting any more, 503 when Square can't be read.
 */
export async function askAboutRequest(scope: RefundScope, requestId: string): Promise<{ req: SavedRefundRequest; answer: AskAnswer }> {
  const req = (await listRefundRequests(scope.classId, scope.bookingId)).find((r) => r.id === requestId)
  if (!req || !isWaiting(req)) throw new RefundError(404, NOT_WAITING_ON_SQUARE)
  if (!providers.payment.readPayment) throw new RefundError(503, SQUARE_ASK_FAILED)
  let pay
  try {
    pay = await providers.payment.readPayment(req.paymentId)
  } catch {
    throw new RefundError(503, SQUARE_ASK_FAILED)
  }
  const known = await knownRefundIds(scope, req.id)
  const cands = pay.refunds.filter((r) => r.amountCents === req.totalCents && !known.has(r.id))
  const amount = formatMoney(req.totalCents)
  const hit = cands.find((r) => r.status === 'COMPLETED') ?? cands.find((r) => r.status === 'PENDING') ?? cands.find((r) => /^(FAILED|REJECTED)$/.test(r.status)) ?? null
  const at = hit?.createdAt ?? null
  const answer: AskAnswer = !hit
    ? { state: 'none', cents: req.totalCents, refundId: null, at: null, next: ['retry', 'did-not-go-through'],
      message: `Square shows no ${amount} refund on this payment, so it didn’t go through. Try the refund again (it re-sends the same request, so it can never refund twice), or tap It didn’t go through to stop it here.` }
    : hit.status === 'COMPLETED'
      ? { state: 'done', cents: req.totalCents, refundId: hit.id, at, next: ['went-through'],
        message: `Square shows a ${amount} refund on this payment${dayText(at) ? `, made ${dayText(at)}` : ''}. Tap It went through to record it here (the customer gets their refund email once).` }
      : hit.status === 'PENDING'
        ? { state: 'pending', cents: req.totalCents, refundId: hit.id, at, next: [],
          message: `Square shows this ${amount} refund still going through. Ask again later. Nothing was changed.` }
        : { state: 'failed', cents: req.totalCents, refundId: hit.id, at, next: ['retry', 'did-not-go-through'],
          message: `Square shows this ${amount} refund failed, so nothing went back. Try the refund again, or tap It didn’t go through to stop it here.` }
  return { req, answer }
}

export interface RequestActed {
  /** what was done, plainly ("It went through: $30 recorded with Square’s refund") */
  what: string
  action: RequestAction
  cents: Cents
  emailed: boolean
  /** what Square showed when the action was taken */
  squareSaid: AskAnswer['state']
}

/**
 * It went through / Try the refund again / It didn't go through on a waiting
 * request: Square is asked again first, and only the action that fits what it
 * shows now goes ahead (else RefundError 409 with Square's answer). Audited
 * (`refund-ask-square`) with who tapped it and what Square showed.
 */
export async function actOnRequest(scope: RefundScope, requestId: string, action: string, actor: { by: By; role: 'owner' | 'crew' }): Promise<RequestActed> {
  if (!REQUEST_ACTIONS.includes(action as RequestAction)) throw new RefundError(400, 'Pick what to do about this refund.')
  const act = action as RequestAction
  const { req, answer } = await askAboutRequest(scope, requestId)
  const amount = formatMoney(req.totalCents)
  let out: RequestActed
  if (action === 'went-through') {
    if (answer.state !== 'done' || !answer.refundId) throw new RefundError(409, answer.message, { asked: answer })
    const claimed = await claimSquareRefund({ id: answer.refundId, paymentId: req.paymentId, cents: req.totalCents }, [scope], { requestIds: [req.id], how: 'checked-in-square' })
    if (!claimed) throw new RefundError(409, 'That refund couldn’t be matched here. Reload and ask Square again.')
    const now = (await listRefundRequests(scope.classId, scope.bookingId)).find((r) => r.id === req.id)
    out = { what: `It went through: ${amount} recorded with Square’s refund`, action: act, cents: req.totalCents, emailed: !!now?.emailedAt, squareSaid: answer.state }
  } else if (action === 'did-not-go-through') {
    if (answer.state === 'done' || answer.state === 'pending') throw new RefundError(409, answer.message, { asked: answer })
    const book = await refundBookFor(scope)
    if (!book) throw new RefundError(404, 'That booking isn’t here any more.')
    const reason = answer.state === 'failed' ? `Square shows the ${amount} refund failed (Ask Square)` : `Square shows no ${amount} refund (Ask Square)`
    await clearRequest(book, req.id, 'did-not-go-through', reason, actor)
    out = { what: answer.state === 'failed' ? 'It didn’t go through: Square shows the refund failed' : 'It didn’t go through: Square shows no refund', action: act, cents: 0, emailed: false, squareSaid: answer.state }
  } else {
    if (answer.state === 'done' || answer.state === 'pending') throw new RefundError(409, answer.message, { asked: answer })
    if (answer.state === 'failed') {
      // Square failed that try: the next one is a new try (a new key), never the same failed answer again.
      await changeRefundRequest(scope.classId, scope.bookingId, req.id, (r) => (r.status !== 'pending' ? null : {
        ...r, status: 'turned-down', failures: r.failures + 1,
        idempotencyKey: refundKey(r.bookingId, r.lines.map((x) => x.id), r.totalCents, r.prior, r.failures + 1),
      }))
    }
    const book = await refundBookFor(scope)
    if (!book) throw new RefundError(404, 'That booking isn’t here any more.')
    const r = await retrySavedRequest(book, req.id, actor)
    out = { what: `Tried again: Square refunded ${formatMoney(r.cents)}${r.emailed ? ' (emailed)' : ''}`, action: act, cents: r.cents, emailed: r.emailed, squareSaid: answer.state }
  }
  await recordAudit({
    by: { ...actor.by, role: actor.role },
    action: 'refund-ask-square',
    target: scope.classId === PARTY_SCOPE ? { kind: 'party', id: scope.bookingId, label: 'a party refund' } : { kind: 'class', id: scope.classId, label: 'a class refund' },
    details: { bookingId: scope.bookingId, requestId: req.id, action, squareSaid: answer.state, squareRefundId: answer.refundId ?? '', cents: req.totalCents },
  }).catch(() => undefined)
  return out
}
