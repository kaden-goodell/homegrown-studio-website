import type { APIRoute } from 'astro'
import { lookupHouseholdEntry, normalizeAuthorizedPickup } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
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
 *   found + valid: { found: true, recordId, firstName, kids, validUntil, signedAt, reuseToken, hasPickup, pickup? }
 *   agreement text changed substantively since they signed (HOM-210):
 *     { found: true, mustResign: true, firstName } — the client opens the full form.
 *   found but lapsed: { found: false, expired: true, firstName, validUntil }
 *   nothing on file: { found: false }
 *
 * `hasPickup`/`pickup` (HOM-212) considers BOTH the signature's own
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

  let pickup = { authorizedPickup: normalizeAuthorizedPickup(h.authorizedPickup), notAuthorized: h.notAuthorized || '' }
  if (partyId || workshopId) {
    const kind = partyId ? 'party' : 'workshop'
    const id = (partyId ?? workshopId)!
    try {
      const rsvp = await getRsvp(kind, id, h.recordId)
      if (rsvp?.pickup) pickup = rsvp.pickup
    } catch (error) {
      logger.error('RSVP pickup lookup failed — falling back to the signature', { error: String(error) })
    }
  }
  const hasPickup = pickup.authorizedPickup.length > 0

  return ok({
    found: true,
    recordId: h.recordId,
    firstName: h.firstName,
    kids: h.minors.map((m) => m.name.split(' ')[0]),
    validUntil: h.validUntil,
    signedAt: h.signedAt,
    reuseToken: issueReuseToken(h.recordId),
    hasPickup,
    ...(hasPickup ? { pickup } : {}),
  })
}
