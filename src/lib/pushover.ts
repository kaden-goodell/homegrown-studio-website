/**
 * Kaden's alarms through Pushover (Kaden, 17 Nov 2026): an iPhone app that can
 * ring through silent and Focus for the alarms that matter, without making
 * every text from the studio number loud.
 *
 *   priority 2  emergency: rings through silent, Pushover itself repeats it
 *               every `retry` seconds until he opens it or `expire` passes.
 *               Used for urgent incidents (a booking broke, money unclear,
 *               site down). Carries our signed "Got it" link.
 *   priority 0  normal: heads-ups (rage taps), "Fixed", "Still happening".
 *   priority -1 quiet: those same notes from 11 PM to 6 AM studio time
 *               (no sound or vibration; waiting in the morning).
 *
 * Keys come from the site setup: PUSHOVER_APP_TOKEN (the app) and
 * PUSHOVER_USER_KEY (Kaden's account). Never logged. Never throws: the caller
 * falls back to a text when this says not sent.
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'

const logger = createLogger('pushover')
const API = 'https://api.pushover.net/1'
/** Pushover's emergency repeat: every 5 minutes for an hour, until opened. */
export const EMERGENCY_RETRY_SECONDS = 300
export const EMERGENCY_EXPIRE_SECONDS = 3600
const TIMEOUT_MS = 8000

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

export function pushoverConfigured(): boolean {
  return !!(env('PUSHOVER_APP_TOKEN') && env('PUSHOVER_USER_KEY'))
}

export interface PushoverMessage {
  title: string
  message: string
  priority: -1 | 0 | 2
  url?: string
  urlTitle?: string
  sound?: string
}

export interface PushoverResult {
  sent: boolean
  /** Emergency messages only: lets an acknowledgement stop Pushover's repeats. */
  receipt?: string
}

/** Test seam: the HTTP call. */
export const pushoverDeps = {
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
  /** Test runs never notify anyone, whatever keys are in .env. */
  blocked: (): boolean => typeof process !== 'undefined' && !!(process.env.VITEST || process.env.NODE_ENV === 'test'),
}

async function post(url: string, body: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await pushoverDeps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: ctrl.signal,
    })
  } catch (err) {
    logger.error('Pushover unreachable', { error: err instanceof Error ? err.name : 'error' })
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Never throws. */
export async function sendPushover(m: PushoverMessage): Promise<PushoverResult> {
  if (pushoverDeps.blocked()) return { sent: false }
  if (!pushoverConfigured()) return { sent: false }
  const body: Record<string, string> = {
    token: env('PUSHOVER_APP_TOKEN'),
    user: env('PUSHOVER_USER_KEY'),
    title: m.title.slice(0, 250),
    message: m.message.slice(0, 1024),
    priority: String(m.priority),
  }
  if (m.priority === 2) {
    body.retry = String(EMERGENCY_RETRY_SECONDS)
    body.expire = String(EMERGENCY_EXPIRE_SECONDS)
  }
  if (m.url) body.url = m.url.slice(0, 512)
  if (m.urlTitle) body.url_title = m.urlTitle.slice(0, 100)
  if (m.sound) body.sound = m.sound
  const res = await post(`${API}/messages.json`, body)
  if (!res) return { sent: false }
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* not JSON */
  }
  if (!res.ok || json?.status !== 1) {
    // Pushover's own error text names the bad field, never the key's value.
    logger.error('Pushover refused the alarm', { status: res.status, errors: Array.isArray(json?.errors) ? json.errors.join('; ').slice(0, 200) : '' })
    return { sent: false }
  }
  return { sent: true, ...(typeof json?.receipt === 'string' ? { receipt: json.receipt } : {}) }
}

/** Stops Pushover's own emergency repeats (after "Got it"). Never throws. */
export async function cancelPushoverReceipt(receipt: string): Promise<boolean> {
  if (pushoverDeps.blocked() || !pushoverConfigured() || !/^[A-Za-z0-9]{1,64}$/.test(receipt)) return false
  const res = await post(`${API}/receipts/${receipt}/cancel.json`, { token: env('PUSHOVER_APP_TOKEN') })
  return !!res?.ok
}
