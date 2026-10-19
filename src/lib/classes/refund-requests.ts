/**
 * Saved refund requests. Before an owner's (or crew's) refund goes to Square,
 * the request is saved with its exact per-seat split and idempotency key. A
 * retry of the same request re-sends that saved split and key verbatim, never
 * re-planned from the ledger, so a retry can never make a second refund, even
 * when Square's webhook has recorded the first one in the meantime.
 *
 * Statuses:
 * - pending: saved, sent (or about to be sent) to Square, no answer yet
 * - sent: Square took it (squareRefundId known), not yet saved on the ledger
 * - done: on the ledger
 * - turned-down: Square said FAILED/REJECTED; nothing was refunded
 *
 * One document per booking (CAS-written), so the webhook can find our request
 * for a refund on that booking's payment.
 */
import { createHash } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import type { By } from '@lib/staff-auth'
import type { Cents } from './types'

export type RefundRequestStatus = 'pending' | 'sent' | 'done' | 'turned-down'

export interface SavedRefundRequest {
  id: string
  /** hash of the request's inputs (class, booking, kind, seats, amount, free-seat choice), without the attempt token */
  inputHash: string
  classId: string
  bookingId: string
  paymentId: string
  kind: string
  freeSeat: boolean
  reason: string
  by: By
  role: 'owner' | 'crew'
  /** the exact split sent to Square and to be written on the ledger */
  lines: { id: string; cents: Cents }[]
  totalCents: Cents
  prior: number
  rawKey: string
  /** times Square turned this request down */
  failures: number
  idempotencyKey: string
  status: RefundRequestStatus
  squareRefundId: string | null
  /** true once the person who asked was told it worked (finished by Square's webhook or by someone else's check: not yet) */
  answered: boolean
  /** when it was put on the ledger */
  doneAt?: string | null
  /** turned down and no longer fits what's left on the booking: never sent again; the same ask is planned afresh */
  retired?: boolean
  /** set once the customer's refund email is claimed: one email per request, whoever finishes it */
  emailedAt?: string | null
  /** a person checked Square for a request that had no answer */
  cleared?: { at: string; by: By; role: 'owner' | 'crew'; outcome: 'went-through' | 'did-not-go-through'; reason: string }
  createdAt: string
  updatedAt: string
}

const kv = makeKvStore('refund-requests', 'refund-requests')
const ATTEMPTS = 3
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
const docKey = (classId: string, bookingId: string) => `reqs-${safe(classId)}-${safe(bookingId)}`

export const hashOf = (...parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)

export async function listRefundRequests(classId: string, bookingId: string): Promise<SavedRefundRequest[]> {
  const json = await kv.get(docKey(classId, bookingId))
  return json ? (JSON.parse(json) as SavedRefundRequest[]) : []
}

/** Read-modify-write of one booking's requests (CAS, 3 attempts). */
async function update<T>(classId: string, bookingId: string, fn: (list: SavedRefundRequest[]) => { next: SavedRefundRequest[] | null; result: T }): Promise<T> {
  const k = docKey(classId, bookingId)
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const { next, result } = fn(value ? (JSON.parse(value) as SavedRefundRequest[]) : [])
    if (!next) return result
    if (await kv.setIfMatch(k, JSON.stringify(next), etag, value !== null)) return result
  }
  throw new Error('Concurrent update — please retry')
}

/** True for a request with these same inputs that a new ask continues (unfinished) or is answered by (done). Retired ones never. */
export function sameAsk(r: SavedRefundRequest, inputHash: string): boolean {
  return r.inputHash === inputHash && !r.retired
}

/** The finished requests with these inputs, latest first (by when they finished; requests from before doneAt by when made). */
export function doneAsks(list: SavedRefundRequest[], inputHash: string): SavedRefundRequest[] {
  const when = (r: SavedRefundRequest) => r.doneAt ?? r.createdAt
  return list.filter((r) => sameAsk(r, inputHash) && r.status === 'done').sort((a, b) => when(b).localeCompare(when(a)))
}

/** Still waiting on Square with no answer: blocks every different refund on the booking until a person checks (R29). */
export const isWaiting = (r: SavedRefundRequest) => r.status === 'pending' && !r.squareRefundId

export type SaveOutcome =
  /** saved now, or this very request (same id) was already saved */
  | { kind: 'mine'; rec: SavedRefundRequest }
  /** an earlier request with the same inputs: continue it (or answer it as done) */
  | { kind: 'same'; rec: SavedRefundRequest }
  /** a different refund is waiting on Square */
  | { kind: 'waiting'; rec: SavedRefundRequest }
  /** a different refund was saved after this one was planned: its plan may be out of date */
  | { kind: 'changed'; rec: SavedRefundRequest }
  /** a "Refund again" whose `of` is no longer the latest finished refund with these inputs (someone repeated it already) */
  | { kind: 'stale'; rec: SavedRefundRequest | null }

/**
 * Saves a new request, deciding in the same compare-and-swap (no snapshot
 * race) whether it may be saved at all: the same id → that one; an earlier
 * request with the same inputs → that one (two clicks never make two
 * requests); a different refund waiting on Square → refused; a different
 * refund saved since `seen` was read (the plan may be stale) → refused.
 */
export async function saveRefundRequest(rec: SavedRefundRequest, opts: { seen: string[]; againOf: string | null }): Promise<SaveOutcome> {
  return update<SaveOutcome>(rec.classId, rec.bookingId, (list) => {
    const have = list.find((r) => r.id === rec.id)
    if (have) return { next: null, result: { kind: 'mine', rec: have } }
    const unfinished = list.find((r) => sameAsk(r, rec.inputHash) && r.status !== 'done')
    if (unfinished) return { next: null, result: { kind: 'same', rec: unfinished } }
    const latest = doneAsks(list, rec.inputHash)[0] ?? null
    if (opts.againOf !== null) {
      // "Refund again" repeats exactly the refund the screen showed, and only while it is still the latest.
      if (!latest || latest.id !== opts.againOf) return { next: null, result: { kind: 'stale', rec: latest } }
    } else if (latest) {
      return { next: null, result: { kind: 'same', rec: latest } }
    }
    const waiting = list.find(isWaiting)
    if (waiting) return { next: null, result: { kind: 'waiting', rec: waiting } }
    const since = list.find((r) => !opts.seen.includes(r.id) && r.status !== 'turned-down')
    if (since) return { next: null, result: { kind: 'changed', rec: since } }
    return { next: [...list, rec], result: { kind: 'mine', rec } }
  })
}

/**
 * A request Square turned down (or a person said didn't go through), sent
 * again: back to pending in one step, refused while a different refund is
 * waiting on Square.
 */
export async function resendRefundRequest(
  classId: string, bookingId: string, id: string,
): Promise<{ kind: 'resent' | 'waiting'; rec: SavedRefundRequest }> {
  return update<{ kind: 'resent' | 'waiting'; rec: SavedRefundRequest }>(classId, bookingId, (list) => {
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) throw new Error('That refund is not on this booking.')
    const waiting = list.find((r) => r.id !== id && isWaiting(r))
    if (waiting) return { next: null, result: { kind: 'waiting' as const, rec: waiting } }
    if (list[i].status !== 'turned-down') return { next: null, result: { kind: 'resent' as const, rec: list[i] } }
    const next = [...list]
    next[i] = { ...list[i], status: 'pending', updatedAt: new Date().toISOString() }
    return { next, result: { kind: 'resent' as const, rec: next[i] } }
  })
}

/** Saves a new request with no checks; if one with that id already exists (a race), returns that one instead. */
export async function createRefundRequest(rec: SavedRefundRequest): Promise<SavedRefundRequest> {
  return update(rec.classId, rec.bookingId, (list) => {
    const have = list.find((r) => r.id === rec.id)
    return have ? { next: null, result: have } : { next: [...list, rec], result: rec }
  })
}

/** Changes one request. `fn` returns the new request, or null to leave it. */
export async function changeRefundRequest(
  classId: string, bookingId: string, id: string, fn: (r: SavedRefundRequest) => SavedRefundRequest | null,
): Promise<SavedRefundRequest | null> {
  return update(classId, bookingId, (list) => {
    const i = list.findIndex((r) => r.id === id)
    if (i < 0) return { next: null, result: null }
    const changed = fn(list[i])
    if (!changed) return { next: null, result: list[i] }
    const next = [...list]
    next[i] = { ...changed, updatedAt: new Date().toISOString() }
    return { next, result: next[i] }
  })
}

/** Square took it: remember its refund id (never moves a done request back). */
export function markRequestSent(classId: string, bookingId: string, id: string, squareRefundId: string) {
  return changeRefundRequest(classId, bookingId, id, (r) =>
    r.status === 'done' ? (r.squareRefundId ? null : { ...r, squareRefundId }) : { ...r, status: 'sent', squareRefundId })
}

/** On the ledger. Returns true only for the call that moved it to done. */
export async function markRequestDone(classId: string, bookingId: string, id: string, squareRefundId: string | null, opts: { answered?: boolean } = {}): Promise<boolean> {
  let flipped = false
  await changeRefundRequest(classId, bookingId, id, (r) => {
    if (r.status === 'done') return opts.answered && !r.answered ? { ...r, answered: true } : null
    flipped = true
    return { ...r, status: 'done', squareRefundId: r.squareRefundId || squareRefundId || null, answered: !!opts.answered, doneAt: new Date().toISOString() }
  })
  return flipped
}

/** Every saved request (for the nightly check of ones Square never confirmed). */
export async function allRefundRequests(): Promise<SavedRefundRequest[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith('reqs-'))
  const docs = await Promise.all(keys.map((k) => kv.get(k)))
  return docs.flatMap((d) => (d ? (JSON.parse(d) as SavedRefundRequest[]) : []))
}

/** A request older than this with no refund from Square is shown to the owners. */
export const UNCONFIRMED_AFTER_MS = 24 * 3_600_000

/** Claims the customer email for this request. True only for the one caller that should send it. */
export async function claimRequestEmail(classId: string, bookingId: string, id: string): Promise<boolean> {
  let mine = false
  await changeRefundRequest(classId, bookingId, id, (r) => {
    if (r.emailedAt) return null
    mine = true
    return { ...r, emailedAt: new Date().toISOString() }
  })
  return mine
}

/** Gives the claim back after a send that failed, so a later finish can try again. */
export async function releaseRequestEmail(classId: string, bookingId: string, id: string): Promise<void> {
  await changeRefundRequest(classId, bookingId, id, (r) => (r.emailedAt ? { ...r, emailedAt: null } : null))
}
