import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { providers } from '@config/providers'
import { findCustomers } from '@lib/customer-directory'
import { householdForSeats } from '@lib/attending'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { maskEmail, maskPhone } from '@lib/pii-mask'

export const prerender = false

const logger = createLogger('api:staff:customers')

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const shape = (c: { id: string; givenName?: string; familyName?: string; email?: string; phone?: string }) => ({
  id: c.id, givenName: c.givenName ?? '', familyName: c.familyName ?? '', email: c.email ?? '', phone: c.phone ?? '',
})

/** Searches (and picks) per staff member per minute (DV19). */
export const CUSTOMER_LOOKUPS_PER_MINUTE = 30
/** The shortest search: two letters at a time would page through the customer list. */
export const MIN_QUERY = 3

/** A search result as crew see it: masked contacts (DV19). Owners see them whole. */
export const masked = (c: ReturnType<typeof shape>) => ({ ...c, email: maskEmail(c.email), phone: maskPhone(c.phone) })

/**
 * Staff-only "Find a customer" for Comp / Sell a seat.
 * `GET ?q=` → up to 8 Square customers matching a name, email or phone
 *   (3+ characters). Crew get masked contacts (`j•••@gmail.com`, `••1234`).
 * `GET ?id=` → that customer in full (the sale needs the email), plus the
 *   household on their waiver (or null).
 * Both count toward 30 a minute per staff member.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const member = await staffAuthorized(request)
  if (!member) return reply(401, { error: 'Unauthorized' })
  const id = url.searchParams.get('id')?.trim()
  const q = url.searchParams.get('q')?.trim() ?? ''
  if (!id && q.length < MIN_QUERY) return reply(200, { data: [] })
  if (rateLimited(`staff-customers:${member.id}`, CUSTOMER_LOOKUPS_PER_MINUTE, 60_000)) {
    return reply(429, { error: 'That’s a lot of searches. Wait a minute and try again.' })
  }
  try {
    if (id) {
      const c = await providers.customer.getById(id)
      if (!c) return reply(404, { error: 'That customer isn’t in Square anymore.' })
      const household = await householdForSeats({ email: c.email, phone: c.phone })
      return reply(200, { data: { customer: shape(c), household } })
    }
    const found = (await findCustomers(q)).map(shape)
    return reply(200, { data: member.role === 'owner' ? found : found.map(masked) })
  } catch (err) {
    logger.error('Customer search failed', { error: err instanceof Error ? err.message : String(err) })
    return reply(503, { error: 'Couldn’t reach Square. Try again.' })
  }
}
