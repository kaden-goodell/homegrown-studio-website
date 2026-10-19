import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { classBookings, json, reply } from '@lib/classes/admin-actions'

export const prerender = false

/** GET ?id=cls_…: the class and its bookings (ledger lines grouped by booking). Owners only. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return reply(async () => ({ data: await classBookings(url.searchParams.get('id') ?? '') }))
}
