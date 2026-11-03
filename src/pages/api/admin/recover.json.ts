import type { APIRoute } from 'astro'
import { adminSignInCookie, envAdminPasscode } from '@lib/admin-auth'
import {
  ADMIN_PASSCODE_BUCKET, ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_MESSAGES, ADMIN_PASSCODE_WINDOW_MS,
  AdminPasscodeError, cleanAdminPasscode, setAdminPasscode, TOO_MANY_TRIES,
} from '@lib/admin-passcode'
import { checkRecovery, consumeRecovery, RECOVERY_MESSAGES, recoveryOrigin, RecoveryError, requestRecovery } from '@lib/admin-recovery'
import { clearAdminFailedSignIns, noteAdminFailedSignIn } from '@lib/admin-signin-failures'
import { recordAudit } from '@lib/audit'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { studioWhen, tellOwners } from '@lib/owner-notice'
import { rateLimited } from '@lib/rate-limit'
import { checkPasscode as matchesStaffPasscode } from '@lib/staff-auth'

export const prerender = false

const logger = createLogger('api:admin-recover')

const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  })

/** Asks per address, in memory (the site-wide limits are in the store). */
export const ASK_MAX = 3
export const ASK_WINDOW_MS = 15 * 60_000

/** Who set it, in the audit and the history: the link went to every owner, so it can't say which. */
const BY = { id: 'recovery', name: 'Emailed link' }

/**
 * "Forgot the passcode?" (M3). Signed out, so no admin cookie is needed.
 * POST { action: 'request' } → { message }: emails a single-use, 15-minute
 *   link to every owner's email on the staff list (nothing is typed, so the
 *   answer can't reveal who the owners are). While a link sent earlier still
 *   works, nothing is sent or counted (same answer). Rate limited per
 *   address and, in the store, 3 an hour for the whole site.
 * POST { action: 'check', token } → { state }: opening the link; never uses it up.
 * POST { action: 'use', token, passcode, again } → signs this device in:
 *   the same rules as Admin access, then the link is used up, the passcode is
 *   set (everyone else signed out), audited, every owner emailed and texted.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const body = await request.json().catch(() => null)
  const action = body && typeof body === 'object' ? (body as { action?: unknown }).action : null

  if (action === 'request') {
    if (rateLimited(`admin-recover-ask:${String(clientAddress ?? 'unknown')}`, ASK_MAX, ASK_WINDOW_MS)) return json(429, { error: RECOVERY_MESSAGES.limited })
    try {
      const r = await requestRecovery(recoveryOrigin(request.url))
      if (r === 'limited') return json(429, { error: RECOVERY_MESSAGES.limited })
      // A link from earlier still works: the same answer, nothing sent or counted (N2).
      if (r === 'live') return json(200, { data: { message: RECOVERY_MESSAGES.sent } })
      await recordAudit({ by: { ...BY, role: 'owner' }, action: 'admin.recovery-requested', target: { kind: 'admin', id: 'passcode', label: 'Admin passcode' } })
      return json(200, { data: { message: RECOVERY_MESSAGES.sent } })
    } catch (e) {
      if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
      if (e instanceof RecoveryError) return json(e.status, { error: e.message })
      logger.error('Recovery link could not be sent', { error: e instanceof Error ? e.message : String(e) })
      return json(503, { error: RECOVERY_MESSAGES.unreadable })
    }
  }

  const token = body && typeof body === 'object' ? (body as { token?: unknown }).token : null

  if (action === 'check') {
    try {
      const state = await checkRecovery(token)
      return json(200, { data: { state, ...(state === 'ok' ? {} : { message: RECOVERY_MESSAGES[state] }) } })
    } catch (e) {
      if (e instanceof RecoveryError) return json(e.status, { error: e.message })
      return json(503, { error: RECOVERY_MESSAGES.unreadable })
    }
  }

  if (action === 'use') {
    // Tries share the admin sign-in limit (and an old or wrong link counts site-wide, L1).
    if (rateLimited(ADMIN_PASSCODE_BUCKET(clientAddress), ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS)) return json(429, { error: TOO_MANY_TRIES })
    try {
      // The link must still be good before anything else is checked (no use telling her the rules on a dead link).
      const state = await checkRecovery(token)
      if (state !== 'ok') {
        await noteAdminFailedSignIn()
        return json(state === 'unknown' ? 400 : 410, { error: RECOVERY_MESSAGES[state], state })
      }
      const b = body as { passcode?: unknown; again?: unknown }
      const passcode = cleanAdminPasscode(b.passcode, b.again)
      if (await matchesStaffPasscode(passcode).catch(() => false)) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.staff)
      // Used up only now, on submit with a passcode that passes every rule: compare-and-set, so two tabs can't both use it.
      await consumeRecovery(token)
      await setAdminPasscode(passcode, BY, 'any', envAdminPasscode())
      await recordAudit({ by: { ...BY, role: 'owner' }, action: 'admin.recovery-used', target: { kind: 'admin', id: 'passcode', label: 'Admin passcode' } })
      await clearAdminFailedSignIns()
      await tellOwners({
        subject: '⚠ The /admin passcode was reset with an emailed link',
        line: `The /admin passcode was reset with the emailed link (${studioWhen()}). Every phone and iPad was signed out. If none of you did this, use “Forgot the passcode?” on the /admin sign-in page now, then check Staff › People and Notifications.`,
      })
      return json(200, { data: { ok: true } }, await adminSignInCookie())
    } catch (e) {
      if (e instanceof AdminPasscodeError) return json(e.status, { error: e.message })
      if (e instanceof RecoveryError) return json(e.status, { error: e.message, ...(e.state ? { state: e.state } : {}) })
      if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
      logger.error('Recovery link could not be used', { error: e instanceof Error ? e.message : String(e) })
      return json(503, { error: RECOVERY_MESSAGES.unreadable })
    }
  }

  return json(400, { error: 'That isn’t something this page can do.' })
}
