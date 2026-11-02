import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { isOurs, listParties, partyEndIso } from '@lib/party-store'
import { dueCents } from '@lib/parties/money'
import { listWaiversByParty } from '@lib/waiver-store'

export const prerender = false

/**
 * Staff-only: list parties with an RSVP count, newest first. A cancelled
 * party is left out (its record stays for refunds on /admin); a party of
 * ours with something still to pay says so ("Waiting on payment").
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const parties = (await listParties()).filter((p) => p.status !== 'cancelled')
  const withCounts = await Promise.all(
    parties.map(async (p) => {
      const waivers = await listWaiversByParty(p.bookingId)
      const people = waivers.reduce((n, w) => n + 1 + w.minors.length, 0)
      return {
        bookingId: p.bookingId,
        craftName: p.craftName,
        startIso: p.startIso,
        endIso: partyEndIso(p) ?? null,
        waitingOnPayment: isOurs(p) && dueCents(p) > 0,
        title: p.title,
        hostName: p.hostName,
        hostPhone: p.hostPhone ?? null,
        guestCount: p.guestCount,
        themeName: p.theme?.displayName ?? null,
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
