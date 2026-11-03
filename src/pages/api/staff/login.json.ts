import type { APIRoute } from 'astro'
import { checkPasscode, passcodeConfigured, clearStaffCookie } from '@lib/staff-auth'
import { listStaff } from '@lib/staff-directory'
import { recordAudit } from '@lib/audit'
import { noteFailedSignIn, signInThrottle } from '@lib/staff-signin-failures'

export const prerender = false

/**
 * First step of staff login: check the shared passcode and hand back the team
 * roster to pick from — no cookie yet. `pick.json` sets the identity cookie
 * once a specific staff member is chosen.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Wrong passcodes are counted per device (5 per 5 minutes) and, more loosely, per address (N2), shared with pick.json (S1); right ones don't count.
  const throttle = signInThrottle(request, clientAddress, 'staff')
  if (throttle.full()) {
    return new Response(JSON.stringify({ error: 'Too many attempts — wait a few minutes.' }), { status: 429 })
  }
  if (!(await passcodeConfigured())) {
    return new Response(JSON.stringify({ error: 'Staff sign-in isn’t available right now. Try again in a minute. If it keeps happening, an owner can set the staff passcode in /admin › More › Staff › People.' }), { status: 503 })
  }
  const body = await request.json().catch(() => null)
  const passcode = typeof body?.passcode === 'string' ? body.passcode : ''
  if (!(await checkPasscode(passcode))) {
    // A wrong passcode has no staff identity yet; log where it came from.
    // (A good one is logged at pick.json, once a person is chosen. Rate-limited
    // requests return above, so this can't be used to flood the log.)
    throttle.miss()
    await noteFailedSignIn()
    await recordAudit({
      by: { id: 'unknown', name: 'Unknown (wrong passcode)', role: 'crew' },
      action: 'staff.login-refused',
      target: { kind: 'staff-login', id: String(clientAddress ?? 'unknown') },
    })
    return new Response(JSON.stringify({ error: 'Incorrect passcode.' }), { status: 401, headers: throttle.cookie ? { 'Set-Cookie': throttle.cookie } : {} })
  }
  return new Response(JSON.stringify({ data: { staff: await listStaff() } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Log out. */
export const DELETE: APIRoute = async () => {
  return new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearStaffCookie() },
  })
}
