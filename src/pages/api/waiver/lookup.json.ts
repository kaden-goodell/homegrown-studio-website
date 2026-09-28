import type { APIRoute } from 'astro'
import { lookupHouseholdEntry, normalizeAuthorizedPickup } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
import { rateLimited } from '@lib/rate-limit'
import { issueReuseToken } from '@lib/reuse-token'
import { substantiveSince, compareVersions } from '@config/waiver-content'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:waiver:lookup')

export const prerender = false

/**
 * Returning-customer lookup. Given an email or phone, says whether a still-valid
 * household agreement is on file — returning ONLY the first name, the kids' first
 * names, and the record id. Sensitive fields (emergency contact, allergies,
 * DOBs) are never returned to the browser; they're reused server-side by record
 * id at RSVP time, so typing a stranger's email can't harvest their details.
 *
 * POST { contact, partyId?, workshopId? } → { found, firstName?, kids?, validUntil?, recordId?, signedAt?, reuseToken?, hasPickup?, pickup? }
 *   or, when the agreement text has changed substantively since they last
 *   signed (HOM-210): { found: true, mustResign: true, firstName } — no
 *   token, no recordId; the client opens the full form instead.
 *
 * `hasPickup`/`pickup` (HOM-212) are the one exception to "no sensitive
 * fields returned" above. `hasPickup` considers BOTH the signature's own
 * `authorizedPickup` AND — when the caller passes `partyId`/`workshopId` —
 * an existing RSVP's `pickup` override for that specific event (a household
 * that filled the compact "Who may pick up?" block on an earlier RSVP must
 * see it reported as already-on-file, not asked again with a blank block —
 * fix round 1). `pickup` (the actual rows) is only included when `hasPickup`
 * is true, so the client can prefill an edit rather than replace what's
 * already there; the reuseToken issued in the same response already
 * authorizes writing a new RSVP for this household, so returning the current
 * pickup state alongside it is not a larger exposure than the token itself.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`lookup:${clientAddress}`, 10, 60_000)) {
    return new Response(JSON.stringify({ error: 'Too many lookups — give it a minute and try again.' }), { status: 429 })
  }

  const body = await request.json().catch(() => null)
  const contact = typeof body?.contact === 'string' ? body.contact.trim() : ''
  if (!contact) {
    return new Response(JSON.stringify({ error: 'Enter an email or phone number.' }), { status: 400 })
  }
  const partyId = typeof body?.partyId === 'string' && body.partyId.trim() ? body.partyId.trim() : null
  const workshopId = typeof body?.workshopId === 'string' && body.workshopId.trim() ? body.workshopId.trim() : null

  const h = await lookupHouseholdEntry(contact)
  if (!h) {
    return new Response(JSON.stringify({ data: { found: false } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Found but lapsed: don't offer one-tap reuse — they must re-sign. Tell them
  // who/what we found (their own name + when it expired) so it isn't a mystery.
  if (new Date(h.validUntil).getTime() <= Date.now()) {
    return new Response(
      JSON.stringify({ data: { found: false, expired: true, firstName: h.firstName, validUntil: h.validUntil } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // The agreement text has changed substantively since this household last
  // signed (HOM-210) — no one-tap reuse; the client opens the full form.
  // Only the first name goes back, same privacy rule as the normal "found" case.
  if (compareVersions(h.agreementVersion, substantiveSince) < 0) {
    return new Response(
      JSON.stringify({ data: { found: true, mustResign: true, firstName: h.firstName } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Effective pickup for this lookup: an existing RSVP's override for the
  // SPECIFIC event being looked up wins over the signature's own fields —
  // same rule sign.json.ts's handleReuse uses when carrying it forward.
  // Best-effort: an RSVP-store hiccup falls back to the signature alone
  // rather than failing the whole lookup.
  let pickup = { authorizedPickup: normalizeAuthorizedPickup(h.authorizedPickup), notAuthorized: h.notAuthorized || '' }
  if (partyId || workshopId) {
    const kind = partyId ? 'party' : 'workshop'
    const id = (partyId ?? workshopId)!
    try {
      const rsvp = await getRsvp(kind, id, h.recordId)
      if (rsvp?.pickup) pickup = rsvp.pickup
    } catch (err) {
      logger.error('RSVP pickup lookup failed — falling back to the signature', { error: String(err) })
    }
  }
  const hasPickup = pickup.authorizedPickup.length > 0

  return new Response(
    JSON.stringify({
      data: {
        found: true,
        recordId: h.recordId,
        firstName: h.firstName,
        kids: h.minors.map((m) => m.name.split(' ')[0]),
        validUntil: h.validUntil,
        signedAt: h.signedAt,
        reuseToken: issueReuseToken(h.recordId),
        hasPickup,
        ...(hasPickup ? { pickup } : {}),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
