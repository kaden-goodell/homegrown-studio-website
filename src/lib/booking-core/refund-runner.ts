/**
 * The one refund runner for our own bookings (classes now, parties next).
 * A "book" is what a booking kind brings: how to plan a refund from its own
 * records, how to write a finished refund there, whom to email, what to
 * audit. The runner owns everything else, the same for every kind:
 *
 *   identity (attempt token / "Refund again") → the saved request (before any
 *   money moves, R29) → ONE Square refund with the saved key → write → done →
 *   the customer's email once (R30) → audited once.
 *
 * Saved requests live in `refund-requests`, keyed by an opaque scope
 * (`classId`: a class id, or 'party' for parties) and the booking id, so a
 * new kind shares it with no data migration. Hard rules: nobody is refunded
 * twice; nothing runs on its own; money Square refunded is always recorded.
 *
 * Server only.
 */
import { randomUUID } from 'node:crypto'
import { providers } from '@config/providers'
import type { By } from '@lib/staff-auth'
import {
  AGAIN_IS_STALE, NOT_WAITING, REFUND_JUST_MADE, RefundError, refundKey, SAVED_SPLIT_NO_LONGER_FITS,
  SQUARE_NO_ANSWER, SQUARE_TURNED_DOWN, STILL_WAITING_ON_SQUARE, type RefundPlan,
} from './refund-words'
import {
  changeRefundRequest, claimRequestEmail, doneAsks, hashOf, isWaiting, listRefundRequests, markRequestDone, markRequestSent,
  releaseRequestEmail, resendRefundRequest, sameAsk, saveRefundRequest, type SavedRefundRequest,
} from '@lib/classes/refund-requests'
import type { Cents } from '@lib/classes/types'

/** Square's limit on a refund's reason. */
const SQUARE_REASON_MAX = 192

/** Which saved requests: classes `{ classId, bookingId }`; parties `{ classId: 'party', bookingId: <pty_ or legacy id> }`. */
export interface RefundScope { classId: string; bookingId: string }

export interface RefundBook<W> {
  scope: RefundScope
  /** class name, or "the Justice party" */
  label: string
  /** what kind of refund was asked (saved on the request; classes: booking / person / session / custom) */
  kind: string
  /** log prefix, e.g. 'classes/refund' */
  logTag: string
  /** the refusal when this book's records can't be reached */
  unreachable: string
  /** what was asked, without the attempt token (empty for a book resolved from its scope only) */
  inputHash: string
  /** throws RefundError before any money moves */
  plan(): Promise<RefundPlan>
  /** a turned-down request may be sent again only while it fits */
  stillFits(rec: SavedRefundRequest): Promise<boolean>
  noteFailed(rawKey: string): Promise<void>
  /** idempotent by request id + Square refund id */
  write(rec: SavedRefundRequest, squareRefundId: string | null): Promise<W>
  /** classes: onSeatFreed (the book decides whether anything was freed) */
  afterWrite?(rec: SavedRefundRequest, written: W): Promise<void>
  /** what a finished request looks like now (the reply to a replay or "Already refunded") */
  current(rec: SavedRefundRequest): Promise<W>
  /** a request as the screens show it (named in a 409 "still waiting" / "just made") */
  describe(rec: SavedRefundRequest): Promise<unknown>
  /** false when there is nobody to email (checked before the email is claimed) */
  canEmail(rec: SavedRefundRequest, written: W): boolean
  /** called only by the claimRequestEmail winner (R30); true = sent */
  email(rec: SavedRefundRequest, written: W): Promise<boolean>
  audit(rec: SavedRefundRequest, squareRefundId: string, how?: 'checked-in-square' | 'square-webhook'): Promise<void>
  /** "I checked Square": the person's check, audited when it changed something */
  auditCheck(rec: SavedRefundRequest, cleared: NonNullable<SavedRefundRequest['cleared']>): Promise<void>
}

export interface AlreadyRefunded {
  at: string | null; by: By; checkedBy?: By; message: string; count: number
  latest: { requestId: string; at: string | null; by: By; cents: Cents }
  /**
   * The request this ask matched. A "Refund again" retried after Square
   * finished it gets askedId === latest.requestId: that is the screen's own
   * repeat, done (show it as refunded, not "Already refunded").
   */
  askedId: string
}

export interface RefundResult<W> {
  refundId: string
  cents: Cents
  freeSeat: boolean
  written: W
  emailed: boolean
  /**
   * Set when this ask matched a refund already made (nothing was sent): the
   * screen shows `message` and offers "Refund again" of `latest`. `at` is null
   * for a request saved before finish times were kept. `count` = refunds made
   * with these same inputs.
   */
  already?: AlreadyRefunded
}

type Actor = { by: By; role: 'owner' | 'crew' }

// ── Which book a scope belongs to ─────────────────────────────────────────────

/** The scope reserved for parties: never a class. */
export const PARTY_SCOPE = 'party'

/**
 * Finds the book that writes refunds for a scope (the static list is
 * booking-core/refund-books: classes and parties, an unknown scope throws).
 * The runner itself knows no booking kind. `hint.label` is the name the
 * caller already has (the webhook's class list), used before a fresh read.
 * Null = nothing there to write to.
 */
export type RefundBookFinder = (scope: RefundScope, hint?: { label?: string }) => Promise<RefundBook<unknown> | null>

// ── Shared steps ──────────────────────────────────────────────────────────────

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })

/** A 409 naming the other refund (who, when, how much, what), so the owner can find it in Square. */
async function blockedBy<W>(book: RefundBook<W>, other: SavedRefundRequest, message: string): Promise<RefundError> {
  return new RefundError(409, message, { pending: await book.describe(other) })
}

/** "It went through" was saved but the request wasn't marked done (a failure in between). */
const checkedButUnfinished = (r: SavedRefundRequest) => r.status === 'sent' && !r.squareRefundId && r.cleared?.outcome === 'went-through'

/**
 * The customer's refund email, at most once per request whoever finishes it
 * (our reply, Square's webhook, the nightly run, or "It went through").
 * Returns true when the customer has been emailed for this request.
 */
async function emailOnce<W>(book: RefundBook<W>, rec: SavedRefundRequest, written: W): Promise<boolean> {
  if (!book.canEmail(rec, written)) return false
  if (!(await claimRequestEmail(rec.classId, rec.bookingId, rec.id).catch(() => false))) {
    const now = (await listRefundRequests(rec.classId, rec.bookingId).catch(() => [])).find((r) => r.id === rec.id)
    return !!now?.emailedAt
  }
  try {
    const sent = await book.email(rec, written)
    if (!sent) await releaseRequestEmail(rec.classId, rec.bookingId, rec.id).catch(() => undefined)
    return sent
  } catch (e) {
    // Name or code only: the message can carry the customer's address.
    const code = (e as { code?: unknown })?.code
    console.warn(`[${book.logTag}] email for ${rec.bookingId} failed: ${e instanceof Error ? e.name : 'unknown'}${typeof code === 'string' ? ` ${code}` : ''}`)
    await releaseRequestEmail(rec.classId, rec.bookingId, rec.id).catch(() => undefined)
    return false
  }
}

/**
 * A request already finished, asked for again: nothing is sent. A replay
 * of the same attempt token is answered as that refund (`already` false).
 * Otherwise (`already`) it is the same refund re-entered, or a "Refund again"
 * retried after Square finished it: the reply names the LATEST refund with
 * these inputs and how many there have been. Only the asker is marked as told.
 */
async function doneReply<W>(book: RefundBook<W>, rec: SavedRefundRequest, actor: { by: By }, already: boolean): Promise<RefundResult<W>> {
  const { classId } = book.scope
  if (actor.by.id === rec.by.id) await markRequestDone(classId, rec.bookingId, rec.id, rec.squareRefundId, { answered: true }).catch(() => false)
  const done = already ? doneAsks(await listRefundRequests(classId, rec.bookingId), rec.inputHash) : []
  const latest = done[0] ?? rec
  const written = await book.current(latest)
  const out: RefundResult<W> = { refundId: latest.squareRefundId ?? '', cents: latest.totalCents, freeSeat: latest.freeSeat, written, emailed: !!latest.emailedAt }
  if (!already) return out
  // Only a real finish time; never one that moves with later writes (an email claim, say).
  const at = latest.doneAt ?? latest.cleared?.at ?? null
  const count = Math.max(1, done.length)
  const when = at ? `on ${shortDate(at)} ` : ''
  const message = count === 1
    ? `Already refunded ${when}by ${latest.by.name}.`
    : `Refunded ${count === 2 ? 'twice' : `${count} times`} already, last ${when}by ${latest.by.name}.`
  return {
    ...out,
    already: {
      at, by: latest.by, ...(latest.cleared ? { checkedBy: latest.cleared.by } : {}), message, count,
      latest: { requestId: latest.id, at, by: latest.by, cents: latest.totalCents },
      askedId: rec.id,
    },
  }
}

// ── The runner ────────────────────────────────────────────────────────────────

/**
 * Refund one booking (all or part). `actor` is who asked: an owner from
 * /admin or anyone from /staff.
 *
 * The request is saved (exact split + idempotency key) BEFORE Square is
 * called. A retry continues that saved request: it re-sends the same split and
 * key (Square hands back the same refund), or, when Square already took it,
 * only saves it here. It is never re-planned, so "Try again" can never refund
 * twice. The same refund entered again later (a reload, a new screen, days
 * on) matches it by its inputs and is answered "Already refunded"; only
 * `again` makes a second one.
 */
export async function runRefund<W>(
  book: RefundBook<W>,
  ask: { attempt?: string; again?: { of: string; token: string }; reason: string },
  actor: Actor,
): Promise<RefundResult<W>> {
  const { classId, bookingId } = book.scope
  const now = new Date()
  const again = ask.again ?? null
  const inputHash = book.inputHash
  // One identity per ask across its retries: a "Refund again" by (booking, what it repeats, its token, what is asked),
  // so a reused token with another amount or other seats is a different request (refused as stale below); else the screen's token.
  const tokenId = again
    ? hashOf('refund-again', classId, bookingId, again.of, again.token, inputHash)
    : ask.attempt ? hashOf('refund-attempt', inputHash, ask.attempt) : null
  const saved = await listRefundRequests(classId, bookingId)
  let rec: SavedRefundRequest | null = null

  // 1. This very ask (same token), whatever else is asked: continue it, or say it's done.
  const exact = tokenId ? saved.find((r) => r.id === tokenId) : undefined
  if (exact && exact.retired && again) throw new RefundError(409, SAVED_SPLIT_NO_LONGER_FITS)
  if (exact && !exact.retired) {
    if (exact.status === 'done') return doneReply(book, exact, actor, !!again)
    rec = exact
  }
  // 2. The same inputs, unfinished: continue it (a retry from a reloaded screen).
  rec ??= saved.find((r) => sameAsk(r, inputHash) && r.status !== 'done') ?? null
  if (!rec) {
    // 3. The same inputs, finished: "Already refunded", unless this is a "Refund again" of exactly the latest one.
    const latest = doneAsks(saved, inputHash)[0]
    if (again) {
      if (!latest || latest.id !== again.of) throw new RefundError(409, AGAIN_IS_STALE)
    } else if (latest) {
      return doneReply(book, latest, actor, true)
    }
  }

  if (!rec) {
    // A different refund while one has no answer from Square: refused until a person checks Square (R29).
    const waiting = saved.find(isWaiting)
    if (waiting) throw await blockedBy(book, waiting, STILL_WAITING_ON_SQUARE)
    const plan = await book.plan()
    const at = now.toISOString()
    // A "Refund again" always uses its own id (a retired one was refused above); a plain ask whose token was retired gets a new one.
    const id = tokenId && (again || !saved.some((r) => r.id === tokenId)) ? tokenId : hashOf('refund-attempt', inputHash, randomUUID())
    // Checked again and saved in one step: two refunds at once can't both go to Square.
    const out = await saveRefundRequest({
      id, inputHash, classId, bookingId, paymentId: plan.paymentId, kind: book.kind, freeSeat: plan.freeSeat,
      reason: ask.reason, by: actor.by, role: actor.role, lines: plan.lines, totalCents: plan.totalCents, prior: plan.prior,
      rawKey: plan.rawKey, failures: plan.failures,
      idempotencyKey: refundKey(bookingId, plan.lines.map((x) => x.id), plan.totalCents, plan.prior, plan.failures),
      status: 'pending', squareRefundId: null, answered: false, createdAt: at, updatedAt: at,
    }, { seen: saved.map((r) => r.id), againOf: again?.of ?? null })
    if (out.kind === 'waiting') throw await blockedBy(book, out.rec, STILL_WAITING_ON_SQUARE)
    if (out.kind === 'changed') throw await blockedBy(book, out.rec, REFUND_JUST_MADE)
    if (out.kind === 'stale') throw new RefundError(409, AGAIN_IS_STALE)
    // Our own id finished meanwhile (a double tap): a replay, or for "Refund again" the "Already refunded" answer.
    if (out.rec.status === 'done') return doneReply(book, out.rec, actor, out.kind === 'same' || !!again)
    rec = out.rec
  }

  const checked = checkedButUnfinished(rec)
  let refundId: string | null = rec.status === 'sent' ? rec.squareRefundId : null
  if (!refundId && !checked) {
    if (rec.status === 'turned-down') {
      // A fresh try of a refused request, days later maybe: only while its split still fits what's left.
      if (!(await book.stillFits(rec))) {
        await changeRefundRequest(classId, bookingId, rec.id, (r) => (r.status === 'turned-down' && !r.retired ? { ...r, retired: true } : null)).catch(() => undefined)
        throw new RefundError(409, SAVED_SPLIT_NO_LONGER_FITS)
      }
      // In flight again until Square answers; refused while a different refund waits on Square.
      const out = await resendRefundRequest(classId, bookingId, rec.id)
      if (out.kind === 'waiting') throw await blockedBy(book, out.rec, STILL_WAITING_ON_SQUARE)
      rec = out.rec
    }
    let refund
    try {
      refund = await providers.payment.refundPayment({
        paymentId: rec.paymentId,
        amountCents: rec.totalCents,
        idempotencyKey: rec.idempotencyKey,
        ...(rec.reason ? { reason: rec.reason.slice(0, SQUARE_REASON_MAX) } : {}),
      })
    } catch (e) {
      // No clear answer (it may even have gone through): the saved request is sent again next time, same key.
      console.error(`[${book.logTag}] Square gave no answer for ${bookingId}: ${e instanceof Error ? e.message : e}`)
      throw new RefundError(502, SQUARE_NO_ANSWER)
    }
    if (/^(FAILED|REJECTED)$/i.test(refund.status)) {
      // Square said no, nothing was refunded: the next try of this request is a new one (a new key).
      console.error(`[${book.logTag}] Square ${refund.status} the refund on ${bookingId}`)
      await book.noteFailed(rec.rawKey).catch(() => undefined)
      await changeRefundRequest(classId, bookingId, rec.id, (r) => r.status === 'done' || r.status === 'sent' ? null : {
        ...r, status: 'turned-down', failures: r.failures + 1,
        idempotencyKey: refundKey(r.bookingId, r.lines.map((x) => x.id), r.totalCents, r.prior, r.failures + 1),
      }).catch(() => undefined)
      throw new RefundError(502, SQUARE_TURNED_DOWN)
    }
    refundId = refund.id as string
    await markRequestSent(classId, bookingId, rec.id, refundId).catch(() => undefined)
  }

  let written: W
  try {
    written = await book.write(rec, refundId)
  } catch (e) {
    // The money went back; the saved request knows it, so trying again only saves it here.
    console.error(`[${book.logTag}] ${refundId} on ${bookingId} not recorded: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(500, "The refund went through in Square but didn't save here. Do the same refund again to save it.")
  }
  const first = await markRequestDone(classId, bookingId, rec.id, refundId, { answered: actor.by.id === rec.by.id }).catch(() => true)

  if (book.afterWrite) await book.afterWrite(rec, written).catch(() => undefined)

  const emailed = await emailOnce(book, rec, written)

  // Audited once: by whichever of us, Square's webhook and "It went through" saved it first.
  if (first) await book.audit(rec, refundId ?? '', checked ? 'checked-in-square' : undefined)

  return { refundId: refundId ?? '', cents: rec.totalCents, freeSeat: rec.freeSeat, written, emailed }
}

/**
 * Square's webhook (or the nightly run) saw a COMPLETED refund on one of
 * these bookings' payment (callers use booking-core/refund-books'
 * claimSquareRefund, which passes the static `bookFor`). If it is one of our saved requests (same Square
 * refund id; a request id the records already carry for it; or, unless
 * `exactOnly`, an unfinished request on that payment for exactly that
 * amount), it is saved as that request, by the person who asked, through its
 * scope's book, and true is returned: the caller records nothing of its own.
 *
 * Money first: the write is keyed by the Square refund id (and the request
 * id), then the request is marked done. A replay after a failure in between
 * finds the money already written and only finishes the request.
 */
export async function claimSquareRefundWith(
  bookFor: RefundBookFinder,
  refund: { id: string; paymentId: string; cents: Cents },
  bookings: { classId: string; bookingId: string; label?: string }[],
  opts: { requestIds?: string[]; exactOnly?: boolean } = {},
): Promise<boolean> {
  let found: SavedRefundRequest | null = null
  let label: string | undefined
  for (const b of bookings) {
    const saved = await listRefundRequests(b.classId, b.bookingId)
    const sameMoney = (r: SavedRefundRequest) => !r.squareRefundId && r.paymentId === refund.paymentId && r.totalCents === refund.cents
    const hit = saved.find((r) => r.squareRefundId === refund.id)
      ?? saved.find((r) => opts.requestIds?.includes(r.id))
      ?? (opts.exactOnly ? undefined : (
        saved.filter((r) => r.status === 'pending' && sameMoney(r)).sort((a, c) => a.createdAt.localeCompare(c.createdAt))[0]
        // a person said "It went through" before Square's refund reached us: it is that one
        ?? saved.filter((r) => (r.status === 'done' || r.status === 'sent') && r.cleared?.outcome === 'went-through' && sameMoney(r))[0]
      ))
    if (hit) { found = hit; label = b.label; break }
  }
  if (!found) return false
  const book = await bookFor({ classId: found.classId, bookingId: found.bookingId }, label ? { label } : undefined)
  // Nothing there to write it to: not ours to claim; the caller records Square's refund as money.
  if (!book) return false
  if (found.status === 'done') {
    // Already written ("It went through"): just remember Square's id for it.
    if (!found.squareRefundId) await changeRefundRequest(found.classId, found.bookingId, found.id, (r) => (r.squareRefundId ? null : { ...r, squareRefundId: refund.id }))
    return true
  }
  const written = await book.write(found, refund.id)
  if (await markRequestDone(found.classId, found.bookingId, found.id, refund.id)) {
    await book.audit(found, refund.id, 'square-webhook').catch(() => undefined)
  }
  if (book.afterWrite) await book.afterWrite(found, written).catch(() => undefined)
  await emailOnce(book, found, written)
  return true
}

/**
 * A person checked Square for a refund that never got an answer (R29).
 * - 'went-through': written exactly as asked (by who asked), noted as checked
 *   by this person, customer emailed once. Money first (keyed by the
 *   request), then the request: if marking it done fails, the same check
 *   again finishes it and never writes the money twice.
 * - 'did-not-go-through': nothing written (returns null); the request stops
 *   blocking new refunds. Asking the same refund again re-sends its key, so if
 *   it had in fact gone through Square hands that refund back instead of a
 *   second one.
 */
export async function clearRequest<W>(
  book: RefundBook<W>,
  requestId: string,
  outcome: 'went-through' | 'did-not-go-through',
  reason: string,
  actor: Actor,
): Promise<RefundResult<W> | null> {
  if (outcome !== 'went-through' && outcome !== 'did-not-go-through') throw new RefundError(400, 'Pick whether it went through in Square.')
  const { classId, bookingId } = book.scope
  const rec = (await listRefundRequests(classId, bookingId)).find((r) => r.id === requestId)
  if (!rec) throw new RefundError(404, 'That refund is not on this booking.')

  let next: SavedRefundRequest | null
  if (outcome === 'went-through' && checkedButUnfinished(rec)) {
    // Its money is already written: finish it.
    next = rec
  } else {
    const cleared = { at: new Date().toISOString(), by: actor.by, role: actor.role, outcome, reason }
    // Claim it first, so two people checking at once can't both save it.
    let claimed = false
    next = await changeRefundRequest(classId, bookingId, rec.id, (r) => {
      if (!isWaiting(r)) return null
      claimed = true
      return outcome === 'went-through' ? { ...r, status: 'sent', cleared } : { ...r, status: 'turned-down', cleared }
    })
    if (!claimed || !next) throw new RefundError(409, NOT_WAITING)
  }
  const cleared = next.cleared!
  const checked = () => book.auditCheck(rec, cleared).catch(() => undefined)

  if (outcome === 'did-not-go-through') {
    await checked()
    return null
  }
  let written: W
  try {
    written = await book.write(next, null)
  } catch (e) {
    // Nothing was written (one change, all or nothing): put it back as waiting so the check can be done again.
    if (!checkedButUnfinished(rec)) {
      await changeRefundRequest(classId, bookingId, rec.id, (r) => (checkedButUnfinished(r) ? { ...r, status: 'pending', cleared: undefined } : null)).catch(() => undefined)
    }
    console.error(`[${book.logTag}] checked refund on ${rec.bookingId} not saved: ${e instanceof Error ? e.message : e}`)
    throw new RefundError(503, book.unreachable)
  }
  // Told the asker only when the asker is the one who checked.
  const first = await markRequestDone(classId, bookingId, rec.id, null, { answered: actor.by.id === next.by.id })
  if (first && book.afterWrite) await book.afterWrite(next, written).catch(() => undefined)
  const emailed = await emailOnce(book, next, written)
  if (first) {
    await book.audit(next, '', 'checked-in-square').catch(() => undefined)
    await checked()
  }
  return { refundId: '', cents: next.totalCents, freeSeat: next.freeSeat, written, emailed }
}
