/**
 * Square's private dashboard endpoints (add an attendee with no payment,
 * create a class) only accept a signed-in Square session, never our API key.
 * The session is the browser's app.squareup.com cookie, saved by
 * `scripts/save-square-session.ts` into the `square-session` blob store
 * (production) or SQUARE_DASHBOARD_COOKIE (.env, local).
 *
 * The session expires when Square signs it out; callers must treat
 * `expired` as normal and fall back to the open-in-Square path.
 */
import { makeKvStore } from './blob-store'

const kv = makeKvStore('square-session', 'square-session')
const KEY = 'cookie'
export const DASHBOARD_ORIGIN = 'https://app.squareup.com'

export type SessionCheck = { state: 'connected' } | { state: 'missing' } | { state: 'expired'; status: number } | { state: 'error'; detail: string }

/** Pull the cookie out of a pasted "Copy as cURL" (or accept a bare cookie string). */
export function cookieFromCurl(text: string): string | null {
  const t = text.trim()
  const flag = /(?:^|\s)(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/.exec(t)
  const header = /-H\s+(['"])cookie:\s*([\s\S]*?)\1/i.exec(t)
  const cookie = (flag?.[2] ?? header?.[2] ?? (/^[^\s=]+=/.test(t) && !/^curl\b/i.test(t) ? t : '')).trim()
  return csrfFromCookie(cookie) ? cookie : null
}

export function csrfFromCookie(cookie: string): string | null {
  return /(?:^|;\s*)_js_csrf=([^;]+)/.exec(cookie)?.[1] ?? null
}

export async function loadSession(): Promise<string | null> {
  try {
    const stored = await kv.get(KEY)
    if (stored) return (JSON.parse(stored) as { cookie: string }).cookie
  } catch { /* fall through to env */ }
  const env = (import.meta as any).env?.SQUARE_DASHBOARD_COOKIE ?? process.env.SQUARE_DASHBOARD_COOKIE
  return env ? String(env) : null
}

export async function saveSession(cookie: string, savedAt = new Date().toISOString()): Promise<void> {
  await kv.set(KEY, JSON.stringify({ cookie, savedAt }))
}

/** fetch() against app.squareup.com with the saved session. Null when no session is saved. */
export async function dashboardFetch(path: string, init: { method?: string; body?: unknown } = {}, cookie?: string): Promise<Response | null> {
  const c = cookie ?? (await loadSession())
  if (!c) return null
  const csrf = csrfFromCookie(c)
  if (!csrf) return null
  return fetch(`${DASHBOARD_ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      cookie: c,
      'x-csrf-token': csrf,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json',
      'content-type': 'application/json',
      origin: DASHBOARD_ORIGIN,
      referer: `${DASHBOARD_ORIGIN}/dashboard/appointments/calendar`,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

/** Read-only probe: can the saved session read this class schedule? */
export async function checkSession(scheduleId: string, cookie?: string): Promise<SessionCheck> {
  try {
    const res = await dashboardFetch(`/appointments/api/class-schedules/${encodeURIComponent(scheduleId)}`, {}, cookie)
    if (!res) return { state: 'missing' }
    if (res.ok) return { state: 'connected' }
    if (res.status === 401 || res.status === 403) return { state: 'expired', status: res.status }
    return { state: 'error', detail: `Square answered ${res.status}` }
  } catch (err) {
    return { state: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}
