import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { refundReply } from '@lib/classes/refunds'

export const prerender = false

/** POST: refund all or part of a class booking. Owners only (the one named in X-Admin-Who); a reason is optional. */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return refundReply(request, { by: adminActor(request), role: 'owner' }, { reasonRequired: false })
}
