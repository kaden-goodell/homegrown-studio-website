/**
 * The /admin class screens talk to the owner-only class routes through this.
 * Every reply is `{ data, warning? }` or `{ error, ...extra }`; a network
 * failure reads like any other refusal, as a plain sentence.
 */
export interface Reply<T> {
  ok: boolean
  status: number
  data?: T
  warning?: string
  error?: string
  /** Anything else a refusal carries: `field`, `clashes`, `peopleToTell`. */
  extra: Record<string, any>
}

export const OFFLINE = "Couldn't reach the studio. Check the connection and try again."

export async function api<T>(url: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(url, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    const { data, warning, error, ...extra } = json ?? {}
    if (res.ok) return { ok: true, status: res.status, data, warning, extra }
    return { ok: false, status: res.status, error: error || (res.status === 401 ? 'Sign in first.' : 'That didn’t work. Try again.'), extra }
  } catch {
    return { ok: false, status: 0, error: OFFLINE, extra: {} }
  }
}

export const CLASSES = '/api/admin/classes/classes.json'
export const LIBRARY = '/api/admin/classes/library.json'
export const BLOCKED = '/api/admin/classes/blocked.json'
export const BOOKINGS = '/api/admin/classes/bookings.json'
export const CALENDAR = '/api/admin/classes/calendar.json'
export const DAY = '/api/admin/classes/day.json'
export const PHOTO = '/api/admin/classes/photo.json'
export const SEED = '/api/admin/classes/seed-sandbox.json'
