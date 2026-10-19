import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { partyRefundReply, partyRefundRequestsReply } from '@lib/parties/refunds'

export const prerender = false

/**
 * POST `{ partyId, chargeId, cents, reason, attempt, again? }`: refund all or
 * part of one payment on a party. `{ action: 'clear', partyId, requestId,
 * outcome, reason }`: "It went through / It didn't go through" for a refund
 * Square never answered. Owners only (the one named in X-Admin-Who); a reason
 * is optional.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return partyRefundReply(request, { by: adminActor(request), role: 'owner' }, { reasonRequired: false })
}

/** GET ?partyId=: the party's saved refund requests (who asked, when, how much, which payment). */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return partyRefundRequestsReply(url)
}
