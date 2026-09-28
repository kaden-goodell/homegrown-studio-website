import type { APIRoute } from 'astro'
import { lookupHouseholdEntry } from '@lib/waiver-store'
import { rateLimited } from '@lib/rate-limit'
import { substantiveSince, compareVersions } from '@config/waiver-content'
import { issueOtp, resendOtp } from '@lib/otp-store'
import { sendQuoText, toE164 } from '@lib/quo'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:waiver:lookup')

export const prerender = false

/** Exact SMS wording (HOM-218) — the household's own phone gets this, never
 *  whatever the caller typed into the lookup box. */
const otpText = (code: string) => `Your Hometown Studio code is ${code}. It expires in 10 minutes.`

/** Last 2 digits of the on-file phone, shown so the caller can tell they got
 *  the right household without ever seeing the full number back. */
const phoneHint = (phone: string): string => `••${phone.replace(/\D/g, '').slice(-2)}`

function ok(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function err(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status })
}

/** Quo down, or the on-file phone can't be normalized — the client falls
 *  through to the full form; the OTP step never happens (no bypass). */
function smsFailed(firstName: string): Response {
  return ok({ found: true, smsFailed: true, firstName })
}

/** The response shape once a code has gone out — deliberately NOTHING that
 *  identifies the household beyond a first name: no recordId, no kids'
 *  names, no reuseToken. Those only ever leave verify.json, after the caller
 *  has proven they hold the on-file phone (HOM-218 / audit finding H2). */
function codeSent(firstName: string, kidCount: number, validUntil: string, phone: string): Response {
  return ok({ found: true, firstName, kidCount, validUntil, needsCode: true, phoneHint: phoneHint(phone) })
}

/**
 * Returning-customer lookup. Given an email or phone, says whether a still-
 * valid household agreement is on file. No sensitive fields (kids' names,
 * the record id, a reuse token) go back until `verify.json` confirms the
 * caller holds the on-file phone via a texted one-time code — this endpoint
 * only ever starts that check.
 *
 * POST { contact, resend? } → { found, firstName?, kidCount?, validUntil?, needsCode?, phoneHint?, smsFailed? }
 *   or, when the agreement text has changed substantively since they last
 *   signed (HOM-210): { found: true, mustResign: true, firstName } — the
 *   client opens the full form instead, no code needed.
 *   or, when found but lapsed: { found: false, expired: true, firstName, validUntil }.
 *
 * `resend: true` asks for a fresh code against an OTP already issued by an
 * earlier call on this same contact (rate-limited: 60s cooldown, 3 sends max
 * per OTP — see @lib/otp-store).
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

  const h = await lookupHouseholdEntry(contact)
  if (!h) return ok({ found: false })

  if (body?.resend === true) {
    const result = await resendOtp(h.recordId)
    if (!result.ok) {
      if (result.reason === 'cooldown') return err('Give it a minute before asking for another code.', 429)
      if (result.reason === 'max-sends') return err("You've already gotten a few codes — look yourself up again in a bit.", 429)
      // 'not-found' — nothing to resend against (never issued, or already consumed/expired).
      return err('That code expired — look yourself up again.', 410)
    }
    const toPhone = toE164(h.phone)
    if (!toPhone) {
      logger.error('On-file phone unparseable — cannot resend a code', { recordId: h.recordId })
      return smsFailed(h.firstName)
    }
    try {
      await sendQuoText({ to: toPhone, content: otpText(result.code) })
    } catch (error) {
      logger.error('OTP resend failed', { recordId: h.recordId, error: String(error) })
      return smsFailed(h.firstName)
    }
    return codeSent(h.firstName, h.minors.length, h.validUntil, h.phone)
  }

  // Found but lapsed: don't offer one-tap reuse — they must re-sign. Tell them
  // who/what we found (their own name + when it expired) so it isn't a mystery.
  if (new Date(h.validUntil).getTime() <= Date.now()) {
    return ok({ found: false, expired: true, firstName: h.firstName, validUntil: h.validUntil })
  }

  // The agreement text has changed substantively since this household last
  // signed (HOM-210) — no one-tap reuse (and no code needed); the client
  // opens the full form. Only the first name goes back, same privacy rule as
  // the normal "found" case.
  if (compareVersions(h.agreementVersion, substantiveSince) < 0) {
    return ok({ found: true, mustResign: true, firstName: h.firstName })
  }

  const toPhone = toE164(h.phone)
  if (!toPhone) {
    logger.error('On-file phone unparseable — cannot text a code', { recordId: h.recordId })
    return smsFailed(h.firstName)
  }

  const code = await issueOtp(h.recordId)
  try {
    await sendQuoText({ to: toPhone, content: otpText(code) })
  } catch (error) {
    logger.error('OTP send failed', { recordId: h.recordId, error: String(error) })
    return smsFailed(h.firstName)
  }

  return codeSent(h.firstName, h.minors.length, h.validUntil, h.phone)
}
