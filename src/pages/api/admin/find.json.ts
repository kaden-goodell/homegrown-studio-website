import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { json } from '@lib/classes/admin-actions'
import { findCustomerBookings, FIND_MIN } from '@lib/customer-find'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:admin:find')

/**
 * Owners only: /admin › Find a booking (final review I5).
 * GET ?q=<name, email or phone> → { classes, parties, waitlist, more }:
 *   their class bookings (each with what was paid and refunded, for Refund),
 *   their parties, and their places on a waitlist. Read-only.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const q = ((url ?? new URL(request.url)).searchParams.get('q') ?? '').trim()
  if (q.length < FIND_MIN) return json(400, { error: 'Type at least two letters of their name, their email, or part of their phone number.' })
  try {
    return json(200, { data: await findCustomerBookings(q.slice(0, 80)) })
  } catch (e) {
    logger.error('Find a booking failed', { error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'The bookings couldn’t be searched just now. Try again.' })
  }
}
