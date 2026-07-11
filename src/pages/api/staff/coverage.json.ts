import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { lookupHouseholdEntry } from '@lib/waiver-store'

export const prerender = false

/** GET ?contact=email-or-phone → { covered, firstName?, validUntil?, kids? } — the door check for workshops/open studio. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const contact = url.searchParams.get('contact')?.trim() ?? ''
  if (!contact) return new Response(JSON.stringify({ error: 'Missing contact' }), { status: 400 })
  const h = await lookupHouseholdEntry(contact)
  const covered = !!h && new Date(h.validUntil).getTime() > Date.now()
  return new Response(
    JSON.stringify({ data: covered
      ? { covered: true, firstName: h!.firstName, validUntil: h!.validUntil, kids: h!.minors.map((m) => m.name.split(' ')[0]) }
      : { covered: false } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
