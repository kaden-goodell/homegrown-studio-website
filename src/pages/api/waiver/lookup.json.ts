import type { APIRoute } from 'astro'
import { lookupHouseholdEntry } from '@lib/waiver-store'
import { effectivePickup, hasPickupContent } from '@lib/pickup'
import { rateLimited } from '@lib/rate-limit'
import { issueReuseToken } from '@lib/reuse-token'
import { substantiveSince, compareVersions } from '@config/waiver-content'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:waiver:lookup')

export const prerender = false

function ok(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function err(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status })
}

/**
 * Returning-customer lookup. Type an email or phone → the household appears.
 *
 * POST { contact, partyId?, workshopId? } →
 *   found + valid: { found: true, recordId, firstName, kids, validUntil, signedAt, reuseToken, hasPickup }
 *   agreement text changed substantively since they signed (HOM-210):
 *     { found: true, mustResign: true, firstName } — the client opens the full form.
 *   found but lapsed: { found: false, expired: true, firstName, validUntil }
 *   nothing on file: { found: false }
 *
 * `hasPickup` (HOM-212) is a boolean only — this endpoint is public, so it never
 * returns the third-party names/phones themselves. It considers BOTH the signature's own
 * `authorizedPickup` AND — when the caller passes `partyId`/`workshopId` —
 * an existing RSVP's `pickup` override for that specific event, same rule
 * `sign.json`'s handleReuse uses when carrying it forward.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`lookup:${clientAddress}`, 10, 60_000)) {
    return err('Too many lookups — give it a minute and try again.', 429)
  }

  const body = await request.json().catch(() => null)
  const contact = typeof body?.contact === 'string' ? body.contact.trim() : ''
  if (!contact) {
    return err('Enter an email or phone number.', 400)
  }
  const partyId = typeof body?.partyId === 'string' && body.partyId.trim() ? body.partyId.trim() : null
  const workshopId = typeof body?.workshopId === 'string' && body.workshopId.trim() ? body.workshopId.trim() : null

  const h = await lookupHouseholdEntry(contact)
  if (!h) return ok({ found: false })

  // Found but lapsed: don't offer one-tap reuse — they must re-sign. Tell them
  // who/what we found (their own name + when it expired) so it isn't a mystery.
  if (new Date(h.validUntil).getTime() <= Date.now()) {
    return ok({ found: false, expired: true, firstName: h.firstName, validUntil: h.validUntil })
  }

  // The agreement text has changed substantively since this household last
  // signed (HOM-210) — no one-tap reuse; the client opens the full form.
  if (compareVersions(h.agreementVersion, substantiveSince) < 0) {
    return ok({ found: true, mustResign: true, firstName: h.firstName })
  }

  // Same resolver the pickup gate uses: this event's RSVP, else the household's
  // latest RSVP anywhere, else the signature. Boolean only — public endpoint.
  const kind = partyId ? 'party' : workshopId ? 'workshop' : undefined
  let hasPickup = false
  try {
    hasPickup = hasPickupContent(await effectivePickup({ kind, id: (partyId ?? workshopId) ?? undefined, waiver: { id: h.recordId, authorizedPickup: h.authorizedPickup, notAuthorized: h.notAuthorized } }))
  } catch (error) {
    logger.error('Pickup lookup failed — treating as none on file', { error: String(error) })
  }

  return ok({
    found: true,
    recordId: h.recordId,
    firstName: h.firstName,
    kids: h.minors.map((m) => m.name.split(' ')[0]),
    validUntil: h.validUntil,
    signedAt: h.signedAt,
    reuseToken: issueReuseToken(h.recordId),
    hasPickup,
  })
}
