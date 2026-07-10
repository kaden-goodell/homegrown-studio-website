import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listParties } from '@lib/party-store'
import { listWaiversByParty } from '@lib/waiver-store'

export const prerender = false

/** Staff-only: list parties with an RSVP count, newest first. */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const parties = await listParties()
  const withCounts = await Promise.all(
    parties.map(async (p) => {
      const waivers = await listWaiversByParty(p.bookingId)
      const people = waivers.reduce((n, w) => n + 1 + w.minors.length, 0)
      return {
        bookingId: p.bookingId,
        craftName: p.craftName,
        startIso: p.startIso,
        title: p.title,
        hostName: p.hostName,
        guestCount: p.guestCount,
        rsvpHouseholds: waivers.length,
        rsvpPeople: people,
      }
    }),
  )
  return new Response(JSON.stringify({ data: { parties: withCounts } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
