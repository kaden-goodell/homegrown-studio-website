import type { APIRoute } from 'astro'
import { checkPasscode, passcodeConfigured, staffCookie } from '@lib/staff-auth'
import { listStaff } from '@lib/staff-directory'
import { rateLimited, rateLimitFull } from '@lib/rate-limit'
import { recordAudit } from '@lib/audit'
import { noteFailedSignIn, SIGNIN_BUCKET, SIGNIN_MAX, SIGNIN_WINDOW_MS } from '@lib/staff-signin-failures'

export const prerender = false

/**
 * Second step of staff login: "Who's on the iPad?" Re-checks the passcode
 * (the picker screen carries it in a ref, never in state) and, given a staffId
 * from the roster `login.json` returned, sets the signed identity cookie.
 * POST { passcode, staffId } → { data: { staff } }
 *
 * Shares login's per-address limit (S1): one bucket of wrong passcodes for
 * both steps (5 per 5 minutes); a full bucket is refused at either step, and
 * a right passcode never counts. Wrong passcodes also go into the site-wide
 * count that warns the owners on Home.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimitFull(SIGNIN_BUCKET(clientAddress), SIGNIN_MAX, SIGNIN_WINDOW_MS)) {
    return new Response(JSON.stringify({ error: 'Too many attempts — wait a few minutes.' }), { status: 429 })
  }
  if (!(await passcodeConfigured())) {
    return new Response(JSON.stringify({ error: 'Staff sign-in isn’t available right now. Try again in a minute. If it keeps happening, an owner can set the staff passcode in /admin › More › Staff › People.' }), { status: 503 })
  }
  const body = await request.json().catch(() => null)
  const passcode = typeof body?.passcode === 'string' ? body.passcode : ''
  const staffId = typeof body?.staffId === 'string' ? body.staffId : ''
  if (!(await checkPasscode(passcode))) {
    rateLimited(SIGNIN_BUCKET(clientAddress), SIGNIN_MAX, SIGNIN_WINDOW_MS)
    await noteFailedSignIn()
    return new Response(JSON.stringify({ error: 'Incorrect passcode.' }), { status: 401 })
  }
  const staff = (await listStaff()).find((m) => m.id === staffId)
  if (!staff) {
    return new Response(JSON.stringify({ error: 'Unknown staff member — refresh and try again.' }), { status: 400 })
  }
  const cookie = await staffCookie(staff)
  await recordAudit({
    by: { id: staff.id, name: staff.name, role: staff.role },
    action: 'staff.signed-in',
    target: { kind: 'staff', id: staff.id, label: staff.name },
  })
  return new Response(JSON.stringify({ data: { staff } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
  })
}
