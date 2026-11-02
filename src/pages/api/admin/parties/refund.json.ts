import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { partyRefundReply, partyRefundRequestsReply } from '@lib/parties/refunds'

export const prerender = false

/**
 * POST `{ partyId, chargeId, cents, reason, attempt, again? }`: refund all or
 * part of one payment on a party. `{ action: 'ask-request', partyId,
 * requestId }`: Ask Square about a refund it never answered (read only);
 * `{ action: 'request-decide', partyId, requestId, outcome }`: the step that
 * fits Square's answer (booking-core/ask-square). Owners only (the one named
 * in X-Admin-Who); a reason is optional.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  return partyRefundReply(request, { by: await adminActor(request), role: 'owner' }, { reasonRequired: false })
}

/** GET ?partyId=: the party's saved refund requests (who asked, when, how much, which payment). */
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  return partyRefundRequestsReply(url)
}
