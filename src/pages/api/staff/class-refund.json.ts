import type { APIRoute } from 'astro'
import { byOf, staffAuthorized } from '@lib/staff-auth'
import { refundReply, refundRequestsReply } from '@lib/classes/refunds'

export const prerender = false

/** POST: refund all or part of a class booking from /staff. Anyone signed in; a reason (3+ characters) is required. */
export const POST: APIRoute = async ({ request }) => {
  const member = staffAuthorized(request)
  if (!member) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  return refundReply(request, { by: byOf(member), role: member.role }, { reasonRequired: true })
}

/** GET ?classId=&bookingId=: the booking's saved refund requests, so a waiting one can be checked in Square. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  return refundRequestsReply(url)
}
