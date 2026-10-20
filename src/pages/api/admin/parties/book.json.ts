import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isAttemptId } from '@lib/checkout-attempt'
import { partyMessages } from '@lib/checkout-messages'
import { CREATE_KEY_RE } from '@lib/booking-core/ids'
import { recordAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'
import { bookParty, IN_PROGRESS_MESSAGE, type BookInput } from '@lib/parties/checkout'
import { adminPartyView, json } from '@lib/parties/admin-actions'
import { PaymentLinkError, sendPaymentLink } from '@lib/parties/payment-link'
import { partyLabel } from '@lib/parties/refunds'

export const prerender = false
const logger = createLogger('api:admin:parties:book')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST { createKey, startIso, packageId?, guests, craftId, addOns?, host:
 * { firstName, lastName, email, phone }, pay: { kind: 'link' } | { kind:
 * 'card', attemptId, paymentToken } }: an owner books a party for someone.
 * Owners ignore the notice and the window, never a past start (R37) or a
 * clash (named). Any free time the shared schedule allows (OWNER-3).
 *
 * Link: the party is recorded with everything due, its time held, and the
 * host emailed and texted the payment link. The party id comes from
 * `createKey` (R35): a retry answers the same party (`replay`) and sends no
 * second link. Card: charged now (cards only, S2-R3); the party id comes
 * from the attempt id, so a retry never charges twice.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: 'Nothing to book.' })
  const by = adminActor(request)

  const pay = body.pay
  if (!pay || (pay.kind !== 'link' && pay.kind !== 'card')) return json(400, { error: 'Pick how they pay.', field: 'pay' })
  if (pay.kind === 'link' && (typeof body.createKey !== 'string' || !CREATE_KEY_RE.test(body.createKey))) {
    return json(400, { error: 'Reload the page and try again.' })
  }
  if (pay.kind === 'card' && !isAttemptId(pay.attemptId)) return json(400, { error: 'Reload the page and try again.' })
  const simulated = pay.kind === 'card' && paymentBypassEnabled(request)
  if (pay.kind === 'card' && !simulated && (typeof pay.paymentToken !== 'string' || !pay.paymentToken || pay.paymentToken.length > 4000)) {
    return json(400, { error: 'Enter the card first.', field: 'pay' })
  }
  if (typeof body.startIso !== 'string' || !Number.isFinite(Date.parse(body.startIso))) return json(400, { error: 'Pick a day and time.', field: 'startIso' })
  const h = body.host ?? {}
  const host = {
    firstName: String(h.firstName ?? '').trim(),
    lastName: String(h.lastName ?? '').trim(),
    email: String(h.email ?? '').trim(),
    phone: String(h.phone ?? '').trim(),
  }
  if (!host.firstName) return json(400, { error: 'Add the host’s name.', field: 'host.firstName' })
  if (!EMAIL_RE.test(host.email)) return json(400, { error: 'Check the email address.', field: 'host.email' })
  if (host.phone.replace(/\D/g, '').length < 10) return json(400, { error: 'Add a phone number with the area code.', field: 'host.phone' })
  if (typeof body.craftId !== 'string' || !body.craftId) return json(400, { error: 'Pick a craft.', field: 'craftId' })
  const guests = typeof body.guests === 'number' ? body.guests : Number.NaN
  const addOns = body.addOns && typeof body.addOns === 'object' && !Array.isArray(body.addOns)
    ? Object.fromEntries(Object.entries(body.addOns as Record<string, unknown>).map(([k, v]) => [String(k), Number(v)]))
    : undefined

  const input: BookInput = {
    key: pay.kind === 'link' ? body.createKey : pay.attemptId,
    startIso: body.startIso,
    ...(typeof body.packageId === 'string' && body.packageId ? { packageId: body.packageId } : {}),
    guests,
    ...(addOns ? { addOns } : {}),
    craftId: body.craftId,
    host,
    pay: pay.kind === 'link' ? { kind: 'link' } : simulated ? { kind: 'simulated' } : { kind: 'card', paymentToken: pay.paymentToken, sourceKind: 'card' },
    audience: 'admin',
    by,
    origin: new URL(request.url).origin,
    requestUrl: request.url,
  }

  let out: Awaited<ReturnType<typeof bookParty>>
  try {
    out = await bookParty(input)
  } catch (err) {
    logger.error('Owner party booking failed', { error: err instanceof Error ? err.message : String(err) })
    return json(500, { error: partyMessages.unknown_outcome, code: 'unknown_outcome' })
  }
  switch (out.kind) {
    case 'refused':
      return json(out.status, { error: out.message, code: out.code, ...(out.field ? { field: out.field } : {}), ...out.extra })
    case 'in_progress':
      return json(409, { error: IN_PROGRESS_MESSAGE, code: 'in_progress' })
    case 'unknown':
      return json(502, { error: partyMessages.unknown_outcome, code: 'unknown_outcome', partyId: out.partyId })
  }

  const rec = out.rec
  let link: { url: string; email: boolean; text: boolean } | null = null
  let warning: string | undefined
  let party = rec
  if (pay.kind === 'link' && !out.replay) {
    try {
      const sent = await sendPaymentLink(rec, new URL(request.url).origin, by)
      link = { url: sent.url, email: sent.email, text: sent.text }
      party = sent.rec
      if (!sent.email && !sent.text) warning = 'Booked. The link didn’t go out by email or text. Use Send payment link on the party.'
    } catch (err) {
      logger.error('Payment link not sent after an owner booking', { partyId: rec.bookingId, error: String(err) })
      warning = err instanceof PaymentLinkError ? `Booked. ${err.message}` : 'Booked. The link didn’t go out. Use Send payment link on the party.'
    }
  }
  if (!out.replay) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'party-book', target: { kind: 'party', id: rec.bookingId, label: partyLabel(rec) },
      details: { startIso: rec.startIso, pay: pay.kind, cents: out.charge?.cents ?? 0, linkSent: !!link },
    })
  }
  return json(200, {
    data: {
      party: adminPartyView(party),
      replay: out.replay,
      link,
      charge: out.charge ? { cents: out.charge.cents, receiptUrl: out.charge.receiptUrl, ...(out.charge.simulated ? { simulated: true } : {}) } : null,
      emailSent: out.emailSent,
    },
    ...(warning ? { warning } : {}),
  })
}
