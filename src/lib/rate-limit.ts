/**
 * Per-IP sliding-window limiter. In-memory per serverless instance — not
 * airtight, but it turns "script the endpoint" into "script it slowly from
 * many IPs", which is the economic bar we need for a small venue.
 */
const hits = new Map<string, number[]>()

export function rateLimited(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (arr.length >= max) { hits.set(key, arr); return true }
  arr.push(now)
  hits.set(key, arr)
  if (hits.size > 10_000) evict(windowMs, now) // memory guard
  return false
}

/**
 * Targeted eviction: drop keys whose newest hit has aged out of the window
 * (they'd be treated as empty anyway). Only if that isn't enough do we fall
 * back to a full clear — resetting everyone beats an unbounded map.
 */
function evict(windowMs: number, now: number): void {
  for (const [key, arr] of hits) {
    const newest = arr[arr.length - 1]
    if (newest === undefined || now - newest >= windowMs) hits.delete(key)
  }
  if (hits.size > 10_000) hits.clear()
}
