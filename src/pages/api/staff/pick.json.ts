import type { APIRoute } from 'astro'
import { checkPasscode, passcodeConfigured, staffCookie } from '@lib/staff-auth'
import { listStaff } from '@lib/staff-directory'
import { rateLimited } from '@lib/rate-limit'
import { recordAudit } from '@lib/audit'

export const prerender = false

/**
 * Second step of staff login: "Who's on the iPad?" Re-checks the passcode
 * (the picker screen carries it in a ref, never in state) and, given a staffId
 * from the roster `login.json` returned, sets the signed identity cookie.
 * POST { passcode, staffId } → { data: { staff } }
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`staff-pick:${clientAddress}`, 5, 5 * 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many attempts — wait a few minutes.' }), { status: 429 })
  }
  if (!passcodeConfigured()) {
    return new Response(JSON.stringify({ error: 'Staff access is not configured (set STAFF_PASSCODE).' }), { status: 503 })
  }
  const body = await request.json().catch(() => null)
  const passcode = typeof body?.passcode === 'string' ? body.passcode : ''
  const staffId = typeof body?.staffId === 'string' ? body.staffId : ''
  if (!checkPasscode(passcode)) {
    return new Response(JSON.stringify({ error: 'Incorrect passcode.' }), { status: 401 })
  }
  const staff = (await listStaff()).find((m) => m.id === staffId)
  if (!staff) {
    return new Response(JSON.stringify({ error: 'Unknown staff member — refresh and try again.' }), { status: 400 })
  }
  const cookie = staffCookie(staff)
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
