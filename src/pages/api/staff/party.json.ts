import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { updatePartyDropOff } from '@lib/party-store'

export const prerender = false

/** Staff-only: flip a party's drop-off flag. POST { party, dropOff } */
export const POST: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const body = await request.json().catch(() => null)
  const party = typeof body?.party === 'string' ? body.party : ''
  const dropOff = body?.dropOff === true
  if (!party) return new Response(JSON.stringify({ error: 'Missing party' }), { status: 400 })

  const updated = await updatePartyDropOff(party, dropOff)
  if (!updated) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
  return new Response(JSON.stringify({ data: { dropOff: updated.dropOff } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
