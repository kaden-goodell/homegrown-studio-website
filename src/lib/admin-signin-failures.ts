/**
 * Wrong /admin passcodes for the whole site (L1). The per-address limit
 * (ADMIN_PASSCODE_BUCKET) lives in each server's memory, so a guessing run
 * spread over servers or addresses gets far more tries. This counts every
 * wrong admin passcode (sign-in, the current passcode in Admin access, and
 * the emailed recovery link) in one small store record:
 *
 *  - at MANY_ADMIN_FAILURES in a studio day the owners get one text and email
 *    ("Lots of wrong /admin passcodes today"), and Admin access says so;
 *  - at ADMIN_FAILURE_LOCK in a day, passcode sign-in stops for everyone until
 *    the next day or until the passcode is changed. The owners still get in
 *    with "Forgot the passcode?" (the emailed link), which isn't a guess.
 *
 * One record in kv `admin-access` (key `failed-signins`): the day, the count,
 * whether the owners were told. Never an address or what was typed. Best
 * effort: a store blip never changes what sign-in answers. Never written from
 * a test site that shares the live stores (R41).
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { studioDay } from '@lib/staff-signin-failures'

const logger = createLogger('admin-signin-failures')
const kv = makeKvStore('admin-access', 'admin-access')
const KEY = 'failed-signins'
/** The owners hear once a day at this many. */
export const MANY_ADMIN_FAILURES = 20
/** Passcode sign-in stops for the day at this many (the emailed link still works). */
export const ADMIN_FAILURE_LOCK = 200
const CAP = 100_000

export const ADMIN_LOCKED_MESSAGE = 'Too many wrong passcodes were typed today, so passcode sign-in is paused until tomorrow. Tap “Forgot the passcode?” to get an email link instead.'

interface Failures { day: string; count: number; told?: boolean }

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
    for (let attempt = 0; attempt < 3; attempt++) {
      const { value, etag } = await kv.getWithMeta(KEY)
      const cur = read(value)
      const same = cur && cur.day === day
      const count = same ? Math.min(cur!.count + 1, CAP) : 1
      const told = !!(same && cur!.told)
      tell = !told && count >= MANY_ADMIN_FAILURES
      if (await kv.setIfMatch(KEY, JSON.stringify({ day, count, told: told || tell }), etag, value !== null)) break
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

/** True when passcode sign-in is paused for today. False when it can't be read (a blip never locks anyone out). */
export async function adminSignInLocked(now = new Date()): Promise<boolean> {
  return (await adminFailedSignInsToday(now)) >= ADMIN_FAILURE_LOCK
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
