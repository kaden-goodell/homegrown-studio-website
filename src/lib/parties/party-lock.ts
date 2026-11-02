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
 *    refuses (PartyLockLostError, nothing written) if another server took it
 *    over meanwhile, or if the store can't confirm it and the last good
 *    renewal is older than the lease;
 *  - renewals are one at a time per lease (the heartbeat skips while one is
 *    in flight, a fencing check queues behind it), and "not ours" is decided
 *    by re-reading the lease's holder, never by a lost compare-and-set alone;
 *  - after a real loss (`partyLockTaken()`), callers skip their cleanup
 *    writes, which could undo the other server's change.
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

export const PARTY_BUSY = 'Someone else is changing this party right now. Wait a moment, then try again. Nothing was changed.'

export class PartyBusyError extends Error {
  constructor(message: string = PARTY_BUSY) { super(message) }
}

/**
 * The lease was lost while the action ran (thrown by assertPartyLockHeld):
 * `taken` = another server holds it now; `unreachable` = the store couldn't
 * confirm it for longer than a lease. Callers that already wrote something
 * say so in their own words (the default here says only that it stopped).
 */
export class PartyLockLostError extends PartyBusyError {
  constructor(public reason: 'taken' | 'unreachable') {
    super(reason === 'taken'
      ? 'Someone else started changing this party at the same moment, so this stopped. Open the party again to check it, then try again.'
      : 'The party couldn’t be reached for a while, so this stopped to be safe. Open the party again to check it, then try again.')
  }
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

/**
 * The action's hold on the lease.
 *  - `lost`: another server holds the lease now (decided by re-reading it, never by a
 *    failed compare-and-set alone, which our own heartbeat can cause). Final.
 *  - `validUntil`: monotonic time until which the lease is surely ours: the start of
 *    the last successful renewal plus the lease, less a margin (N2b).
 *  - `chain`: renewals run one at a time per lease (heartbeat and fencing never race, N2a).
 */
interface Held { partyId: string; token: string; lost: boolean; validUntil: number; chain: Promise<unknown>; renewing: boolean }

const marginMs = () => Math.min(2_000, Math.floor(leaseMs / 5))

/**
 * Extends our lease, one renewal at a time. 'ok' (renewed), 'lost' (the
 * store says another server holds it now). Throws when the store can't be
 * reached (the caller decides by `validUntil`).
 */
function renewHeld(h: Held): Promise<'ok' | 'lost'> {
  const run = h.chain.then(async (): Promise<'ok' | 'lost'> => {
    h.renewing = true
    try {
      if (h.lost) return 'lost'
      const k = keyOf(h.partyId)
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = performance.now()
        const { value, etag } = await kv.getWithMeta(k)
        if (parse(value)?.token !== h.token) { h.lost = true; return 'lost' }
        if (await kv.setIfMatch(k, JSON.stringify({ token: h.token, until: Date.now() + leaseMs } satisfies Lease), etag, true)) {
          h.validUntil = started + leaseMs - marginMs()
          return 'ok'
        }
        // The compare-and-set lost: read the lease again and decide by its holder.
      }
      throw new Error('Party lock not renewed after 3 tries')
    } finally {
      h.renewing = false
    }
  })
  h.chain = run.catch(() => undefined)
  return run
}

const held = new AsyncLocalStorage<Held>()

/**
 * Fencing: call right before a write that matters. Renews the lease and
 * throws PartyLockLostError (nothing written) when another server holds it
 * now, or when the store can't confirm it and the last renewal is older
 * than the lease. Outside withPartyLock it does nothing.
 */
export async function assertPartyLockHeld(): Promise<void> {
  const h = held.getStore()
  if (!h) return
  let res: 'ok' | 'lost'
  try {
    res = await renewHeld(h)
  } catch (e) {
    logger.warn('Party lock not renewed', { partyId: h.partyId, error: String(e) })
    // The store didn't answer: the lease stands only while the last renewal is fresh.
    if (performance.now() < h.validUntil) return
    logger.error('PARTY LOCK unconfirmed before a write', { partyId: h.partyId })
    throw new PartyLockLostError('unreachable')
  }
  if (res === 'lost') {
    logger.error('PARTY LOCK lost before a write', { partyId: h.partyId })
    throw new PartyLockLostError('taken')
  }
}

/**
 * True when this action's lease was taken by another server: its cleanup
 * writes (letting a time go, shrinking a hold back) must not run, since they
 * could undo that server's write (N2c). False outside a lock.
 */
export function partyLockTaken(): boolean {
  return held.getStore()?.lost === true
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
    const started = performance.now()
    const token = await acquire(partyId)
    const h: Held = { partyId, token, lost: false, validUntil: started + leaseMs - marginMs(), chain: Promise.resolve(), renewing: false }
    const beat = setInterval(() => {
      // One renewal in flight at a time; a fencing check queued meanwhile renews after it.
      if (h.lost || h.renewing) return
      renewHeld(h).catch((e) => logger.warn('Party lock heartbeat failed', { partyId, error: String(e) }))
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
