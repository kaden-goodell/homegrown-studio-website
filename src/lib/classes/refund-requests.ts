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
  /** true once our own reply told the person it worked (a webhook-finished request is not answered yet) */
  answered: boolean
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

/** Saves a new request; if one with that id already exists (a race), returns that one instead. */
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
export async function markRequestDone(classId: string, bookingId: string, id: string, squareRefundId: string, opts: { answered?: boolean } = {}): Promise<boolean> {
  let flipped = false
  await changeRefundRequest(classId, bookingId, id, (r) => {
    if (r.status === 'done') return opts.answered && !r.answered ? { ...r, answered: true } : null
    flipped = true
    return { ...r, status: 'done', squareRefundId: r.squareRefundId ?? squareRefundId, answered: !!opts.answered }
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
