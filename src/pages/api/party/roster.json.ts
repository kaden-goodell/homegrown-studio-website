import type { APIRoute } from 'astro'
import { getPartyRecord, hostTokenValid } from '@lib/party-store'
import { listWaiversByParty, markDuplicateChildren } from '@lib/waiver-store'
import { getCheckin } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:party:roster')

/**
 * Host-only roster for a party: who has RSVP'd (signed the waiver) + the
 * details staff need at check-in. Gated by the party's host token — this
 * returns other guests' children, allergies, and emergency contacts, so it
 * must never be reachable without the token.
 *
 * GET /api/party/roster.json?party={bookingId}&key={hostToken}
 */
export const GET: APIRoute = async ({ url }) => {
  const partyId = url.searchParams.get('party') ?? ''
  const key = url.searchParams.get('key') ?? ''

  if (!partyId) {
    return new Response(JSON.stringify({ error: 'Missing party' }), { status: 400 })
  }

  // Storage throws (transient Blobs outage) become a 503 the client can retry.
  // The 404 below is a plain return, not a throw — a bad token never becomes a 503.
  try {
    const party = await getPartyRecord(partyId)
    if (!hostTokenValid(party, key)) {
      // Same response whether the party is missing or the token is wrong — don't
      // leak which parties exist.
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
    }

    const waivers = await listWaiversByParty(partyId)

    const householdsRaw = (
      await Promise.all(
        waivers.map(async (w) => {
          const allIds = ['adult', ...w.minors.map((_, i) => `child:${i}`)]
          const checkin = await getCheckin(partyId, w.id)
          // "Who's coming" the group selected at RSVP; default to the whole household.
          const attending = checkin.expected ?? allIds
          return {
            signer: `${w.adult.firstName} ${w.adult.lastName}`.trim(),
            children: w.minors.map((m) => ({
              name: m.name,
              allergies: m.allergies || '',
              duplicateOf: undefined as string | undefined,
            })),
            childCount: w.minors.length,
            adultAllergies: w.adult.allergies || '',
            signedAt: w.signedAt,
            /** Person ids (`adult`, `child:{i}`) the group said are coming. */
            attending,
            attendingCount: attending.length,
          }
        }),
      )
    ).sort((a, b) => a.signedAt.localeCompare(b.signedAt))

    // signedAt is used only for sort order — strip it before sending to the browser.
    const households = householdsRaw.map(({ signedAt: _dropped, ...h }) => h)

    // Count duplicates among ATTENDING children only — the headcount numerator is
    // attending-filtered, so counting duplicates over all minors would double-discount
    // when a duplicate child isn't attending. (The host UI doesn't render duplicateOf,
    // so marking these filtered copies instead of `households` is fine.)
    const attendingHouseholds = households.map((h) => ({
      signer: h.signer,
      children: h.children.filter((_, ci) => h.attending.includes(`child:${ci}`)),
    }))
    const duplicateKids = markDuplicateChildren(attendingHouseholds)

    // Headcount the host cares about = people actually coming, not everyone eligible.
    const peopleCount = households.reduce((n, h) => n + h.attendingCount, 0) - duplicateKids

    logger.info('Roster served', { partyId, households: households.length })

    return new Response(
      JSON.stringify({
        data: {
          party: {
            craftName: party!.craftName,
            startIso: party!.startIso,
            durationMinutes: party!.durationMinutes,
            hostName: party!.hostName,
            guestCount: party!.guestCount,
            title: party!.title,
          },
          summary: { households: households.length, people: peopleCount },
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
