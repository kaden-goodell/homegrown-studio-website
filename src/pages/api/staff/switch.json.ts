import type { APIRoute } from 'astro'
import { staffAuthorized, staffCookie } from '@lib/staff-auth'
import { listStaff } from '@lib/staff-directory'
import { recordAudit } from '@lib/audit'
import { adminConfigured, checkAdminPasscode } from '@lib/admin-auth'
import { noteAdminFailedSignIn } from '@lib/admin-signin-failures'
import { signInThrottle } from '@lib/staff-signin-failures'

export const prerender = false
const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })

/** The refusal when an owner is picked without the admin passcode (the screen asks for it). */
export const OWNER_NEEDS_PASSCODE = (name: string) => `To switch to ${name}, enter the admin passcode.`
export const WRONG_ADMIN = 'That admin passcode isn’t right.'

/**
 * "Switch person" without the passcode screen (Kaden, 15 Oct 2026). Someone
 * already signed in on this device hands it to a teammate: the signed-in
 * cookie is the proof, the same trust as picking a name after the passcode.
 * GET → the team to pick from. POST { staffId } → signed in as them.
 *
 * Except owners (DV19, N1): switching TO an owner (not yourself) needs the
 * ADMIN passcode, the one /admin checks, `{ staffId, adminPasscode }`, so
 * nobody who knows the shared staff passcode becomes "Catherine" for refunds
 * and gift-card numbers. Crew to crew stays one tap. Wrong admin passcodes
 * have their own limit (per device, and looser per address), apart from the
 * staff passcode screen's, and count toward /admin's wrong-passcode warning.
 */
export const GET: APIRoute = async ({ request }) => {
  const me = await staffAuthorized(request)
  if (!me) return json(401, { error: 'Signed out — enter the passcode.' })
  return json(200, { data: { staff: await listStaff(), me } })
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const me = await staffAuthorized(request)
  if (!me) return json(401, { error: 'Signed out — enter the passcode.' })
  const body = await request.json().catch(() => null)
  const staffId = typeof body?.staffId === 'string' ? body.staffId : ''
  const next = (await listStaff()).find((m) => m.id === staffId)
  if (!next) return json(400, { error: 'Unknown staff member — refresh and try again.' })
  if (next.role === 'owner' && next.id !== me.id) {
    const passcode = typeof body?.adminPasscode === 'string' ? body.adminPasscode : ''
    if (!passcode) return json(403, { error: OWNER_NEEDS_PASSCODE(next.name), needsAdminPasscode: true })
    const throttle = signInThrottle(request, clientAddress, 'owner')
    if (throttle.full()) return json(429, { error: 'Too many tries. Wait a few minutes.', needsAdminPasscode: true })
    if (!(await adminConfigured())) return json(503, { error: 'The admin passcode can’t be checked right now. Try again in a minute.', needsAdminPasscode: true })
    if (!(await checkAdminPasscode(passcode))) {
      throttle.miss()
      await noteAdminFailedSignIn()
      await recordAudit({
        by: { id: me.id, name: me.name, role: me.role },
        action: 'staff.switch-refused',
        target: { kind: 'staff', id: next.id, label: `${me.name} → ${next.name} (wrong admin passcode)` },
      })
      // 403, not 401: the screen reads 401 as "this device was signed out".
      return json(403, { error: WRONG_ADMIN, needsAdminPasscode: true }, throttle.cookie)
    }
  }
  await recordAudit({
    by: { id: next.id, name: next.name, role: next.role },
    action: 'staff.switched',
    target: { kind: 'staff', id: next.id, label: `${me.name} → ${next.name}` },
  })
  return json(200, { data: { staff: next } }, await staffCookie(next))
}
