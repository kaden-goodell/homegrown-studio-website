import type { APIRoute } from 'astro'
import { getPartyRecord, hostTokenValid, isOurs, partyEndIso, type PartyRecord } from '@lib/party-store'
import { partyConfig } from '@config/party.config'
import { dueCents } from '@lib/parties/money'
import { payLinkUrl, whatIsDue } from '@lib/parties/payment-link'
import { listWaiversByParty, markDuplicateChildren } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
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
/**
 * What the host still owes online (D1: the studio fee and priced extras,
 * never crafts) and the payment link for it. Only on the host's own page
 * (the host token), never on the guest invite.
 */
export function hostPayment(rec: PartyRecord, origin: string): { cents: number; what: string; url: string } | null {
  if (!isOurs(rec) || rec.status === 'cancelled' || !rec.payToken) return null
  const cents = dueCents(rec)
  if (cents <= 0) return null
  return { cents, what: whatIsDue(rec), url: payLinkUrl(origin, rec) }
}

const NO_STORE = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

export const GET: APIRoute = async ({ url }) => {
  const partyId = url.searchParams.get('party') ?? ''
  const key = url.searchParams.get('key') ?? ''

  if (!partyId) {
    return new Response(JSON.stringify({ error: 'Missing party' }), { status: 400, headers: NO_STORE })
  }

  // Storage throws (transient Blobs outage) become a 503 the client can retry.
  // The 404 below is a plain return, not a throw — a bad token never becomes a 503.
  try {
    const party = await getPartyRecord(partyId)
    if (!hostTokenValid(party, key)) {
      // Same response whether the party is missing or the token is wrong — don't
      // leak which parties exist.
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: NO_STORE })
    }

    const waivers = await listWaiversByParty(partyId)

    const householdsRaw = (
      await Promise.all(
        waivers.map(async (w) => {
          const allIds = ['adult', ...w.minors.map((_, i) => `child:${i}`)]
          const checkin = await getCheckin(partyId, w.id)
          const rsvp = await getRsvp('party', partyId, w.id)
          // "Who's coming" the group selected at RSVP; the RsvpRecord is the
          // current source of truth, falling back to the legacy checkin
          // "expected" mirror for households that RSVP'd before it existed
          // (HOM-210), then to the whole household.
          const attending = rsvp ? (rsvp.attending ?? allIds) : (checkin.expected ?? allIds)
          return {
            signer: `${w.adult.firstName} ${w.adult.lastName}`.trim(),
            children: w.minors.map((m) => ({
              name: m.name,
              // dob is used ONLY for duplicate matching below and stripped from
              // the response — other families' kids' birthdates never reach the
              // host's browser.
              dob: m.dob,
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

    // Strip the dob used for duplicate matching before serialization.
    const responseHouseholds = households.map((h) => ({
      ...h,
      children: h.children.map(({ dob: _dob, ...c }) => c),
    }))

    logger.info('Roster served', { partyId, households: households.length })

    return new Response(
      JSON.stringify({
        data: {
          party: {
            craftName: party!.craftName,
            startIso: party!.startIso,
            durationMinutes: party!.durationMinutes,
            /** extra time included */
            endIso: partyEndIso(party!) ?? new Date(Date.parse(party!.startIso) + partyConfig.durationMinutes * 60_000).toISOString(),
            cancelled: party!.status === 'cancelled',
            /** the calendar file's SEQUENCE (its UID is the booking id), so a re-added invite replaces the old one */
            calendarSeq: party!.calendarSeq ?? 0,
            pay: hostPayment(party!, url.origin),
            hostName: party!.hostName,
            guestCount: party!.guestCount,
            title: party!.title,
          },
          summary: { households: households.length, people: peopleCount },
          households: responseHouseholds,
        },
      }),
      // The host page builds its calendar file from this reply: never cached, so a moved or cancelled party shows at once.
      { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    logger.error('Roster load failed', { partyId, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t load the roster — please try again.' }), { status: 503, headers: NO_STORE })
  }
}
