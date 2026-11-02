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
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'

const logger = createLogger('staff-signin-failures')
const kv = makeKvStore('staff-access', 'staff-access')
const KEY = 'failed-signins'
/** Home warns at this many wrong passcodes in one studio day. */
export const MANY_FAILED_SIGNINS = 20
/** The count stops here (it only has to say "lots"). */
const CAP = 10_000

/** One per-address bucket of WRONG passcodes for both sign-in steps (login and pick both check it): 5 per 5 minutes. In memory, per server. */
export const SIGNIN_BUCKET = (ip: unknown) => `staff-login:${String(ip ?? 'unknown')}`
export const SIGNIN_MAX = 5
export const SIGNIN_WINDOW_MS = 5 * 60_000

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
    for (let attempt = 0; attempt < 3; attempt++) {
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
