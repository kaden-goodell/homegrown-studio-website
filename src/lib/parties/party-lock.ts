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
 *    servers never run the same party's change at once. A lease lasts
 *    LEASE_MS, longer than any function may run, so a server that dies
 *    holding one frees it by itself. A request that can't get the lease in
 *    WAIT_MS is refused with a plain "try again" (nothing changed).
 *
 * Server only.
 */
import { randomUUID } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('parties:lock')
const kv = makeKvStore('party-locks', 'party-locks')

/** Longer than a Netlify function may run (26 s), so a lease never outlives the request that took it unless it died. */
const LEASE_MS = 30_000
let waitMs = 6_000
const POLL_MS = 150

/** Test-only: how long to wait for another server's lease. */
export function _setPartyLockWaitMs(ms: number): void { waitMs = ms }

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
      if (await kv.setIfMatch(k, JSON.stringify({ token, until: Date.now() + LEASE_MS } satisfies Lease), etag, value !== null)) return token
    }
    if (performance.now() >= deadline) throw new PartyBusyError()
    await sleep(POLL_MS)
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
    try {
      return await fn()
    } finally {
      await release(partyId, token)
    }
  })
}
