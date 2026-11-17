import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { rateLimited } from '@lib/rate-limit'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { attemptKey, isAttemptId, squareErrorCodes } from '@lib/checkout-attempt'
import { workshopMessages, TEXT_US } from '@lib/checkout-messages'
import { chargeOrder, type ChargeResult } from '@lib/booking-core/charge'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { alertOwners } from '@lib/owner-alert'
import { emailsFor } from '@lib/notify-settings'
import { sendEmail } from '@lib/email'
import { createLogger } from '@lib/logger'
import { isVisitId, loadVisits, MONOGRAM_NIGHT, nightByName, paidEmailLines, paidText, readPaid, savePaid, summarize, type PaidFacts, type VisitSummary } from '@lib/quote/corky-visits'

/**
 * POST /api/quote/corky-deposit.json { attemptId, paymentToken, verificationToken?, sourceKind?, firstName, lastName, email, phone, night?, monogram?, visitorId? }
 *
 * The $1,500 deposit that holds Saturday, December 12 for the Corky Child
 * Care Collective (the one-off quote page /quote/corky-christmas). The amount
 * is fixed here and never read from the page.
 *
 * Same money path as a party payment link (src/lib/parties/pay-balance.ts):
 * one Square order made with attemptKey(attemptId, 'order'), then chargeOrder
 * (src/lib/booking-core/charge.ts) with attemptKey(attemptId, 'pay'). A retry
 * of the same attempt gets the same order back, and Square is asked first
 * whether it is already paid, so it can never charge twice.
 *
 * Nothing here refunds or cancels anything. Payment bypass (local dev and
 * previews with DEV_BYPASS_PAYMENT=true) simulates the charge without Square
 * and sends no texts or emails.
 *
 * On a real payment the owners' text says what she picked (`night`, one of the
 * three names on the page) and sums up her visits from the page's own visit
 * log (src/lib/quote/corky-visits.ts); the email has every visit. Building that
 * summary can never hold up or fail the payment answer: it times out and falls
 * back to the plain text. `monogram` (the tote night's add-on) only counts with
 * the tote night; the deposit stays $1,500 either way.
 *
 * Once a real deposit is paid it is kept as `corky-paid` in the 'quote-visits'
 * store (create-only): the page locks the night in from it on any device
 * (GET /api/quote/corky-status.json), and a second deposit is answered
 * { paid: true, already: true } without charging. Simulated payments write nothing.
 */

export const prerender = false

const logger = createLogger('api:quote:corky-deposit')

/** $1,500. Fixed: the page never chooses the amount. */
export const DEPOSIT_CENTS = 150_000
export const DEPOSIT_LINE = 'Corky Child Care Collective · Dec 12 deposit'
/** Our id on the Square order (40 characters at most), so the payment is easy to find. */
export const DEPOSIT_REFERENCE = 'quote-corky-dec12'

export const DECLINED_MESSAGE = workshopMessages.card_declined
export const INVALID_MESSAGE = 'Please check your name, email and phone, then try again. Nothing was charged.'
export const STALE_MESSAGE = 'This page is out of date. Refresh it and try again. Nothing was charged.'
export const SLOW_DOWN_MESSAGE = 'That’s a lot of tries in a row. Give it a minute, then try again.'
export const ORDER_FAILED_MESSAGE = `We couldn’t start the payment. Nothing was charged. Please try again, or ${TEXT_US}.`
export const PRICE_MESSAGE = `Something’s off with the price, so nothing was charged. Please ${TEXT_US}.`

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** How long the visit summary may take before the owners get the plain text. */
const SUMMARY_TIMEOUT_MS = 3_000

/** Her visits, or null when the log can't be read in time (the text then leaves them out). */
async function visitSummary(): Promise<VisitSummary | null> {
  try {
    let t: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), SUMMARY_TIMEOUT_MS) })
    const s = await Promise.race([loadVisits().then(summarize), late]).finally(() => clearTimeout(t))
    if (!s) logger.warn('Visit summary timed out — plain deposit text')
    return s
  } catch (err) {
    logger.warn('Visit summary failed — plain deposit text', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

interface Buyer {
  firstName: string
  lastName: string
  email: string
  phone: string
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/** Ten US digits (a leading 1 is dropped), or null. */
export function phoneDigits(v: unknown): string | null {
  if (typeof v !== 'string') return null
  let d = v.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}

const prettyPhone = (d: string) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`

function buyerFrom(body: any): Buyer | null {
  const firstName = clean(body.firstName, 60)
  const lastName = clean(body.lastName, 60)
  const email = clean(body.email, 200)
  const digits = phoneDigits(body.phone)
  if (!firstName || !lastName || !EMAIL_RE.test(email) || !digits) return null
  return { firstName, lastName, email, phone: prettyPhone(digits) }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`corky-deposit:${clientAddress}`, 5, 60_000)) return fail(SLOW_DOWN_MESSAGE, 429, 'unavailable')
  let body: any
  try {
    body = await request.json()
  } catch {
    return fail(INVALID_MESSAGE, 400, 'invalid')
  }
  if (!body || typeof body !== 'object') return fail(INVALID_MESSAGE, 400, 'invalid')
  if (!isAttemptId(body.attemptId)) return fail(STALE_MESSAGE, 400, 'invalid')
  const buyer = buyerFrom(body)
  if (!buyer) return fail(INVALID_MESSAGE, 400, 'invalid')
  const attemptId: string = body.attemptId
  const who = `${buyer.firstName} ${buyer.lastName}`
  const nightRow = nightByName(body.night)
  const night = nightRow?.name ?? null
  // Only the tote night has monograms; anything else is ignored rather than blocking the payment.
  const monogram = body.monogram === true && nightRow?.id === MONOGRAM_NIGHT
  if (body.monogram === true && !monogram) logger.warn('Monograms sent without the tote night — ignored', { attemptId: body.attemptId, night })
  const visitorId = isVisitId(body.visitorId) ? body.visitorId : null

  // ── Simulated (local dev, previews with the payment bypass): no Square, no texts. ──
  if (paymentBypassEnabled(request)) {
    logger.warn('Payment bypassed (simulated Corky deposit)', { attemptId })
    return paidResponse(null, true)
  }

  // Already paid (another device, or a stale page): never a second deposit.
  try {
    const already = await readPaid()
    if (already) {
      logger.warn('Second Corky deposit refused — already paid', { attemptId, paidAt: already.paidAt })
      return json({ data: { paid: true, already: true } }, 200)
    }
  } catch (err) {
    // Can't read the paid record: carry on (the order's own idempotency still stops a retried double charge).
    logger.error('Could not check whether the Corky deposit is already paid', { error: err instanceof Error ? err.message : String(err) })
  }

  if (typeof body.paymentToken !== 'string' || !body.paymentToken || body.paymentToken.length > 4000) return fail(STALE_MESSAGE, 400, 'invalid')
  const verificationToken = typeof body.verificationToken === 'string' && body.verificationToken && body.verificationToken.length <= 4000 ? body.verificationToken : undefined
  const sourceKind = body.sourceKind === 'wallet' ? 'wallet' : 'card'

  // A test site that shares the live stores also shares the live Square: no real charge from there (R41).
  const testSite = classWritesRefusal(request)
  if (testSite) {
    logger.warn('Corky deposit refused on a test site', { attemptId })
    return fail(testSite, 503, 'unavailable')
  }

  try {
    // ── One Square order (same key on a retry → the same order) ──────────────
    let order: { id: string; totalAmount: number }
    try {
      order = await providers.payment.createOrder({
        idempotencyKey: attemptKey(attemptId, 'order'),
        locationId: siteConfig.providers.booking.config.locationId,
        customerId: null,
        lineItems: [{ name: DEPOSIT_LINE, quantity: 1, pricePerUnit: DEPOSIT_CENTS, note: `${who} · ${buyer.phone} · ${buyer.email}`.slice(0, 500) }],
        referenceId: DEPOSIT_REFERENCE,
      })
    } catch (err) {
      if (squareErrorCodes(err).includes('IDEMPOTENCY_KEY_REUSED')) return await unclear(null, err)
      logger.error('Corky deposit order failed — nothing charged', { attemptId, error: err instanceof Error ? err.message : String(err) })
      return fail(ORDER_FAILED_MESSAGE, 503, 'unavailable')
    }

    if (order.totalAmount !== DEPOSIT_CENTS) {
      logger.error('Corky deposit order total is not $1,500 — refusing', { attemptId, orderId: order.id, square: order.totalAmount })
      await alertOwners(`Deposit refused, price mismatch: Corky Child Care Collective, Square order ${order.id} came to $${(order.totalAmount / 100).toFixed(2)}. Nothing was charged.`).catch(() => undefined)
      return fail(PRICE_MESSAGE, 503, 'unavailable')
    }

    // A retry of this attempt: did an earlier try already pay this order?
    const found = await providers.payment.findOrderPayment(order.id).catch(() => null)
    if (found?.status === 'completed') return await paid(found.receiptUrl ?? null, order.id)
    if (found && found.status !== 'failed') return await unclear(order, new Error(`payment ${found.id} still going through (${found.status})`))

    const result: ChargeResult = await chargeOrder({
      orderId: order.id,
      amountCents: DEPOSIT_CENTS,
      paymentToken: body.paymentToken,
      email: buyer.email,
      attemptId,
      ...(verificationToken ? { verificationToken } : {}),
    })
    if (result.kind === 'declined') {
      logger.error('Corky deposit declined', { attemptId, orderId: order.id, sourceKind, reason: result.reason, codes: result.codes })
      return fail(DECLINED_MESSAGE, 402, 'card_declined')
    }
    if (result.kind === 'unknown') return await unclear(order, result.error)
    if (result.recovered) logger.info('Corky deposit answer was unclear but the order is paid', { attemptId, orderId: order.id })
    return await paid(result.payment.receiptUrl ?? null, order.id)
  } catch (err) {
    // Something broke after the order may have reached Square: never say nothing was charged.
    return await unclear(null, err)
  }

  async function paid(receiptUrl: string | null, orderId: string): Promise<Response> {
    logger.info('Corky deposit paid', { attemptId, orderId, night, monogram })
    try {
      await savePaid({ night, monogram, paidAt: new Date().toISOString(), firstName: buyer!.firstName, receiptUrl })
    } catch (err) {
      logger.error('Corky deposit paid but the lock-in was not saved', { attemptId, orderId, error: err instanceof Error ? err.message : String(err) })
    }
    const facts: PaidFacts = { who, phone: buyer!.phone, email: buyer!.email, orderId, night, monogram, visitorId }
    const summary = await visitSummary()
    let text: string
    let lines: string[]
    try {
      text = paidText(facts, summary)
      lines = paidEmailLines(facts, summary)
    } catch (err) {
      logger.warn('Visit summary wording failed — plain deposit text', { error: err instanceof Error ? err.message : String(err) })
      text = paidText(facts, null)
      lines = paidEmailLines(facts, null)
    }
    await Promise.allSettled([
      alertOwners(text, 'booking-alerts'),
      (async () => sendEmail({
        to: await emailsFor('booking-alerts'),
        subject: `Deposit paid: Corky Child Care Collective, Dec 12${night ? ` · ${night}${monogram ? ' + monograms' : ''}` : ''}`,
        text: lines.join('\n'),
        html: `<div style="font-family:sans-serif;line-height:1.5;">${lines.map((l) => (l ? `<div>${esc(l)}</div>` : '<br />')).join('')}</div>`,
      }))(),
    ]).then((rs) => rs.forEach((r) => { if (r.status === 'rejected') logger.error('Deposit announcement failed', { error: String(r.reason) }) }))
    return paidResponse(receiptUrl, false)
  }

  async function unclear(o: { id: string } | null, err: unknown): Promise<Response> {
    logger.error('CORKY DEPOSIT OUTCOME UNKNOWN — needs a person', {
      attemptId, orderId: o?.id ?? null, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err),
    })
    await alertOwners(`Deposit unclear: Corky Child Care Collective, Dec 12, $1,500 (${who}, ${buyer!.phone}). Check Square${o ? ` for order ${o.id}` : ''}.${night ? ` Picked: ${night}${monogram ? ' + monograms' : ''}.` : ''}`).catch(() => undefined)
    return json({ why: 'checking', code: 'unknown_outcome' }, 202)
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function paidResponse(receiptUrl: string | null, simulated: boolean): Response {
  return json({ data: { paid: true, ...(receiptUrl ? { receiptUrl } : {}), ...(simulated ? { simulated: true } : {}) } }, 200)
}

function fail(detail: string, status: number, code: string): Response {
  return json({ error: 'Unable to take the deposit', code, detail }, status)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
