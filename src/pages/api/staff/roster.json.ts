import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { getPartyRecord } from '@lib/party-store'
import { listWaiversByParty } from '@lib/waiver-store'
import { getCheckin, toPublicCheckin } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:roster')

/** Staff-only: full check-in roster for a party — everything staff need on site. */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }
  const partyId = url.searchParams.get('party') ?? ''
  if (!partyId) return new Response(JSON.stringify({ error: 'Missing party' }), { status: 400 })

  // Storage throws (transient Blobs outage) become a 503 the client can retry;
  // the 404 is a plain return and never reaches the catch.
  try {
    const party = await getPartyRecord(partyId)
    if (!party) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })

    const waivers = await listWaiversByParty(partyId)
    const households = await Promise.all(
      waivers.map(async (w) => ({
        recordId: w.id,
        signer: `${w.adult.firstName} ${w.adult.lastName}`.trim(),
        phone: w.adult.phone,
        email: w.adult.email,
        children: w.minors.map((m) => ({ name: m.name, allergies: m.allergies || '' })),
        childCount: w.minors.length,
        adultAllergies: w.adult.allergies || '',
        emergency: w.emergency,
        authorizedPickup: w.authorizedPickup || '',
        photoConsent: w.photoConsent,
        signedAt: w.signedAt,
        checkin: toPublicCheckin(await getCheckin(partyId, w.id)),
      })),
    )
    households.sort((a, b) => a.signer.localeCompare(b.signer))

    const people = households.reduce((n, h) => n + 1 + h.childCount, 0)

    return new Response(
      JSON.stringify({
        data: {
          party: {
            bookingId: party.bookingId,
            craftName: party.craftName,
            startIso: party.startIso,
            title: party.title,
            hostName: party.hostName,
            guestCount: party.guestCount,
            dropOff: party.dropOff,
          },
          summary: { households: households.length, people },
          households,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    logger.error('Roster load failed', { partyId, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t load the roster — please try again.' }), { status: 503 })
  }
}
