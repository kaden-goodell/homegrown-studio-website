import type { APIRoute } from 'astro'
import { lookupHouseholdEntry, normalizeAuthorizedPickup } from '@lib/waiver-store'
import { getRsvp } from '@lib/rsvp-store'
import { rateLimited } from '@lib/rate-limit'
import { issueReuseToken } from '@lib/reuse-token'
import { verifyOtp } from '@lib/otp-store'
import { waiverContent, substantiveSince, compareVersions } from '@config/waiver-content'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:waiver:verify')

export const prerender = false

function err(message: string, status: number, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), { status })
}

/**
 * Second half of the returning-customer lookup (HOM-218): checks the 6-digit
 * SMS code `lookup.json` texted to the on-file phone, and only THEN hands
 * back the household's kids' names, record id, and a reuseToken for the
 * RSVP. `lookup.json` alone can never leak that — a stranger who knows a
 * phone/email can start a code, but can't read it off someone else's phone.
 *
 * POST { contact, code, partyId?, workshopId? } →
 *   success: { recordId, firstName, kids, validUntil, signedAt, reuseToken, hasPickup, pickup? }
 *   (the same shape `lookup.json` used to return directly, pre-HOM-218)
 *
 * `hasPickup`/`pickup` (HOM-212) considers BOTH the signature's own
 * `authorizedPickup` AND — when the caller passes `partyId`/`workshopId` —
 * an existing RSVP's `pickup` override for that specific event, same rule
 * `sign.json`'s handleReuse uses when carrying it forward. This logic used
 * to live in `lookup.json` directly; it moved here so it's never handed out
 * before the code is verified.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`verify:${clientAddress}`, 10, 60_000)) {
    return err('Too many attempts — give it a minute and try again.', 429)
  }

  const body = await request.json().catch(() => null)
  const contact = typeof body?.contact === 'string' ? body.contact.trim() : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!contact || !code) {
    return err('Enter the code we texted you.', 400)
  }
  const partyId = typeof body?.partyId === 'string' && body.partyId.trim() ? body.partyId.trim() : null
  const workshopId = typeof body?.workshopId === 'string' && body.workshopId.trim() ? body.workshopId.trim() : null

  const h = await lookupHouseholdEntry(contact)
  if (!h) {
    return err('Look yourself up again to get a new code.', 400)
  }

  // Defense in depth — lookup.json already refused to issue a code for a
  // lapsed or must-resign household, but re-check here too rather than trust
  // that nothing changed in the (up to 10-minute) gap since the code went out.
  if (new Date(h.validUntil).getTime() <= Date.now()) {
    return err('Your agreement has expired — please sign a new one.', 410)
  }
  if (compareVersions(h.agreementVersion, substantiveSince) < 0) {
    return err(waiverContent.mustResignNotice, 409, { mustResign: true })
  }

  const result = await verifyOtp(h.recordId, code)
  if (!result.ok) {
    if (result.reason === 'wrong') return err("That code isn't right — try again.", 400)
    if (result.reason === 'locked') return err('Too many tries — look yourself up again.', 429)
    if (result.reason === 'expired') return err('That code expired — look yourself up again.', 410)
    // 'not-found' — no OTP on record (never requested, or already consumed).
    return err('Look yourself up again to get a new code.', 400)
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

  return new Response(
    JSON.stringify({
      data: {
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
