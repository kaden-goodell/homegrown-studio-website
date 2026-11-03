import type { APIRoute } from 'astro'
import { checkPasscode, passcodeConfigured, staffCookie } from '@lib/staff-auth'
import { adminConfigured, checkAdminPasscode } from '@lib/admin-auth'
import { noteAdminFailedSignIn } from '@lib/admin-signin-failures'
import { listStaff } from '@lib/staff-directory'
import { ownerNames } from '@lib/admin-owners'
import { recordAudit } from '@lib/audit'
import { noteFailedSignIn, signInThrottle } from '@lib/staff-signin-failures'

export const prerender = false

/** Asked when an owner's name is picked: owners sign in to /staff with the ADMIN passcode (N1). */
export const OWNER_NEEDS_ADMIN = (name: string) => `To sign in as ${name}, enter the admin passcode.`
export const WRONG_ADMIN = 'That admin passcode isn’t right.'
export const ADMIN_UNAVAILABLE = 'Owners sign in here with the admin passcode, and it can’t be checked right now. Try again in a minute, or sign in to /admin to check it.'

/**
 * Second step of staff login: "Who's on the iPad?" Re-checks the passcode
 * (the picker screen carries it in a ref, never in state) and, given a staffId
 * from the roster `login.json` returned, sets the signed identity cookie.
 * POST { passcode, staffId, adminPasscode? } → { data: { staff } }
 *
 * Owners (N1): picking a person whose role is Owner also needs the ADMIN
 * passcode (the one /admin checks), else anyone who knows the shared staff
 * passcode could become "Catherine": full gift card numbers, unmasked
 * contacts, and money actions with no owner heads-up. Without it: 403
 * { needsAdminPasscode }. Wrong admin passcodes have their own limit (per
 * device, and looser per address) and count toward /admin's site-wide
 * wrong-passcode warning. Crew pick their name with the staff passcode alone.
 *
 * Shares login's limit (S1, N2): wrong staff passcodes counted per device
 * (5 per 5 minutes) and, more loosely, per address; a right one never counts.
 * Wrong passcodes also go into the site-wide count that warns the owners on Home.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const throttle = signInThrottle(request, clientAddress, 'staff')
  const refuse = (status: number, body: unknown, cookie?: string) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })
  if (throttle.full()) return refuse(429, { error: 'Too many attempts — wait a few minutes.' })
  if (!(await passcodeConfigured())) {
    return refuse(503, { error: 'Staff sign-in isn’t available right now. Try again in a minute. If it keeps happening, an owner can set the staff passcode in /admin › More › Staff › People.' })
  }
  const body = await request.json().catch(() => null)
  const passcode = typeof body?.passcode === 'string' ? body.passcode : ''
  const staffId = typeof body?.staffId === 'string' ? body.staffId : ''
  if (!(await checkPasscode(passcode))) {
    throttle.miss()
    await noteFailedSignIn()
    return refuse(401, { error: 'Incorrect passcode.' }, throttle.cookie)
  }
  const staff = (await listStaff()).find((m) => m.id === staffId)
  if (!staff) return refuse(400, { error: 'Unknown staff member — refresh and try again.' })
  if (staff.role === 'owner') {
    const adminPasscode = typeof body?.adminPasscode === 'string' ? body.adminPasscode : ''
    if (!adminPasscode) return refuse(403, { error: OWNER_NEEDS_ADMIN(staff.name), needsAdminPasscode: true })
    const owner = signInThrottle(request, clientAddress, 'owner')
    if (owner.full()) return refuse(429, { error: 'Too many tries. Wait a few minutes.', needsAdminPasscode: true })
    if (!(await adminConfigured())) return refuse(503, { error: ADMIN_UNAVAILABLE, needsAdminPasscode: true })
    if (!(await checkAdminPasscode(adminPasscode))) {
      owner.miss()
      await noteAdminFailedSignIn()
      await recordAudit({
        by: { id: 'unknown', name: 'Unknown (wrong admin passcode)', role: 'crew' },
        action: 'staff.owner-signin-refused',
        target: { kind: 'staff', id: staff.id, label: `${staff.name} (wrong admin passcode)` },
      })
      // 403, not 401: a 401 tells the screen the STAFF passcode went stale.
      return refuse(403, { error: WRONG_ADMIN, needsAdminPasscode: true }, owner.cookie)
    }
  }
  const cookie = await staffCookie(staff)
  await recordAudit({
    by: { id: staff.id, name: staff.name, role: staff.role },
    action: 'staff.signed-in',
    target: { kind: 'staff', id: staff.id, label: staff.name },
  })
  return new Response(JSON.stringify({ data: { staff, owners: await ownerNames() } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  })
}
