import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { getEvent, eventKey, resolveEventDay, EVENT_KIND_RE } from '@lib/events'
import { listWaiversByEvent, markDuplicateChildren, normalizeAuthorizedPickup } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
import { getCheckin, toPublicCheckin, presenceOn } from '@lib/checkin-store'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:roster')

const KIND_RE = EVENT_KIND_RE
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DROP_OFF_CAP = 12

/** Rosters only ever exist for these two kinds (programs have no resolver
 *  yet) — a subset of both `@lib/events`' and `@lib/waiver-store`'s own
 *  wider `EventKind` unions, so it satisfies every function below. */
type RosterKind = 'party' | 'workshop'

/** Staff-only: full check-in roster for one event, one day (HOM-213). Rosters
 *  are per event now, not per party — `?kind=&id=&day=` (`?party=` kept as
 *  the legacy alias for `kind=party`). */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const legacyParty = url.searchParams.get('party') ?? ''
  const kind = legacyParty ? 'party' : (url.searchParams.get('kind') ?? '')
  const id = legacyParty || (url.searchParams.get('id') ?? '')
  if (!KIND_RE.test(kind) || !id) {
    return new Response(JSON.stringify({ error: 'Missing kind/id' }), { status: 400 })
  }
  const requestedDay = url.searchParams.get('day')
  const dayParam = requestedDay && DAY_RE.test(requestedDay) ? requestedDay : null

  // Storage throws (transient Blobs outage) become a 503 the client can retry;
  // the 404 is a plain return and never reaches the catch.
  try {
    const event = await getEvent(kind as RosterKind, id)
    if (!event) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })

    const day = resolveEventDay(event, dayParam)

    const waivers = await listWaiversByEvent(kind as RosterKind, id)

    // Sort by signedAt ascending so "first" == earlier RSVP for duplicate detection.
    waivers.sort((a, b) => a.signedAt.localeCompare(b.signedAt))

    const households = await Promise.all(
      waivers.map(async (w) => {
        // RSVP records now carry who's actually with the household at this
        // event; the waiver's own field is a legacy fallback for records
        // signed before RSVPs existed (HOM-210).
        const rsvp = await getRsvp(kind as RosterKind, id, w.id)
        const checkinState = await getCheckin(eventKey(kind as RosterKind, id), w.id, { firstDay: event.days[0] })
        // Display must never disagree with the pickup gate (checkin.json). The
        // gate reads the door-side state once it has been seeded (which is
        // itself seeded RSVP override > signature); before that, show what it
        // WILL seed from. An empty seeded list is a deliberate staff edit.
        const seeded = checkinState.pickupSeeded
        const authorizedPickup = seeded
          ? normalizeAuthorizedPickup(checkinState.confirmedPickup)
          : normalizeAuthorizedPickup(rsvp?.pickup ? rsvp.pickup.authorizedPickup : w.authorizedPickup)
        const notAuthorized = checkinState.notAuthorized || (seeded ? '' : rsvp?.pickup?.notAuthorized || w.notAuthorized || '')
        const pub = toPublicCheckin(checkinState)
        return {
          recordId: w.id,
          signer: `${w.adult.firstName} ${w.adult.lastName}`.trim(),
          phone: w.adult.phone,
          email: w.adult.email,
          // dob is used only for duplicate matching (same kid on two waivers must
          // share a birthdate; two kids sharing a name must not merge) and is
          // stripped before the response.
          children: w.minors.map((m) => ({
            name: m.name,
            dob: m.dob,
            allergies: m.allergies || '',
            medications: m.medications || '',
            duplicateOf: undefined as string | undefined,
          })),
          childCount: w.minors.length,
          adultAllergies: w.adult.allergies || '',
          emergency: w.emergency,
          authorizedPickup,
          notAuthorized,
          responsibleAdult: rsvp?.responsibleAdult ?? w.responsibleAdult ?? '',
          photoConsent: w.photoConsent,
          signedAt: w.signedAt,
          agreementVersion: w.agreementVersion,
          validUntil: w.validUntil,
          checkin: {
            expected: pub.expected,
            presence: presenceOn(checkinState, day),
            pickedUpBy: pub.pickedUpBy,
            confirmedPickup: pub.confirmedPickup,
            notAuthorized: pub.notAuthorized,
            hasPickupCode: pub.hasPickupCode,
            codeAttempts: pub.codeAttempts,
            locked: pub.locked,
            releasedTo: pub.releasedTo,
          },
        }
      }),
    )

    // Flag children who appear (same name + birthdate) in an earlier household;
    // subtract the duplicate count from the headcount so staff see the real number.
    const duplicateKids = markDuplicateChildren(households)

    // Re-sort by signer name for display after duplicate detection.
    households.sort((a, b) => a.signer.localeCompare(b.signer))

    const people = households.reduce((n, h) => n + 1 + h.childCount, 0) - duplicateKids
    const childrenHereNow = households.reduce(
      (n, h) => n + Object.entries(h.checkin.presence).filter(([pid, p]) => pid.startsWith('child:') && !p.outAt).length,
      0,
    )
    const capWarning = event.dropOff && childrenHereNow > DROP_OFF_CAP

    // Strip the matching-only dob before serialization.
    const responseHouseholds = households.map((h) => ({
      ...h,
      children: h.children.map(({ dob: _dob, ...c }) => c),
    }))

    return new Response(
      JSON.stringify({
        data: {
          event,
          day,
          summary: { households: households.length, people, childrenHereNow },
          capWarning,
          households: responseHouseholds,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    logger.error('Roster load failed', { kind, id, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t load the roster — please try again.' }), { status: 503 })
  }
}
