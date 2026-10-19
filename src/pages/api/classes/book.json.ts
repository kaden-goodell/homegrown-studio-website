import type { APIRoute } from 'astro'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { attemptKey, chargeOutcomeOf, isAttemptId, squareErrorCodes } from '@lib/checkout-attempt'
import { alertOwners } from '@lib/owner-alert'
import { sendEmail } from '@lib/email'
import { announceBooking } from '@lib/booking-alert'
import { reportBooking } from '@lib/posthog-server'
import { cleanAttribution } from '@lib/attribution'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isPhone, CONTACT_MESSAGES } from '@lib/contact-rules'
import { onFileToAskAbout } from '@lib/email-fix'
import { formatSlotLabel } from '@lib/studio-time'
import { getClass } from '@lib/classes/class-store'
import { quote as quoteFor, type BookingRequest, type Quote } from '@lib/classes/pricing'
import { confirm, getLedger, hold, release, type HoldInput, type LedgerLine } from '@lib/classes/seat-ledger'
import {
  bookingIdFor,
  classMessages,
  cutoffRefusal,
  orderLinesFor,
  paidCentsOf,
  seatsLabelFor,
  soldOutMessage,
  CLASS_TAX_PERCENT,
  HOLD_MINUTES,
  PRICE_DRIFT_TOLERANCE_CENTS,
  PRICE_MISMATCH_MESSAGE,
  type ClassCheckoutCode,
} from '@lib/classes/checkout'
import { sendClassConfirmation } from '@lib/classes/confirmation'
import type { ScheduledClass } from '@lib/classes/types'

const logger = createLogger('api:classes:book')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Book and pay for seats on one of our own classes: one Square order, one charge.
 *
 *   1. the class (open, before its cutoff) and a quote priced from the class, never the page
 *   2. hold the seats in our ledger           (nothing charged)
 *   3. one Square order of catalog lines      (Square adds the tax; its total is what is charged)
 *   4. charge it, then confirm the seats
 *   5. email, owners' text and analytics, after the reply
 *
 * The booking id comes from the attempt id, so a retry finds its own booking:
 * already paid → the stored answer, still running → "give it a minute". Never
 * a second charge. Every failure is one of three honest answers: not charged,
 * charged, or unknown. A refused card lets the seats go; no answer keeps them.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  if (!bookingsOpen(request, 'workshops')) return bookingsClosedResponse()
  if (rateLimited(`class-book:${clientAddress}`, 5, 60_000)) {
    return fail(429, 'unavailable', 'That’s a lot of attempts in a row. Give it a minute, then try again.')
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid')
  }
  if (!body || typeof body !== 'object') return fail(400, 'invalid')

  const classId = typeof body.classId === 'string' ? body.classId : ''
  const passId = typeof body.passId === 'string' ? body.passId : ''
  const paymentToken = typeof body.paymentToken === 'string' ? body.paymentToken : ''
  if (!classId || !passId || !body.tickets || typeof body.tickets !== 'object') return fail(400, 'invalid')
  if (!isAttemptId(body.attemptId)) return fail(400, 'invalid', 'This page is out of date. Reload it and book again. Nothing was charged.')
  const attemptId: string = body.attemptId
  const simulated = paymentBypassEnabled(request)
  if (!simulated && (!paymentToken || paymentToken.length > 4000)) return fail(400, 'invalid')

  const givenName = String(body.customer?.givenName ?? '').trim()
  const familyName = String(body.customer?.familyName ?? '').trim()
  const email = String(body.customer?.email ?? '').trim()
  const phone = String(body.customer?.phone ?? '').trim()
  if (!givenName || !familyName) return fail(400, 'invalid', 'Add your first and last name.')
  if (!EMAIL_RE.test(email)) return fail(400, 'invalid', 'That email doesn’t look right. Check for typos.')
  if (!isPhone(phone)) return fail(400, 'invalid', CONTACT_MESSAGES.phone)
  const person = { givenName, familyName, email, phone }

  // Only the fields that shape a booking; any price the page sends is ignored.
  const req: BookingRequest = {
    passId,
    tickets: body.tickets,
    ...(Array.isArray(body.sessionIds) ? { sessionIds: body.sessionIds.map(String) } : {}),
    ...(Array.isArray(body.seats) ? { seats: body.seats } : {}),
  }

  let cls: ScheduledClass | null
  try {
    cls = await getClass(classId)
  } catch (err) {
    logger.error('Class unreadable before booking — refusing', { classId, error: String(err) })
    return fail(502, 'unavailable')
  }
  if (!cls) return fail(404, 'not_open', 'We couldn’t find that class. Nothing was charged.')

  // ── A retry of this attempt? ────────────────────────────────────────────────
  const bookingId = bookingIdFor(attemptId)
  const now = new Date()
  let mine: LedgerLine[]
  try {
    mine = (await getLedger(cls.id)).lines.filter((l) => l.bookingId === bookingId)
  } catch (err) {
    logger.error('Seat ledger unreadable before booking — refusing', { classId, error: String(err) })
    return fail(502, 'unavailable')
  }
  const paid = mine.filter((l) => l.state === 'confirmed' || l.state === 'refunded')
  if (paid.length) {
    logger.info('Retried class checkout was already booked — returning the stored result', { bookingId })
    return success(cls, paid, { receiptUrl: null, emailSent: true, replayed: true })
  }
  if (mine.some((l) => l.state === 'held' && l.holdExpiresAt && Date.parse(l.holdExpiresAt) > now.getTime())) {
    return fail(409, 'in_progress')
  }

  // ── 1. The class, the quote, the cutoff ─────────────────────────────────────
  if (cls.status !== 'open') return fail(409, 'not_open')
  const priced = quoteFor(cls, req, now, CLASS_TAX_PERCENT)
  if (!priced.ok) {
    // A field problem is the page's to fix; anything else is the class having moved on.
    return priced.field ? fail(400, 'invalid', priced.error) : fail(409, 'not_open', `${priced.error} Nothing was charged.`)
  }
  const q: Quote = priced.value
  const cutoff = cutoffRefusal(cls, q.sessionIds, now)
  if (cutoff) return fail(409, 'not_open', cutoff)

  const holdInput: HoldInput = {
    bookingId, passId, source: 'online', customer: person, ttlMinutes: HOLD_MINUTES,
    ...(req.seats ? { seats: req.seats } : {}),
  }
  const seatsLabel = seatsLabelFor(cls, q.lines.filter((l) => l.kind === 'seat'))
  const who = `${givenName} ${familyName} (${email}, ${phone})`
  const firstStart = cls.sessions.find((s) => s.id === q.sessionIds[0])?.startIso ?? cls.sessions[0]?.startIso ?? ''

  // Simulated payments (local dev and previews): hold and confirm, no Square.
  if (simulated) {
    const held = await holdSeats(cls, q, holdInput, now)
    if (held) return held
    logger.warn('Payment bypassed (simulated class booking)', { classId: cls.id, bookingId })
    const lines = await confirm(cls.id, bookingId, { orderId: `sim-${bookingId}`, paymentId: null }, { cls, quote: q, input: holdInput }, new Date())
    return finish({ cls, q, lines, charged: q.totalCents, receiptUrl: null, simulated: true, onFile: null })
  }

  // Every line must be on the POS item before anything is held.
  const orderLines = orderLinesFor(cls, q, req.seats)
  if (!orderLines.ok) {
    logger.error('Class not on the POS — refusing', { classId: cls.id, missing: orderLines.missing })
    await alertOwners(`Class ${cls.content.name} isn't on the POS yet. Open it in /admin and Save.`).catch(() => undefined)
    return fail(502, 'unavailable')
  }

  // ── 2. The customer (not fatal), then hold the seats ────────────────────────
  let customerId: string | null = null
  let onFile: string | null = null
  try {
    const found = await providers.customer.findOrCreate({ email, givenName, familyName, phone })
    customerId = found.id
    onFile = onFileToAskAbout(email, found as { email?: string; matchedBy?: string })
  } catch (err) {
    logger.error('Customer lookup failed — continuing', { error: String(err) })
  }

  const notHeld = await holdSeats(cls, q, holdInput, now)
  if (notHeld) return notHeld
  const letGo = async (why: string) => {
    try {
      await release(cls!.id, bookingId)
    } catch (err) {
      logger.error('HELD SEATS NOT RELEASED (they run out by themselves)', { bookingId, why, error: String(err) })
    }
  }

  // ── 3. One Square order ─────────────────────────────────────────────────────
  let order: { orderId: string; totalCents: number }
  try {
    order = await providers.payment.createClassOrder({
      locationId: siteConfig.providers.booking.config.locationId,
      customerId,
      idempotencyKey: attemptKey(attemptId, 'order'),
      lines: orderLines.lines,
      referenceId: bookingId,
    })
  } catch (err) {
    logger.error('Class order failed — releasing seats', { bookingId, error: err instanceof Error ? err.message : String(err) })
    await letGo('order failed')
    return fail(502, 'unavailable')
  }

  // Square's total is what is charged; our quote is for display.
  const drift = order.totalCents - q.totalCents
  if (drift > PRICE_DRIFT_TOLERANCE_CENTS) {
    logger.error('Class order total far above the quote — refusing', { bookingId, orderId: order.orderId, quote: q.totalCents, square: order.totalCents })
    await letGo('price mismatch')
    await alertOwners(
      `Class booking refused, price mismatch: ${cls.content.name}, booking ${bookingId}. Quote ${dollars(q.totalCents)}, Square ${dollars(order.totalCents)}. Check the class's prices on the POS. Nothing was charged.`,
    ).catch(() => undefined)
    return fail(502, 'unavailable', PRICE_MISMATCH_MESSAGE)
  }
  if (drift > 0) {
    logger.warn('Class order total a little above the quote — charging Square’s total', { bookingId, quote: q.totalCents, square: order.totalCents })
    const note = `Square total differed by ${dollars(drift)} on booking ${bookingId} (quote ${dollars(q.totalCents)}, Square ${dollars(order.totalCents)})`
    await sendEmail({
      to: siteConfig.ownerEmails.join(', '),
      subject: `Class price differed — ${cls.content.name}`,
      text: note,
      html: `<p>${note}</p>`,
    }).catch(() => undefined)
  }
  const charged = order.totalCents

  // ── 4. Charge ───────────────────────────────────────────────────────────────
  let payment: Awaited<ReturnType<typeof providers.payment.processPayment>> | null = null
  try {
    payment = await providers.payment.processPayment({
      orderId: order.orderId,
      paymentToken,
      amount: charged,
      currency: 'USD',
      buyerEmailAddress: email,
      idempotencyKey: attemptKey(attemptId, 'pay'),
    })
  } catch (err) {
    const outcome = chargeOutcomeOf(err)
    if (outcome === 'unknown') {
      // Before saying "we're not sure", ask whether the order shows as paid.
      try {
        payment = await providers.payment.findOrderPayment(order.orderId)
      } catch { /* still unknown */ }
    }
    if (payment) {
      logger.info('Charge answer was unclear but the order is paid — confirming', { bookingId, orderId: order.orderId })
    } else if (outcome === 'not_charged') {
      logger.error('Class payment refused — releasing seats', { bookingId, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err) })
      await letGo('card declined')
      return fail(402, 'card_declined')
    } else {
      // The charge may have gone through: the seats stay held, a person settles it.
      logger.error('CLASS PAYMENT OUTCOME UNKNOWN — seats kept, needs a person', {
        bookingId, attemptId, orderId: order.orderId, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err),
      })
      await alertOwners(
        `Class payment unclear: ${who}, ${seatsLabel}, ${cls.content.name}, ${formatSlotLabel(firstStart)}. Check Square for a ${dollars(charged)} payment on order ${order.orderId}. Booking ${bookingId}, attempt ${attemptId}. The seats are held, not confirmed.`,
      ).catch(() => undefined)
      return fail(502, 'unknown_outcome')
    }
  }
  if (!payment) return fail(502, 'unknown_outcome')
  if (payment.status === 'failed') {
    logger.error('Class payment failed — releasing seats', { bookingId, paymentId: payment.id })
    await letGo('payment failed')
    return fail(402, 'card_declined')
  }

  // ── Paid. Nothing below may turn this into a failure. ───────────────────────
  let lines: LedgerLine[]
  try {
    lines = await confirm(cls.id, bookingId, { orderId: order.orderId, paymentId: payment.id }, { cls, quote: q, input: holdInput }, new Date())
  } catch (err) {
    logger.error('PAID CLASS SEATS NOT RECORDED', { bookingId, orderId: order.orderId, error: String(err) })
    await alertOwners(
      `Class booked and paid, but the seats weren't recorded: ${who}, ${seatsLabel}, ${cls.content.name}, ${formatSlotLabel(firstStart)}. Order ${order.orderId}, booking ${bookingId}. Add them by hand.`,
    ).catch(() => undefined)
    // Answer from the quote: the customer has paid.
    lines = q.lines.filter((l) => l.kind === 'seat').map((l) => ({
      bookingId, ticketTypeId: l.ticketTypeId, sessionIds: q.sessionIds, square: { orderId: order.orderId, paymentId: payment!.id, lineUid: null },
      priceCents: l.cents, taxCents: l.taxCents, addOnCents: 0, addOnTaxCents: 0,
    })) as LedgerLine[]
  }
  return finish({ cls, q, lines, charged, receiptUrl: payment.receiptUrl ?? null, simulated: false, onFile })

  // ── helpers (closures over this request) ────────────────────────────────────

  async function holdSeats(c: ScheduledClass, qq: Quote, input: HoldInput, at: Date): Promise<Response | null> {
    try {
      const held = await hold(c, qq, input, at)
      if (held.ok) return null
      return fail(409, 'sold_out', soldOutMessage(c, held.sessionId, held.left))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/already has seats/.test(msg)) return fail(409, 'in_progress')
      logger.error('Could not hold class seats', { bookingId, error: msg })
      return fail(502, 'unavailable')
    }
  }

  async function finish(f: {
    cls: ScheduledClass; q: Quote; lines: LedgerLine[]; charged: number; receiptUrl: string | null; simulated: boolean; onFile: string | null
  }): Promise<Response> {
    const { cls: c, q: qq } = f
    const pickLines: string[] = []
    for (const [i, seat] of (req.seats ?? []).entries()) {
      for (const question of c.content.questions) {
        const a = seat?.answers?.[question.id]
        if (a) pickLines.push(`Seat ${i + 1} · ${question.label} ${a}`)
      }
    }
    const finishing = async (): Promise<boolean> => {
      const [sent] = await Promise.all([
        sendClassConfirmation({
          origin: new URL(request.url).origin,
          bookingId, cls: c, sessionIds: qq.sessionIds, seats: qq.seats, seatsLabel,
          email, givenName, receiptUrl: f.receiptUrl, totalChargedCents: f.charged,
          ...(pickLines.length ? { pickLines } : {}),
          ...(f.onFile ? { alsoTo: f.onFile } : {}),
        }).catch((err) => {
          logger.error('Class confirmation email failed (booking still confirmed)', { bookingId, error: String(err) })
          return false
        }),
        f.simulated
          ? Promise.resolve()
          : announceBooking({
              kind: 'class', who: `${givenName} ${familyName}`, what: `${seatsLabel}, ${c.content.name}`,
              when: formatSlotLabel(firstStart), paidCents: f.charged, email, phone,
              ...(pickLines.length ? { extra: pickLines.join('; ') } : {}),
            }),
        reportBooking({
          requestUrl: request.url,
          kind: 'workshop',
          bookingId,
          amountCents: qq.subtotalCents,
          email, firstName: givenName, lastName: familyName,
          items: c.content.ticketTypes
            .map((t) => ({ t, n: qq.lines.filter((l) => l.kind === 'seat' && l.ticketTypeId === t.id).length }))
            .filter(({ n }) => n > 0)
            .map(({ t, n }) => ({
              item_id: `${c.id}:${passId}:${t.id}`, item_name: `${c.content.name} (${t.label})`, item_category: 'class',
              price: (c.content.prices[passId]?.[t.id] ?? 0) / 100, quantity: n,
            })),
          attribution: cleanAttribution(body.attribution),
          posthogId: body.posthogId,
          simulated: f.simulated,
          extra: {
            seats: qq.seats, tickets: seatsLabel, class: c.content.name, class_id: c.id, own_class: true,
            class_date: firstStart.slice(0, 10), days_ahead: Math.round((Date.parse(firstStart) - Date.now()) / 86_400_000),
            paid_with: String(body.sourceKind ?? 'card'),
          },
        }).catch(() => undefined),
      ])
      return sent
    }
    let emailSent: boolean
    const netlify = (locals as { netlify?: { context?: { waitUntil?: (p: Promise<unknown>) => void } } } | undefined)?.netlify?.context
    if (typeof netlify?.waitUntil === 'function') {
      netlify.waitUntil(finishing().then(async (sent) => {
        if (sent || f.simulated) return
        await alertOwners(
          `Confirmation email didn't send: ${who}, ${seatsLabel}, ${c.content.name}, ${formatSlotLabel(firstStart)}. The booking is paid (${bookingId}); please send them the details.`,
        ).catch(() => undefined)
      }).catch(() => undefined))
      emailSent = true
    } else {
      // Local dev and tests: no Netlify context, so finish before replying.
      emailSent = await finishing()
    }
    return success(c, f.lines, { receiptUrl: f.receiptUrl, emailSent, chargedCents: f.charged, ...(f.simulated ? { simulated: true } : {}) })
  }
}

/** The booked answer. A replay rebuilds it from the ledger's paid lines. */
function success(
  cls: ScheduledClass,
  lines: LedgerLine[],
  extra: { receiptUrl: string | null; emailSent: boolean; chargedCents?: number; replayed?: boolean; simulated?: boolean },
): Response {
  const first = lines[0]
  return new Response(
    JSON.stringify({
      data: {
        bookingId: first.bookingId,
        classId: cls.id,
        orderId: first.square.orderId,
        paymentId: first.square.paymentId,
        receiptUrl: extra.receiptUrl,
        totalChargedCents: extra.chargedCents ?? lines.reduce((s, l) => s + paidCentsOf(l), 0),
        seatsBooked: lines.length,
        ticketsLabel: seatsLabelFor(cls, lines),
        sessionIds: first.sessionIds,
        emailSent: extra.emailSent,
        ...(extra.replayed ? { replayed: true } : {}),
        ...(extra.simulated ? { simulated: true } : {}),
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}

/** A plain sentence for the customer, plus a code the booking panel can act on. */
function fail(status: number, code: ClassCheckoutCode, detail?: string) {
  return new Response(
    JSON.stringify({ error: 'Unable to book class', code, detail: detail ?? classMessages[code] }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
