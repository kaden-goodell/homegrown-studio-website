import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { lookupHouseholdEntry } from '@lib/waiver-store'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:coverage')

/** GET ?contact=email-or-phone → { covered, firstName?, validUntil?, kids? } — the door check for workshops/open studio. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const contact = url.searchParams.get('contact')?.trim() ?? ''
  if (!contact) return new Response(JSON.stringify({ error: 'Missing contact' }), { status: 400 })
  let h: Awaited<ReturnType<typeof lookupHouseholdEntry>>
  try {
    h = await lookupHouseholdEntry(contact)
  } catch (err) {
    logger.error('Household lookup failed', { error: String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — try again.' }), { status: 503 })
  }
  const covered = !!h && new Date(h.validUntil).getTime() > Date.now()
  return new Response(
    JSON.stringify({ data: covered
      ? { covered: true, firstName: h!.firstName, validUntil: h!.validUntil, kids: h!.minors.map((m) => m.name.split(' ')[0]) }
      : { covered: false } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
