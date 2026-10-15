import type { APIRoute } from 'astro'
import { staffAuthorized, staffCookie } from '@lib/staff-auth'
import { listStaff } from '@lib/staff-directory'
import { recordAudit } from '@lib/audit'

export const prerender = false
const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } })

/**
 * "Switch person" without the passcode screen (Kaden, 15 Oct 2026). Someone
 * already signed in on this device hands it to a teammate: the signed-in
 * cookie is the proof, the same trust as picking a name after the passcode.
 * GET → the team to pick from. POST { staffId } → signed in as them.
 */
export const GET: APIRoute = async ({ request }) => {
  const me = staffAuthorized(request)
  if (!me) return json(401, { error: 'Signed out — enter the passcode.' })
  return json(200, { data: { staff: await listStaff(), me } })
}

export const POST: APIRoute = async ({ request }) => {
  const me = staffAuthorized(request)
  if (!me) return json(401, { error: 'Signed out — enter the passcode.' })
  const body = await request.json().catch(() => null)
  const staffId = typeof body?.staffId === 'string' ? body.staffId : ''
  const next = (await listStaff()).find((m) => m.id === staffId)
  if (!next) return json(400, { error: 'Unknown staff member — refresh and try again.' })
  await recordAudit({
    by: { id: next.id, name: next.name, role: next.role },
    action: 'staff.switched',
    target: { kind: 'staff', id: next.id, label: `${me.name} → ${next.name}` },
  })
  return json(200, { data: { staff: next } }, staffCookie(next))
}
