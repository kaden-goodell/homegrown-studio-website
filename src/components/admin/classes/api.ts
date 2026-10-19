/**
 * The /admin class screens talk to the owner-only class routes through this.
 * Every reply is `{ data, warning? }` or `{ error, ...extra }`; a network
 * failure reads like any other refusal, as a plain sentence.
 */
import { ADMIN_WHO_HEADER } from '@lib/admin-who'

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

let who = ''
let onSignedOut: (() => void) | null = null

/** The owner using this device ("Catherine"); sent as X-Admin-Who with every request so changes record who made them. */
export function setAdminWho(name: string): void {
  who = name
}
/** Called whenever any admin request comes back 401, so the whole page goes back to sign-in. */
export function onAdminSignedOut(fn: (() => void) | null): void {
  onSignedOut = fn
}
/** Headers every admin request carries. */
export function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, ...(who ? { [ADMIN_WHO_HEADER]: who } : {}) }
}

/** GET when there's no body, POST with JSON when there is; `method` for anything else (a DELETE). */
export async function api<T>(url: string, body?: unknown, method?: 'POST' | 'DELETE'): Promise<Reply<T>> {
  try {
    const res = await fetch(url, body === undefined && !method
      ? { cache: 'no-store', headers: adminHeaders() }
      : { method: method ?? 'POST', headers: adminHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body ?? {}) })
    const json = await res.json().catch(() => ({}))
    const { data, warning, error, ...extra } = json ?? {}
    if (res.ok) return { ok: true, status: res.status, data, warning, extra }
    if (res.status === 401) onSignedOut?.()
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
export const LOGIN = '/api/admin/login.json'
export const TO_DECIDE = '/api/admin/to-decide.json'
export const PARTY = '/api/admin/party.json'
export const REPORTS = '/api/admin/reports.json'
export const REQUESTS = '/api/admin/event-requests.json'
export const MESSAGES = '/api/admin/messages.json'
export const APPLICATIONS = '/api/admin/applications.json'
