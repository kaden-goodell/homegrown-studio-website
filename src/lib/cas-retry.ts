/**
 * One shared rule for compare-and-swap write loops (read with etag → change →
 * conditional write → on a lost race, read again).
 *
 * Before (final concurrency review I-7): every store gave up after 3 tries
 * back to back. A popular class opening with ~10 people booking at once across
 * servers, plus webhook echoes on the same document, lost all 3 often enough
 * to turn away buyers ("unavailable") or raise false "paid, seats not
 * recorded" alarms.
 *
 * Now: CAS_ATTEMPTS tries, and before every retry a short random pause
 * (≈10 ms growing to ≤150 ms, jittered) so the racers spread out instead of
 * colliding again on the very next millisecond. Worst case ~0.5 s in total.
 *
 * Use:
 *   for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
 *     await casPause(attempt)
 *     const { value, etag } = await kv.getWithMeta(key)
 *     …
 *     if (await kv.setIfMatch(key, json, etag, value !== null)) return …
 *   }
 * or the wrapper `casRetry`.
 */

export const CAS_ATTEMPTS = 7

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
// Under vitest the pause is skipped by default (suites with fake timers would hang on it); a test opts in with _setCasSleepForTests.
const defaultSleep = (ms: number) => (typeof process !== 'undefined' && process.env.VITEST ? Promise.resolve() : realSleep(ms))
let sleep: (ms: number) => Promise<void> = defaultSleep

/** Tests: swap the pause (e.g. for fake timers or to record it). Pass nothing to restore the real one. */
export function _setCasSleepForTests(fn?: (ms: number) => Promise<void>): void {
  sleep = fn ?? defaultSleep
}

/** The pause before try `attempt` (0-based): none before the first try. */
export function casDelayMs(attempt: number, random: () => number = Math.random): number {
  if (attempt <= 0) return 0
  const cap = Math.min(150, 10 * 2 ** (attempt - 1))
  // jitter between 10 ms and the cap
  return Math.round(10 + random() * Math.max(0, cap - 10))
}

/** Waits the jittered pause before a retry (nothing on the first try). */
export async function casPause(attempt: number): Promise<void> {
  const ms = casDelayMs(attempt)
  if (ms > 0) await sleep(ms)
}

/**
 * Runs `step` up to CAS_ATTEMPTS times with the jittered pause between tries.
 * `step` returns `{ done: true, value }` when its write landed (or nothing
 * needed writing), `{ done: false }` when the conditional write lost.
 */
export async function casRetry<T>(
  step: (attempt: number) => Promise<{ done: true; value: T } | { done: false }>,
  giveUp: () => never | T = () => { throw new Error('Concurrent update — please retry') },
): Promise<T> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const r = await step(attempt)
    if (r.done) return r.value
  }
  return giveUp()
}
