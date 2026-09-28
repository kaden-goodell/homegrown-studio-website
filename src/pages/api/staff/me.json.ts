import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'

export const prerender = false

/** Recover the signed-in staffer from the identity cookie — lets a page
 *  reload land back on Today instead of dropping to the login screen. */
export const GET: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  return new Response(JSON.stringify({ data: { staff } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
