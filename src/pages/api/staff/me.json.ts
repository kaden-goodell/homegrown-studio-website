import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { ownerNames } from '@lib/admin-owners'

export const prerender = false

/** Recover the signed-in staffer from the identity cookie — lets a page
 *  reload land back on Today instead of dropping to the login screen.
 *  `owners`: the staff list's owners, for "Ask Catherine or Kaden" on crew screens (N11). */
export const GET: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  return new Response(JSON.stringify({ data: { staff, owners: await ownerNames() } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
