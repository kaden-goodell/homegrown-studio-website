import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit } from '@lib/audit'
import { cleanPasscode, passcodeStatus, PasscodeError, PASSCODE_MESSAGES, setStaffPasscode } from '@lib/staff-passcode'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { failedSignInsToday, MANY_FAILED_SIGNINS } from '@lib/staff-signin-failures'
import { json, staffingFailure } from '@lib/staffing/http'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff-passcode')

/**
 * Owners only: the staff passcode, /admin › More › Staff › People › Staff passcode.
 * GET  → { setInAdmin, updatedAt, by, damaged, readOnly, failedToday, manyFailed } (never the passcode).
 *   damaged: the saved one can't be used (nobody can sign in to /staff); saving a new one repairs it.
 *   manyFailed: lots of wrong staff passcodes today (Home shows a line with a button).
 * POST { passcode, again, expectedUpdatedAt } → { updatedAt }
 *   Saves a salted hash; the old passcode stops working and everyone is signed
 *   out of /staff. Someone else changed it first → 409. Audited (never the passcode).
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  try {
    const [status, failedToday] = await Promise.all([passcodeStatus(), failedSignInsToday()])
    return json(200, { data: { ...status, readOnly: !!classWritesRefusal(), failedToday, manyFailed: failedToday >= MANY_FAILED_SIGNINS } })
  } catch (e) {
    logger.error('Staff passcode status could not be read', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: PASSCODE_MESSAGES.unreadable })
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  const by = adminActor(request)
  try {
    const passcode = cleanPasscode(body.passcode, body.again)
    const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
    const saved = await setStaffPasscode(passcode, by, expected)
    await recordAudit({ by: { ...by, role: 'owner' }, action: 'staff.passcode-changed', target: { kind: 'staff', id: 'passcode', label: 'Staff passcode' } })
    return json(200, { data: { updatedAt: saved.updatedAt } })
  } catch (e) {
    if (e instanceof PasscodeError) return json(e.status, { error: e.message, ...(e.status === 409 ? { stale: true } : {}) })
    return staffingFailure(e)
  }
}
