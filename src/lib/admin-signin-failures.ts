/**
 * Wrong /admin passcodes for the whole site (L1). The per-address limit
 * (ADMIN_PASSCODE_BUCKET) lives in each server's memory, so a guessing run
 * spread over servers or addresses gets far more tries. This counts every
 * wrong admin passcode (sign-in, the current passcode in Admin access, and
 * the emailed recovery link) in one small store record:
 *
 *  - at MANY_ADMIN_FAILURES in a studio day the owners get one text and email
 *    ("Lots of wrong /admin passcodes today"), and Admin access says so;
 *  - from ADMIN_SLOWDOWN_AT in a day, passcode tries slow down for the whole
 *    site (N2): each one has to wait a little after the last wrong one, the
 *    wait doubling every ADMIN_SLOWDOWN_STEP more wrong ones, never more than
 *    ADMIN_SLOWDOWN_MAX_MS. It never stops altogether, so nobody (with no
 *    sign-in at all) can close /admin to the owners for a day; the
 *    per-address limit in memory still applies on top. The owners can also
 *    use "Forgot the passcode?" (the emailed link), which isn't a guess.
 *
 * One record in kv `admin-access` (key `failed-signins`): the day, the count,
 * when the last wrong one was, whether the owners were told. Never an
 * address or what was typed. Best
 * effort: a store blip never changes what sign-in answers. Never written from
 * a test site that shares the live stores (R41).
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { studioDay } from '@lib/staff-signin-failures'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('admin-signin-failures')
const kv = makeKvStore('admin-access', 'admin-access')
const KEY = 'failed-signins'
/** The owners hear once a day at this many. */
export const MANY_ADMIN_FAILURES = 20
/** From this many wrong ones in a day, passcode tries slow down site-wide. */
export const ADMIN_SLOWDOWN_AT = 50
/** The wait doubles every this many more. */
export const ADMIN_SLOWDOWN_STEP = 50
const SLOWDOWN_FIRST_MS = 2_000
/** The longest anyone ever waits between tries: sign-in never closes. */
export const ADMIN_SLOWDOWN_MAX_MS = 30_000
const CAP = 100_000

export const adminSlowMessage = (seconds: number) =>
  `Lots of wrong passcodes were typed today, so sign-in is slowed down. Wait ${seconds} second${seconds === 1 ? '' : 's'} and try again, or tap “Forgot the passcode?” to get an email link.`

interface Failures { day: string; count: number; told?: boolean; last?: number }

/** The gap needed after the last wrong passcode at `count` wrong ones today. Pure. */
export function slowdownGapMs(count: number): number {
  if (count < ADMIN_SLOWDOWN_AT) return 0
  const doublings = Math.floor((count - ADMIN_SLOWDOWN_AT) / ADMIN_SLOWDOWN_STEP)
  return Math.min(ADMIN_SLOWDOWN_MAX_MS, SLOWDOWN_FIRST_MS * 2 ** Math.min(doublings, 20))
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

/** Count one wrong admin passcode; tells the owners once at MANY_ADMIN_FAILURES. Never throws. */
export async function noteAdminFailedSignIn(now = new Date()): Promise<void> {
  if (classWritesRefusal()) return
  const day = studioDay(now)
  let tell = false
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await casPause(attempt)
      const { value, etag } = await kv.getWithMeta(KEY)
      const cur = read(value)
      const same = cur && cur.day === day
      const count = same ? Math.min(cur!.count + 1, CAP) : 1
      const told = !!(same && cur!.told)
      tell = !told && count >= MANY_ADMIN_FAILURES
      if (await kv.setIfMatch(KEY, JSON.stringify({ day, count, told: told || tell, last: now.getTime() }), etag, value !== null)) break
      tell = false
    }
  } catch (err) {
    logger.warn('Could not count a wrong admin passcode', { error: err instanceof Error ? err.message : String(err) })
    return
  }
  if (tell) {
    logger.error('Many wrong admin passcodes today', { day })
    const { tellOwners } = await import('@lib/owner-notice')
    await tellOwners({
      subject: '⚠ Lots of wrong /admin passcodes today',
      line: `Someone has typed a wrong /admin passcode ${MANY_ADMIN_FAILURES} times today. If that wasn’t one of you, change the admin passcode in /admin › More › Admin access.`,
    }).catch(() => undefined)
  }
}

/** Wrong admin passcodes so far today (0 when it can't be read). */
export async function adminFailedSignInsToday(now = new Date()): Promise<number> {
  try {
    const cur = read(await kv.get(KEY))
    return cur && cur.day === studioDay(now) ? cur.count : 0
  } catch {
    return 0
  }
}

/**
 * Whole seconds to wait before the next passcode try is checked (0 = go
 * ahead). Never a full stop: at most ADMIN_SLOWDOWN_MAX_MS. 0 when it can't
 * be read (a blip never keeps anyone out).
 */
export async function adminSignInWait(now = new Date()): Promise<number> {
  try {
    const cur = read(await kv.get(KEY))
    if (!cur || cur.day !== studioDay(now)) return 0
    const gap = slowdownGapMs(cur.count)
    if (!gap || typeof cur.last !== 'number') return 0
    const left = cur.last + gap - now.getTime()
    return left > 0 ? Math.ceil(left / 1000) : 0
  } catch {
    return 0
  }
}

/** The 429 answer while slowed down, or null to go ahead. */
export async function adminSlowdown(now = new Date()): Promise<{ error: string; wait: number } | null> {
  const wait = await adminSignInWait(now)
  return wait > 0 ? { error: adminSlowMessage(wait), wait } : null
}

/** Start the count over (the passcode was just changed). Never throws. */
export async function clearAdminFailedSignIns(): Promise<void> {
  if (classWritesRefusal()) return
  try {
    await kv.set(KEY, 'null')
  } catch (err) {
    logger.warn('Could not start the wrong admin passcode count over', { error: err instanceof Error ? err.message : String(err) })
  }
}
