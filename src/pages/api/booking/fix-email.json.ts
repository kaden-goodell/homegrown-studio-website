import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { readEmailFixTicket, issueEmailFixTicket, planEmailFix } from '@lib/email-fix'
import { getConfirmationCopy, noteResent } from '@lib/confirmation-copies'
import { sendEmail } from '@lib/email'
import { updateSeatChoiceEmail } from '@lib/seat-choices'
import { updatePartyRecord, PartyNotFoundError } from '@lib/party-store'
import { alertOwners } from '@lib/owner-alert'

export const prerender = false
const logger = createLogger('api:booking:fix-email')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEXT_US = 'text us at (256) 464-1710'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * "Wrong email? Fix it" and "Which email is right?" on the You're-booked
 * screen (email-fix.ts says what each may change). Answers
 * `{ data: { email, resent, token } }`; `token` replaces the old ticket.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`fix-email:${clientAddress}`, 10, 10 * 60_000)) {
    return json(429, { error: 'Too many tries. Please wait a few minutes.' })
  }
  const body = await request.json().catch(() => null)
  const ticket = readEmailFixTicket(body?.token)
  if (!ticket) return json(403, { error: `This link has expired. Please ${TEXT_US} and we’ll fix it.` })
  const email = String(body?.email ?? '').trim()
  if (!EMAIL_RE.test(email) || email.length > 200) return json(400, { error: 'That email doesn’t look right. Check for typos.' })

  const plan = planEmailFix(ticket, email)
  if (plan.action === 'none') return json(200, { data: { email, resent: false, token: body.token } })

  let resent = false
  if (plan.action === 'resend') {
    const copy = await getConfirmationCopy(ticket.kind, ticket.bookingId).catch(() => null)
    if (!copy) return json(409, { error: `We couldn’t resend it from here. Please ${TEXT_US} and we’ll send it.` })
    resent = (await sendEmail({ to: email, subject: copy.subject, html: copy.html, text: copy.text, attachments: copy.attachments })).sent
    if (!resent) return json(502, { error: `We couldn’t send it just now. Please try again, or ${TEXT_US}.` })
    await noteResent(copy, email).catch(() => undefined)
  }

  // Our own record of the booking.
  try {
    if (ticket.kind === 'workshop' && ticket.eventId) {
      await updateSeatChoiceEmail(ticket.eventId, ticket.bookingId, email)
    } else if (ticket.kind === 'party') {
      // Compare-and-set on the record as stored, so a payment written at the same moment stays.
      await updatePartyRecord(ticket.bookingId, (r) => ({ ...r, hostEmail: email }), 'Host email changed', null)
    }
  } catch (err) {
    // No party record here: nothing to change, as before.
    if (!(err instanceof PartyNotFoundError)) logger.error('Booking record email not updated', { bookingId: ticket.bookingId, error: String(err) })
  }

  // Their Square profile, only where that's safe (email-fix.ts).
  let squareUpdated = false
  if (plan.updateSquare) {
    try {
      await providers.customer.updateEmail(ticket.customerId, email)
      squareUpdated = true
    } catch (err) {
      logger.error('Square customer email not updated', { customerId: ticket.customerId, error: String(err) })
    }
  }
  // Tell a person whenever Square still has an email this booker just said is wrong.
  if (ticket.customerId && !squareUpdated && (plan.updateSquare || plan.action === 'resend')) {
    await alertOwners(
      `Email changed after booking ${ticket.bookingId}: from ${ticket.typed} to ${email}.${plan.updateSquare ? ' Square could not be updated.' : ' Their Square profile was left as it was.'} If the new one is right, change it on their Square customer profile.`,
    ).catch(() => undefined)
  }
  logger.info('Booking email fixed', { kind: ticket.kind, bookingId: ticket.bookingId, action: plan.action, resent, squareUpdated })

  const token = issueEmailFixTicket({ ...ticket, typed: email, onFile: null })
  return json(200, { data: { email, resent, token } })
}
