import type { APIRoute } from 'astro'
import { checkPasscode, staffAuthorized, staffCookie } from '@lib/staff-auth'
import { listStaff } from '@lib/staff-directory'
import { recordAudit } from '@lib/audit'
import { rateLimited, rateLimitFull } from '@lib/rate-limit'
import { noteFailedSignIn, SIGNIN_BUCKET, SIGNIN_MAX, SIGNIN_WINDOW_MS } from '@lib/staff-signin-failures'

export const prerender = false
const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })

/** The refusal when an owner is picked without the passcode (the screen asks for it). */
export const OWNER_NEEDS_PASSCODE = (name: string) => `Enter the staff passcode to switch to ${name}.`

/**
 * "Switch person" without the passcode screen (Kaden, 15 Oct 2026). Someone
 * already signed in on this device hands it to a teammate: the signed-in
 * cookie is the proof, the same trust as picking a name after the passcode.
 * GET → the team to pick from. POST { staffId } → signed in as them.
 *
 * Except owners (DV19): switching TO an owner (not yourself) needs the staff
 * passcode again, `{ staffId, passcode }`, so nobody on a shared iPad or a
 * teammate's phone becomes "Catherine" for refunds and gift-card numbers.
 * Crew to crew stays one tap. Wrong passcodes share the sign-in bucket
 * (5 per 5 minutes per address) with the passcode screen.
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
    const passcode = typeof body?.passcode === 'string' ? body.passcode : ''
    if (!passcode) return json(403, { error: OWNER_NEEDS_PASSCODE(next.name), needsPasscode: true })
    if (rateLimitFull(SIGNIN_BUCKET(clientAddress), SIGNIN_MAX, SIGNIN_WINDOW_MS)) {
      return json(429, { error: 'Too many attempts — wait a few minutes.', needsPasscode: true })
    }
    if (!(await checkPasscode(passcode))) {
      rateLimited(SIGNIN_BUCKET(clientAddress), SIGNIN_MAX, SIGNIN_WINDOW_MS)
      await noteFailedSignIn()
      await recordAudit({
        by: { id: me.id, name: me.name, role: me.role },
        action: 'staff.switch-refused',
        target: { kind: 'staff', id: next.id, label: `${me.name} → ${next.name} (wrong passcode)` },
      })
      // 403, not 401: the screen reads 401 as "this device was signed out".
      return json(403, { error: 'Incorrect passcode.', needsPasscode: true })
    }
  }
  await recordAudit({
    by: { id: next.id, name: next.name, role: next.role },
    action: 'staff.switched',
    target: { kind: 'staff', id: next.id, label: `${me.name} → ${next.name}` },
  })
  return json(200, { data: { staff: next } }, await staffCookie(next))
}
