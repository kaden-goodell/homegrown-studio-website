import type { APIRoute } from 'astro'
import { byOf, staffAuthorized } from '@lib/staff-auth'
import { partyRefundReply, partyRefundRequestsReply } from '@lib/parties/refunds'

export const prerender = false

const unauthorized = () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

/**
 * POST: refund all or part of one payment on a party from /staff (S2-R8).
 * Anyone signed in; a reason (3+ characters) is required and logged with
 * their name. Same body as /api/admin/parties/refund.json.
 */
export const POST: APIRoute = async ({ request }) => {
  const member = staffAuthorized(request)
  if (!member) return unauthorized()
  return partyRefundReply(request, { by: byOf(member), role: member.role }, { reasonRequired: true })
}

/** GET ?partyId=: the party's saved refund requests, so a waiting one can be checked in Square. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return unauthorized()
  return partyRefundRequestsReply(url)
}
