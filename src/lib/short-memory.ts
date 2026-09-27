/**
 * Remember an answer for a short while, in memory only.
 *
 * The calendar and workshop lists ask Square the same questions on every
 * request. A server that has just asked can answer the next visitor from what
 * it already holds. Nothing is written anywhere: the memory goes when the
 * server instance does, and every entry expires on its own.
 *
 * Never use this where the answer decides a booking or a charge. Those ask
 * Square every time.
 */
const held = new Map<string, { until: number; value: Promise<unknown> }>()

export function remember<T>(key: string, forMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = held.get(key)
  if (hit && hit.until > now) return hit.value as Promise<T>

  const value = load()
  held.set(key, { until: now + forMs, value })
  // A failure is not worth remembering: the next request asks again.
  value.catch(() => {
    if (held.get(key)?.value === value) held.delete(key)
  })
  return value
}

/** Forget everything. For tests. */
export function forgetAll(): void {
  held.clear()
}
