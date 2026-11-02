/**
 * One time-changing action per party at a time (move, cancel, adding or
 * taking off an extra that changes its length, and every retry of those).
 *
 * Why: each of those writes the party book and the party record in turn, and
 * may let a time go afterwards. Two of them for the same party interleaving
 * (a double tap, a late retry, two owners) could let go of the very time the
 * other one just wrote, leaving a booked party with nothing held (Task 11
 * re-review N1). Inside this lock the request is the only one changing the
 * party, so a time it lets go after re-reading the record is never one that
 * another request still needs.
 *
 * Two layers:
 *  - in-process: requests on one server queue up (and tests are exact);
 *  - a short lease in the store (`lock-<partyId>`, compare-and-set), so two
 *    servers never run the same party's change at once. A request that
 *    can't get the lease in WAIT_MS is refused with a plain "try again"
 *    (nothing changed).
 *
 * The lease and Netlify's time limit (checked 2 Nov 2026, Netlify docs,
 * Functions › Configuration: "Synchronous execution limit 60 seconds", not
 * configurable). A request may therefore run longer than the 30 s lease. So:
 *  - while the action runs, a heartbeat renews the lease every RENEW_MS
 *    (compare-and-set on our own token). A server that dies stops renewing,
 *    and its lease frees itself within the lease time (30 s);
 *  - fencing: before each write that matters (the party book, the record),
 *    the action calls `assertPartyLockHeld()`, which renews the lease and
 *    refuses (PartyBusyError, nothing written) if another server took it
 *    over meanwhile (a heartbeat that couldn't reach the store for 30 s).
 * Requests on one server queue in process; each still has its own WAIT_MS
 * for the store lease once it reaches the front.
 *
 * Server only.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('parties:lock')
const kv = makeKvStore('party-locks', 'party-locks')

/** How long a lease lasts without a renewal: a server that died frees it within this. Renewed while the action runs. */
let leaseMs = 30_000
let renewMs = 10_000
let waitMs = 6_000
const POLL_MS = 150

/** Test-only: how long to wait for another server's lease. */
export function _setPartyLockWaitMs(ms: number): void { waitMs = ms }
/** Test-only: how often the heartbeat renews the lease, and how long a lease lasts. */
export function _setPartyLockTimes(t: { renewMs?: number; leaseMs?: number }): void {
  if (t.renewMs) renewMs = t.renewMs
  if (t.leaseMs) leaseMs = t.leaseMs
}

export class PartyBusyError extends Error {
  constructor() { super('Someone else is changing this party right now. Wait a moment, then try again. Nothing was changed.') }
}

const queues = new Map<string, Promise<unknown>>()
function inProcess<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(k) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  queues.set(k, tail)
  void tail.then(() => { if (queues.get(k) === tail) queues.delete(k) })
  return run
}

interface Lease { token: string | null; until: number }
const keyOf = (partyId: string) => `lock-${partyId}`
const parse = (json: string | null): Lease | null => {
  if (!json) return null
  try { return JSON.parse(json) as Lease } catch { return null }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function acquire(partyId: string): Promise<string> {
  const k = keyOf(partyId)
  const token = randomUUID()
  // How long we wait is measured on the monotonic clock; the lease's `until` is wall-clock (shared across servers).
  const deadline = performance.now() + waitMs
  for (;;) {
    const { value, etag } = await kv.getWithMeta(k)
    const cur = parse(value)
    if (!cur || !cur.token || cur.until <= Date.now()) {
      if (await kv.setIfMatch(k, JSON.stringify({ token, until: Date.now() + leaseMs } satisfies Lease), etag, value !== null)) return token
    }
    if (performance.now() >= deadline) throw new PartyBusyError()
    await sleep(POLL_MS)
  }
}

/** Extends our lease; false when it is no longer ours (it ran out and another server took it). */
async function renew(partyId: string, token: string): Promise<boolean> {
  const k = keyOf(partyId)
  const { value, etag } = await kv.getWithMeta(k)
  if (parse(value)?.token !== token) return false
  return kv.setIfMatch(k, JSON.stringify({ token, until: Date.now() + leaseMs } satisfies Lease), etag, true)
}

interface Held { partyId: string; token: string; lost: boolean }
const held = new AsyncLocalStorage<Held>()

/**
 * Fencing: call right before a write that matters. Renews the lease and
 * throws PartyBusyError (nothing written) when another server holds it now.
 * Outside withPartyLock it does nothing.
 */
export async function assertPartyLockHeld(): Promise<void> {
  const h = held.getStore()
  if (!h) return
  let ok = !h.lost
  if (ok) {
    try {
      ok = await renew(h.partyId, h.token)
    } catch (e) {
      // The store didn't answer: the lease stands until `until`, and the heartbeat keeps trying.
      logger.warn('Party lock not renewed', { partyId: h.partyId, error: String(e) })
    }
  }
  if (!ok) {
    h.lost = true
    logger.error('PARTY LOCK lost before a write', { partyId: h.partyId })
    throw new PartyBusyError()
  }
}

async function release(partyId: string, token: string): Promise<void> {
  const k = keyOf(partyId)
  try {
    const { value, etag } = await kv.getWithMeta(k)
    if (parse(value)?.token !== token) return // it ran out and someone else holds it now
    await kv.setIfMatch(k, JSON.stringify({ token: null, until: 0 } satisfies Lease), etag, true)
  } catch (e) {
    // The lease runs out by itself.
    logger.warn('Party lock not released', { partyId, error: String(e) })
  }
}

/** Runs `fn` as the only time-changing action on this party (this server and every other). */
export function withPartyLock<T>(partyId: string, fn: () => Promise<T>): Promise<T> {
  return inProcess(partyId, async () => {
    const token = await acquire(partyId)
    const h: Held = { partyId, token, lost: false }
    const beat = setInterval(() => {
      if (h.lost) return
      renew(partyId, token).then((ok) => { if (!ok) h.lost = true }, () => undefined)
    }, renewMs)
    ;(beat as { unref?: () => void }).unref?.()
    try {
      return await held.run(h, fn)
    } finally {
      clearInterval(beat)
      await release(partyId, token)
    }
  })
}
