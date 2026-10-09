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

export interface SavedSession { cookie: string; savedAt: string | null }

export async function loadSessionRecord(): Promise<SavedSession | null> {
  try {
    const stored = await kv.get(KEY)
    if (stored) {
      const r = JSON.parse(stored) as { cookie: string; savedAt?: string }
      if (r.cookie) return { cookie: r.cookie, savedAt: r.savedAt ?? null }
    }
  } catch { /* fall through to env */ }
  const env = (import.meta as any).env?.SQUARE_DASHBOARD_COOKIE ?? process.env.SQUARE_DASHBOARD_COOKIE
  return env ? { cookie: String(env), savedAt: null } : null
}

export async function loadSession(): Promise<string | null> {
  return (await loadSessionRecord())?.cookie ?? null
}

/**
 * Fold a response's Set-Cookie values into the saved cookie string, so a
 * session Square refreshes is kept. Returns null when nothing changed.
 * A cookie Square deletes (empty value or Max-Age=0 / past Expires) is dropped.
 */
export function mergeSetCookies(cookie: string, setCookies: string[]): string | null {
  if (setCookies.length === 0) return null
  const jar = new Map<string, string>()
  for (const part of cookie.split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0) jar.set(part.slice(0, i), part.slice(i + 1))
  }
  let changed = false
  for (const sc of setCookies) {
    const [pair, ...attrs] = sc.split(';')
    const i = pair.indexOf('=')
    if (i <= 0) continue
    const name = pair.slice(0, i).trim()
    const value = pair.slice(i + 1).trim()
    const deleted = value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || (/^\s*expires=/i.test(a) && Date.parse(a.split('=').slice(1).join('=')) < Date.now()))
    if (deleted) { if (jar.delete(name)) changed = true; continue }
    if (jar.get(name) !== value) { jar.set(name, value); changed = true }
  }
  return changed ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null
}

export async function saveSession(cookie: string, savedAt = new Date().toISOString()): Promise<void> {
  await kv.set(KEY, JSON.stringify({ cookie, savedAt }))
}

/** fetch() against app.squareup.com with the saved session. Null when no session is saved. */
export async function dashboardFetch(path: string, init: { method?: string; body?: unknown } = {}, cookie?: string): Promise<Response | null> {
  const record = cookie ? null : await loadSessionRecord()
  const c = cookie ?? record?.cookie
  if (!c) return null
  const csrf = csrfFromCookie(c)
  if (!csrf) return null
  const res = await fetch(`${DASHBOARD_ORIGIN}${path}`, {
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
  // Keep whatever Square refreshes, so a session in regular use lasts longer.
  if (record && res.ok) {
    const merged = mergeSetCookies(c, res.headers.getSetCookie?.() ?? [])
    if (merged && csrfFromCookie(merged)) await saveSession(merged, record.savedAt ?? undefined).catch(() => {})
  }
  return res
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

export type AddAttendeeResult =
  | { ok: true; bookingId: string }
  | { ok: false; kind: 'signed_out' | 'refused' | 'no_answer'; status?: number; detail: string }

/**
 * Add one person to one class with NO payment — Square's own "Add attendee →
 * Skip payment". The seat shows "Not yet paid" in Square. Square sends the
 * person nothing; our confirmation email does that. One call = one seat.
 */
export async function addClassAttendee(params: { scheduleId: string; startAt: string; customerId: string }): Promise<AddAttendeeResult> {
  let res: Response | null
  try {
    res = await dashboardFetch('/appointments/api/class-bookings', {
      method: 'POST',
      body: {
        class_booking: { class_schedule_id: params.scheduleId, customer_id: params.customerId, start_at: params.startAt },
        client_message: { send_email: false, send_sms: false, custom_client_message_body: '', send_custom_client_message_body_to_client: false },
      },
    })
  } catch (err) {
    return { ok: false, kind: 'no_answer', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!res) return { ok: false, kind: 'signed_out', detail: 'No Square sign-in saved.' }
  const text = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) return { ok: false, kind: 'signed_out', status: res.status, detail: text.slice(0, 300) }
  if (!res.ok) return { ok: false, kind: res.status >= 500 ? 'no_answer' : 'refused', status: res.status, detail: text.slice(0, 300) }
  try {
    const id = (JSON.parse(text) as { class_booking?: { id?: string } }).class_booking?.id
    if (id) return { ok: true, bookingId: id }
  } catch { /* fall through */ }
  return { ok: false, kind: 'no_answer', status: res.status, detail: 'Square answered without a booking id.' }
}
