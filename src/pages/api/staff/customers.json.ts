import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { providers } from '@config/providers'
import { findCustomers } from '@lib/customer-directory'
import { householdForSeats } from '@lib/attending'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:customers')

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const shape = (c: { id: string; givenName?: string; familyName?: string; email?: string; phone?: string }) => ({
  id: c.id, givenName: c.givenName ?? '', familyName: c.familyName ?? '', email: c.email ?? '', phone: c.phone ?? '',
})

/**
 * Staff-only "Find a customer" for Comp / Sell a seat.
 * `GET ?q=` → up to 8 Square customers matching a name, email or phone.
 * `GET ?id=` → that customer, plus the household on their waiver (or null).
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return reply(401, { error: 'Unauthorized' })
  const id = url.searchParams.get('id')?.trim()
  const q = url.searchParams.get('q')?.trim() ?? ''
  try {
    if (id) {
      const c = await providers.customer.getById(id)
      if (!c) return reply(404, { error: 'That customer isn’t in Square anymore.' })
      const household = await householdForSeats({ email: c.email, phone: c.phone })
      return reply(200, { data: { customer: shape(c), household } })
    }
    if (q.length < 2) return reply(200, { data: [] })
    return reply(200, { data: (await findCustomers(q)).map(shape) })
  } catch (err) {
    logger.error('Customer search failed', { error: err instanceof Error ? err.message : String(err) })
    return reply(503, { error: 'Couldn’t reach Square. Try again.' })
  }
}
