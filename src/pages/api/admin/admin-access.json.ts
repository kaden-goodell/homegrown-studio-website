import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized, adminSignInCookie, checkAdminPasscode, envAdminPasscode } from '@lib/admin-auth'
import { ownerList } from '@lib/admin-owners'
import {
  ADMIN_PASSCODE_BUCKET, ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_MESSAGES, ADMIN_PASSCODE_MIN, ADMIN_PASSCODE_WINDOW_MS,
  AdminPasscodeError, adminPasscodeStatus, cleanAdminPasscode, setAdminPasscode, TOO_MANY_TRIES,
} from '@lib/admin-passcode'
import { recordAudit } from '@lib/audit'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { checkPasscode as matchesStaffPasscode } from '@lib/staff-auth'
import { adminFailedSignInsToday, adminSlowdown, clearAdminFailedSignIns, MANY_ADMIN_FAILURES, noteAdminFailedSignIn } from '@lib/admin-signin-failures'
import { deviceSaid, ownersSnapshot, studioWhen, tellOwners } from '@lib/owner-notice'
import { json } from '@lib/staffing/http'

export const prerender = false

const logger = createLogger('api:admin-access')

/**
 * Owners only: /admin › More › Admin access (G4).
 * GET → { setInAdmin, updatedAt, by, damaged, settingTookOver, readOnly, min, owners: [{ id, name, hasEmail, hasPhone }], ownerSource }
 *   settingTookOver: a new ADMIN_PASSCODE setting is in use (the forgot-it way back) until a new one is saved here.
 *   Never the passcode. owners: who counts as an owner now (the staff list's
 *   Owners, or Catherine and Kaden until that list exists).
 * POST { current, passcode, again, expectedUpdatedAt } → { updatedAt }
 *   The current passcode first (tries shared with /admin sign-in, so this is
 *   no back door for guessing). Saves a salted hash; every device is signed
 *   out of /admin, and this one gets a fresh sign-in in the same answer.
 *   Someone else changed it first → 409. Audited (never the passcode).
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  try {
    const [status, list, failedToday] = await Promise.all([adminPasscodeStatus(envAdminPasscode()), ownerList(), adminFailedSignInsToday()])
    return json(200, {
      data: {
        ...status,
        failedToday,
        manyFailed: failedToday >= MANY_ADMIN_FAILURES,
        readOnly: !!classWritesRefusal(),
        min: ADMIN_PASSCODE_MIN,
        owners: list.owners.map((o) => ({ id: o.id, name: o.name, hasEmail: !!o.email, hasPhone: !!o.phone })),
        ownerSource: list.source,
      },
    })
  } catch (e) {
    logger.error('Admin access could not be read', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: ADMIN_PASSCODE_MESSAGES.unreadable })
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  // Counted like a sign-in try, before anything is checked.
  if (rateLimited(ADMIN_PASSCODE_BUCKET(clientAddress), ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS)) return json(429, { error: TOO_MANY_TRIES })
  const slow = await adminSlowdown()
  if (slow) return json(429, slow)
  const by = await adminActor(request)
  try {
    // 403, never 401: a wrong current passcode must not sign this device out. Exactly as typed (L3).
    const current = typeof body.current === 'string' ? body.current : ''
    if (!(await checkAdminPasscode(current))) {
      await noteAdminFailedSignIn()
      throw new AdminPasscodeError(403, current && current !== current.trim() ? ADMIN_PASSCODE_MESSAGES.currentSpaces : ADMIN_PASSCODE_MESSAGES.current)
    }
    const passcode = cleanAdminPasscode(body.passcode, body.again)
    if (await checkAdminPasscode(passcode)) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.same)
    if (await matchesStaffPasscode(passcode).catch(() => false)) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.staff)
    const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    const before = await ownersSnapshot()
    const { rec } = await setAdminPasscode(passcode, by, expected, envAdminPasscode())
    await recordAudit({ by: { ...by, role: 'owner' }, action: 'admin.passcode-changed', target: { kind: 'admin', id: 'passcode', label: 'Admin passcode' } })
    await clearAdminFailedSignIns()
    // Every owner hears, the named one too (a stolen session can't quietly lock them out).
    await tellOwners({
      owners: before,
      subject: 'The /admin passcode was changed',
      line: `${deviceSaid(by)} changed the /admin passcode (${studioWhen()}). Every other phone or iPad is signed out. If that wasn’t expected, use “Forgot the passcode?” on the /admin sign-in page.`,
    })
    // Everyone else is signed out by the new generation; this device signs in again on the spot.
    return json(200, { data: { updatedAt: rec.updatedAt } }, { 'Set-Cookie': await adminSignInCookie() })
  } catch (e) {
    if (e instanceof AdminPasscodeError) return json(e.status, { error: e.message, ...(e.status === 409 ? { stale: true } : {}) })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Admin passcode could not be saved', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: ADMIN_PASSCODE_MESSAGES.unreadable })
  }
}
