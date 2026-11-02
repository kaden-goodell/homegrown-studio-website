import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { isAttemptId } from '@lib/checkout-attempt'
import { CONTACT_MESSAGES, isPhone } from '@lib/contact-rules'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { joinWaitlist, leaveWaitlist, WaitlistError } from '@lib/classes/waitlist'
import { WAITLIST_MESSAGES } from '@lib/classes/waitlist-words'

export const prerender = false
const logger = createLogger('api:classes:waitlist')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const fail = (status: number, code: string, detail: string, extra: Record<string, unknown> = {}) => json(status, { error: 'Waitlist', code, detail, ...extra })

/**
 * Stage 4 waitlist (public).
 *   POST { action: 'join', classId, attemptId, passId, sessionIds?, tickets, seats?, customer, cardToken, verificationToken?, consent: true,
 *          consentShown: { maxCents, closesIso, text } }   (I2: what the ticked consent said; a change → 409 consent_changed + { maxCents, closesIso })
 *     → 200 { data: { position, waiting, card: { brand, last4 }, emailSent } }
 *   POST { action: 'leave', token } → 200 { data: { result: 'left' | 'already-off' | 'added' | 'checking', className, cardOff? } }
 * Card data never reaches us: only Square's one-time token from its card form.
 * Prices come from the class, never the page.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const testSite = classWritesRefusal(request)
  if (testSite) return fail(503, 'unavailable', testSite)
  let body: any
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid', WAITLIST_MESSAGES.unavailable)
  }
  if (!body || typeof body !== 'object') return fail(400, 'invalid', WAITLIST_MESSAGES.unavailable)

  try {
    if (body.action === 'leave') {
      if (rateLimited(`waitlist-leave:${clientAddress}`, 10, 60_000)) return fail(429, 'unavailable', 'That’s a lot of tries in a row. Give it a minute, then try again.')
      return json(200, { data: await leaveWaitlist(body.token) })
    }
    if (body.action !== 'join') return fail(400, 'invalid', WAITLIST_MESSAGES.unavailable)

    if (!bookingsOpen(request, 'workshops')) return bookingsClosedResponse()
    if (rateLimited(`waitlist-join:${clientAddress}`, 5, 60_000)) return fail(429, 'unavailable', 'That’s a lot of tries in a row. Give it a minute, then try again.')
    const classId = typeof body.classId === 'string' ? body.classId : ''
    const passId = typeof body.passId === 'string' ? body.passId : ''
    const cardToken = typeof body.cardToken === 'string' ? body.cardToken : ''
    if (!classId || !passId || !body.tickets || typeof body.tickets !== 'object') return fail(400, 'invalid', WAITLIST_MESSAGES.unavailable)
    if (!isAttemptId(body.attemptId)) return fail(400, 'invalid', 'This page is out of date. Reload it and try again. Nothing was charged.')
    if (!cardToken || cardToken.length > 4000) return fail(400, 'invalid', 'Add a card to save.')
    const givenName = String(body.customer?.givenName ?? '').trim()
    const familyName = String(body.customer?.familyName ?? '').trim()
    const email = String(body.customer?.email ?? '').trim()
    const phone = String(body.customer?.phone ?? '').trim()
    if (!givenName || !familyName) return fail(400, 'invalid', 'Add your first and last name.')
    if (!EMAIL_RE.test(email)) return fail(400, 'invalid', 'That email doesn’t look right. Check for typos.')
    if (!isPhone(phone)) return fail(400, 'invalid', CONTACT_MESSAGES.phone)
    const verificationToken = typeof body.verificationToken === 'string' && body.verificationToken.length <= 4000 ? body.verificationToken : null
    const cs = body.consentShown
    const consentShown = cs && typeof cs === 'object' && Number.isInteger(cs.maxCents) && typeof cs.closesIso === 'string' && cs.closesIso.length <= 40
      ? { maxCents: Number(cs.maxCents), closesIso: cs.closesIso, ...(typeof cs.text === 'string' && cs.text.length <= 1000 ? { text: cs.text } : {}) }
      : null

    const data = await joinWaitlist({
      classId, attemptId: body.attemptId,
      request: {
        passId, tickets: body.tickets,
        ...(Array.isArray(body.sessionIds) && body.sessionIds.length ? { sessionIds: body.sessionIds.map(String) } : {}),
        ...(Array.isArray(body.seats) ? { seats: body.seats } : {}),
      },
      customer: { givenName, familyName, email, phone },
      cardToken, verificationToken, consent: body.consent === true, consentShown,
      ip: clientAddress ?? '', origin: new URL(request.url).origin,
    })
    return json(200, { data })
  } catch (err) {
    if (err instanceof WaitlistError) return fail(err.status, err.code, err.message, err.code === 'consent_changed' ? err.extra : {})
    logger.error('Waitlist request failed', { error: err instanceof Error ? err.message : String(err) })
    return fail(502, 'unavailable', WAITLIST_MESSAGES.unavailable)
  }
}
