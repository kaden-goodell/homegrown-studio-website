/**
 * A count of wrong staff passcodes, for the whole site (S1). Each server's
 * rate limit only slows one address down; this counts every wrong passcode
 * at /staff sign-in (both steps) so the owners hear about a guessing run:
 * Home shows "Lots of wrong staff passcodes today" with a button to change it.
 *
 * One small record in kv `staff-access` (key `failed-signins`): the studio
 * day and how many wrong passcodes were typed that day. Never an address, a
 * name or what was typed. Capped, so it stays tiny. Best effort: a store
 * blip never changes what sign-in answers. Started over when the passcode is
 * changed. Never written from a test site that shares the live stores (R41).
 *
 * Server only.
 */
import { randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { rateLimited, rateLimitFull } from '@lib/rate-limit'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('staff-signin-failures')
const kv = makeKvStore('staff-access', 'staff-access')
const KEY = 'failed-signins'
/** Home warns at this many wrong passcodes in one studio day. */
export const MANY_FAILED_SIGNINS = 20
/** The count stops here (it only has to say "lots"). */
const CAP = 10_000

/** One per-address bucket of WRONG passcodes for both sign-in steps (login and pick both check it). In memory, per server. */
export const SIGNIN_BUCKET = (ip: unknown) => `staff-login:${String(ip ?? 'unknown')}`
/** Wrong staff passcodes per DEVICE (N2): 5 per 5 minutes. */
export const SIGNIN_MAX = 5
export const SIGNIN_WINDOW_MS = 5 * 60_000
/**
 * Wrong staff passcodes per ADDRESS (N2). Every studio device shares the
 * wifi's one address, so this is looser than the per-device cap: one person
 * mistyping never locks the other iPads out, but a script that throws away
 * its device cookie is still slowed down.
 */
export const SIGNIN_IP_MAX = 30

/** Wrong ADMIN passcodes typed on /staff to become an owner (N1): their own buckets, apart from the staff passcode's. */
export const OWNER_SIGNIN_BUCKET = (ip: unknown) => `staff-owner:${String(ip ?? 'unknown')}`
export const OWNER_SIGNIN_MAX = 5
export const OWNER_SIGNIN_IP_MAX = 15
export const OWNER_SIGNIN_WINDOW_MS = 15 * 60_000

/** The device cookie: a random id per browser, only used to count wrong passcodes per device. Not a secret, proves nothing. */
const DEVICE_COOKIE = 'hg_device'
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/
const isProd = () => !!((typeof import.meta !== 'undefined' && (import.meta as any).env) || {}).PROD

function deviceOf(request: Request): { id: string; cookie?: string } {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|; )${DEVICE_COOKIE}=([^;]+)`))
  if (m && DEVICE_RE.test(m[1])) return { id: m[1] }
  const id = randomBytes(16).toString('base64url')
  return { id, cookie: `${DEVICE_COOKIE}=${id}; Path=/; HttpOnly;${isProd() ? ' Secure;' : ''} SameSite=Lax; Max-Age=${400 * 24 * 60 * 60}` }
}

/**
 * The wrong-passcode limits for one /staff request (N1, N2): a bucket for
 * this device (by its cookie) and a looser one for its address. `full()`
 * looks only; `miss()` counts one wrong passcode in both. `cookie` is the
 * device cookie to send back when this browser didn't have one yet (only
 * sent with a refusal, the only time it matters).
 */
export interface SignInThrottle { full(): boolean; miss(): void; cookie?: string }

export function signInThrottle(request: Request, ip: unknown, kind: 'staff' | 'owner'): SignInThrottle {
  const dev = deviceOf(request)
  const [bucket, max, ipMax, win] = kind === 'owner'
    ? [OWNER_SIGNIN_BUCKET, OWNER_SIGNIN_MAX, OWNER_SIGNIN_IP_MAX, OWNER_SIGNIN_WINDOW_MS]
    : [SIGNIN_BUCKET, SIGNIN_MAX, SIGNIN_IP_MAX, SIGNIN_WINDOW_MS]
  const devKey = `${bucket('device')}:${dev.id}`
  const ipKey = bucket(ip)
  return {
    full: () => rateLimitFull(devKey, max, win) || rateLimitFull(ipKey, ipMax, win),
    miss: () => { rateLimited(devKey, max, win); rateLimited(ipKey, ipMax, win) },
    ...(dev.cookie ? { cookie: dev.cookie } : {}),
  }
}

interface Failures { day: string; count: number }

/** Today's date at the studio (America/Chicago), YYYY-MM-DD. */
export function studioDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function read(json: string | null): Failures | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as Failures | null
    return v && typeof v.day === 'string' && typeof v.count === 'number' && Number.isFinite(v.count) ? v : null
  } catch {
    return null
  }
}

/** Count one wrong passcode. Never throws. */
export async function noteFailedSignIn(now = new Date()): Promise<void> {
  if (classWritesRefusal()) return
  const day = studioDay(now)
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await casPause(attempt)
      const { value, etag } = await kv.getWithMeta(KEY)
      const cur = read(value)
      const count = cur && cur.day === day ? Math.min(cur.count + 1, CAP) : 1
      if (await kv.setIfMatch(KEY, JSON.stringify({ day, count }), etag, value !== null)) return
    }
  } catch (err) {
    logger.warn('Could not count a wrong staff passcode', { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Wrong passcodes so far today (0 when it can't be read). */
export async function failedSignInsToday(now = new Date()): Promise<number> {
  try {
    const cur = read(await kv.get(KEY))
    return cur && cur.day === studioDay(now) ? cur.count : 0
  } catch {
    return 0
  }
}

/** Start the count over (the passcode was just changed). Never throws. */
export async function clearFailedSignIns(): Promise<void> {
  if (classWritesRefusal()) return
  try {
    await kv.set(KEY, 'null')
  } catch (err) {
    logger.warn('Could not start the wrong-passcode count over', { error: err instanceof Error ? err.message : String(err) })
  }
}
