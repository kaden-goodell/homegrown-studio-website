import type { APIRoute } from 'astro'
import { bookingsOpenNow, bookingsClosedResponse } from '@lib/bookings-gate'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { providers } from '@config/providers'
import { siteConfig } from '@config/site.config'
import { attemptKey, isAttemptId, squareErrorCodes } from '@lib/checkout-attempt'
import { chargeOrder, judgeDrift, paidOnOrder, tellOwnersOfDrift } from '@lib/booking-core/charge'
import { alertOwners } from '@lib/owner-alert'
import { announceBooking } from '@lib/booking-alert'
import { reportBooking } from '@lib/posthog-server'
import { cleanAttribution } from '@lib/attribution'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { isPhone, CONTACT_MESSAGES } from '@lib/contact-rules'
import { onFileToAskAbout } from '@lib/email-fix'
import { formatSlotLabel } from '@lib/studio-time'
import { getClass } from '@lib/classes/class-store'
import { quote as quoteFor, type BookingRequest, type Quote, type QuoteOptions } from '@lib/classes/pricing'
import { confirm, extendHold, getLedger, hold, release, type HoldInput, type LedgerLine } from '@lib/classes/seat-ledger'
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
  PRICE_MISMATCH_MESSAGE,
  priceChangedMessage,
  recentSamePerson,
  RECENT_CLASS_BOOKING_MESSAGE,
  STILL_GOING_THROUGH_MESSAGE,
  publicQuote,
  UNCLEAR_HOLD_HOURS,
  cleanSeats,
  type ClassCheckoutCode,
  type OrderLine,
  type OrderLineDiscount,
} from '@lib/classes/checkout'
import { claimConfirmation, releaseConfirmation, sendClassConfirmation } from '@lib/classes/confirmation'
import type { ScheduledClass } from '@lib/classes/types'
import { byOf, staffAuthorized } from '@lib/staff-auth'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import type { SaleOptions } from '@lib/classes/pricing'
import { earlyBirdRunning } from '@lib/classes/early-bird'
import { countUse, extendUse, getPromo, getUses, releaseUse, reserveUse } from '@lib/promos/promo-store'
import { normalizeCode, promoRefusal, PROMO_REFUSALS, usesLeft } from '@lib/promos/rules'
import { getWaitlist } from '@lib/classes/waitlist-store'
import { waitlistGoesFirst } from '@lib/classes/waitlist-rules'
import type { PromoCode } from '@lib/promos/types'
import { notePaidOnCancelled } from '@lib/classes/paid-on-cancelled'
import { giftCardRefusal } from '@lib/parties/checkout'

/** Square's smallest card charge. */
const MIN_CARD_CENTS = 100

const logger = createLogger('api:classes:book')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

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
 *
 * Stage 4: a promo code (`promoCode`) is checked before anything is held and
 * reserves a use with the seats (released on a definite failure, kept with
 * them on no answer, confirmed when paid); the early-bird and the code go to
 * Square as per-line discounts. The page sends the total it showed
 * (`expectedTotalCents`): a higher total now charges nothing and answers
 * `price_changed` with the new one (review I2). A $0 total (D3: a 100% code,
 * a code bigger than the price, a $0 early-bird) books with no card, no
 * Square order and no payment.
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  // "Pay on the iPad" (/staff Sell a seat, ?door=1): the same checkout, run by the crew at the door.
  // Only signed-in staff; the seats are 'door-card', a running session can still be sold, and the
  // online sign-up cutoff doesn't apply.
  const door = new URL(request.url).searchParams.get('door') === '1'
  const member = door ? await staffAuthorized(request) : null
  if (door && !member) return fail(401, 'invalid', 'Sign in to /staff to sell a seat at the door. Nothing was charged.')
  const saleBase: SaleOptions = door ? { door: true } : {}
  // R41: a test site with no store of its own never books (or simulates paying for) a live seat.
  const testSite = classWritesRefusal(request)
  if (testSite) return fail(503, 'unavailable', testSite)
  if (!door && !await bookingsOpenNow(request, 'workshops')) return await bookingsClosedResponse()
  if (!door && rateLimited(`class-book:${clientAddress}`, 5, 60_000)) {
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
  // A card is needed unless the booking turns out to be free (checked once it is priced).
  if (paymentToken.length > 4000) return fail(400, 'invalid')
  // Stage 4: the code as typed ("fall-friends" reads as FALLFRIENDS); one that can't be a code is refused here.
  const typedCode = typeof body.promoCode === 'string' ? body.promoCode.trim().slice(0, 60) : ''
  const promoCode = typedCode ? normalizeCode(typedCode) : null
  if (typedCode && !promoCode) return fail(409, 'promo', `${PROMO_REFUSALS.invalid} Nothing was charged.`)
  // Review I2: the total the page showed on the Pay button.
  const expectedTotalCents = Number.isInteger(body.expectedTotalCents) && body.expectedTotalCents >= 0 ? (body.expectedTotalCents as number) : null

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
  // Answers only to this class's own questions reach the ledger.
  if (req.seats) req.seats = cleanSeats(cls, req.seats)

  // ── A retry of this attempt? ────────────────────────────────────────────────
  const bookingId = bookingIdFor(attemptId)
  const now = new Date()
  let mine: LedgerLine[]
  let everyLine: LedgerLine[]
  try {
    everyLine = (await getLedger(cls.id)).lines
    mine = everyLine.filter((l) => l.bookingId === bookingId)
  } catch (err) {
    logger.error('Seat ledger unreadable before booking — refusing', { classId, error: String(err) })
    return fail(502, 'unavailable')
  }
  const paid = mine.filter((l) => l.state === 'confirmed' || l.state === 'refunded')
  if (paid.length) {
    logger.info('Retried class checkout was already booked — returning the stored result', { bookingId })
    return success(cls, paid, { receiptUrl: null, emailSent: true, replayed: true })
  }
  const inProgress = mine.some((l) => l.state === 'held' && l.holdExpiresAt && Date.parse(l.holdExpiresAt) > now.getTime())

  // ── Stage 4: the code, read before anything is held. A store we can't read charges nothing. ──
  let promo: PromoCode | null = null
  let promoUses: Awaited<ReturnType<typeof getUses>> = null
  if (promoCode) {
    try {
      promo = await getPromo(promoCode)
      promoUses = promo ? await getUses(promoCode) : null
    } catch (err) {
      logger.error('Promo codes unreadable before booking — refusing', { classId, error: String(err) })
      return fail(502, 'unavailable')
    }
  }
  const sale: QuoteOptions = { ...saleBase, ...(promo ? { promo } : {}) }

  const who = `${givenName} ${familyName} (${email}, ${phone})`
  // Set once the quote is known.
  let q: Quote
  let holdInput: HoldInput
  let seatsLabel = ''
  let firstStart = ''
  let customerId: string | null = null
  let onFile: string | null = null
  const lookUpCustomer = async () => {
    try {
      const found = await providers.customer.findOrCreate({ email, givenName, familyName, phone })
      customerId = found.id
      onFile = onFileToAskAbout(email, found as { email?: string; matchedBy?: string })
    } catch (err) {
      logger.error('Customer lookup failed — continuing', { error: String(err) })
    }
  }

  if (inProgress) {
    // The first try is still running, or ended with no answer. If Square shows
    // it paid, answer booked; otherwise ask them to wait. Never a second charge.
    if (simulated) return fail(409, 'in_progress')
    // Money M2: priced as of the first try (when its seats were held), so a retry after the early-bird or a
    // code ended rebuilds the very same order body: Square then hands back that order (and says if it's paid)
    // instead of refusing the reused key and leaving the customer on "still finishing" for a day.
    const heldAt = mine.filter((l) => l.state === 'held').map((l) => Date.parse(l.at)).filter(Number.isFinite).sort((a, b) => a - b)[0]
    const priced = quoteFor(cls, req, heldAt !== undefined ? new Date(heldAt) : now, CLASS_TAX_PERCENT, sale)
    const lines = priced.ok ? orderLinesFor(cls, priced.value, req.seats) : null
    if (!priced.ok || !lines?.ok) return fail(409, 'in_progress')
    // M3: a free booking (D3) never has a Square order; asking Square would make a stray $0 one.
    if (priced.value.totalCents === 0) return fail(409, 'in_progress')
    setQuote(cls, priced.value)
    await lookUpCustomer()
    const recovered = await paidEarlier(cls, lines)
    if (recovered && recovered !== 'unknown') return recovered
    return fail(409, 'in_progress')
  }

  // ── C2: the same person a few minutes ago, with another attempt (a closed panel, a reload) ──
  if (!door) {
    const recent = recentSamePerson(everyLine, bookingId, email, now)
    if (recent === 'held') {
      logger.info('Same person still has a payment going through on this class — nothing charged', { classId: cls.id, bookingId })
      return fail(409, 'in_progress', STILL_GOING_THROUGH_MESSAGE)
    }
    if (recent === 'booked' && body.confirmRepeat !== true) {
      logger.info('Same person booked this class minutes ago — asking before a second booking', { classId: cls.id, bookingId })
      return fail(409, 'recent_booking', RECENT_CLASS_BOOKING_MESSAGE)
    }
  }

  // ── 1. The class, the quote, the cutoff ─────────────────────────────────────
  // At the door a class whose sign-ups were stopped can still take someone standing there.
  if (cls.status !== 'open' && !(door && cls.status === 'closed')) return fail(409, 'not_open')
  const priced = quoteFor(cls, req, now, CLASS_TAX_PERCENT, sale)
  if (!priced.ok) {
    // A field problem is the page's to fix; anything else is the class having moved on.
    return priced.field ? fail(400, 'invalid', priced.error) : fail(409, 'not_open', `${priced.error} Nothing was charged.`)
  }
  setQuote(cls, priced.value)
  const cutoff = door ? null : cutoffRefusal(cls, q!.sessionIds, now)
  if (cutoff) return fail(409, 'not_open', cutoff)

  // The code works on this class now, with a use left (its own earlier hold or use doesn't count against it).
  if (promoCode) {
    const usedByMe = !!promoUses?.used.some((u) => u.bookingId === bookingId)
    const refusal = promoRefusal(promo, cls, now, promo && !usedByMe ? usesLeft(promo, promoUses, now, bookingId) : null)
    if (refusal) return fail(409, 'promo', `${refusal} Nothing was charged.`)
  }

  // Review I2: never more than the page showed. Higher now → nothing held or charged; the new total goes back.
  if (expectedTotalCents === null) {
    logger.warn('Class booking sent no shown total — charging the server total', { bookingId })
  } else if (q!.totalCents > expectedTotalCents) {
    const ebEnded = !!cls.content.earlyBird && !earlyBirdRunning(cls.content, now)
    logger.info('Class price rose since the page showed it — nothing charged', { bookingId, shown: expectedTotalCents, now: q!.totalCents, ebEnded })
    return priceChanged(q!, priceChangedMessage(q!.totalCents, ebEnded))
  }

  const free = q!.totalCents === 0
  // Money M4: a code can leave a few cents to pay, below what a card can be charged: say so (never "declined").
  if (!free && q!.totalCents < MIN_CARD_CENTS) {
    return fail(409, 'promo', `That leaves ${dollars(q!.totalCents)} to pay, and a card can’t be charged less than $1. Nothing was charged. Call or text us and we’ll book you in.`)
  }
  if (!free && !simulated && !paymentToken) return fail(400, 'invalid')
  // Money M6: a gift card must cover the whole total (Square refuses a short one with a generic decline).
  if (!free && !simulated && body.sourceKind === 'gift_card') {
    const refusal = await giftCardRefusal(paymentToken, q!.totalCents)
    if (refusal && refusal.kind === 'refused') {
      return new Response(JSON.stringify({ error: 'Unable to book class', code: refusal.code, detail: refusal.message, ...(refusal.extra ?? {}) }), {
        status: refusal.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      })
    }
  }
  // D3: free bookings get the booking routes' guards plus one of their own (a code can't be farmed for seats).
  if (free && !door && rateLimited(`class-free:${email.toLowerCase()}`, 3, 60 * 60_000)) {
    return fail(429, 'unavailable', 'That’s a lot of free bookings in a row. Give it a little while, or call us and we’ll book you in.')
  }

  // Simulated payments (local dev and previews), and free bookings (D3): hold and confirm, no Square order or payment.
  if (simulated || free) {
    const first = await waitlistFirst(cls, now)
    if (first) return first
    if (free) await lookUpCustomer()
    const noUse = await holdPromo(now)
    if (noUse) return noUse
    const held = await holdSeats(cls, now)
    if (held) {
      // The same attempt already running owns this booking's use: leave it be.
      if (!(await isInProgress(held))) await letGoPromo('seats not held')
      return held
    }
    if (simulated && !free) logger.warn('Payment bypassed (simulated class booking)', { classId: cls.id, bookingId })
    const orderId = free ? null : `sim-${bookingId}`
    if (free) logger.info('Free class booking (no Square order or payment)', { classId: cls.id, bookingId, code: q!.promo?.code ?? null })
    const lines = await confirmPaid(cls, { orderId, paymentId: null, chargedCents: q!.totalCents })
    return finish({ cls, q: q!, lines, charged: q!.totalCents, receiptUrl: null, simulated: simulated && !free, onFile: free ? onFile : null })
  }

  // Every line must be on the POS item before anything is held.
  const orderLines = orderLinesFor(cls, q!, req.seats)
  if (!orderLines.ok) {
    logger.error('Class not on the POS — refusing', { classId: cls.id, missing: orderLines.missing })
    await alertOwners(`${cls.content.name} isn't on the register yet, so it can't be booked online. Open the class in /admin and tap Put it on the register.`).catch(() => undefined)
    return fail(502, 'unavailable')
  }

  // ── 2. The customer (not fatal), the code's use, then hold the seats ────────
  const first = await waitlistFirst(cls, now)
  if (first) return first
  await lookUpCustomer()
  const noUse = await holdPromo(now)
  if (noUse) return noUse
  const notHeld = await holdSeats(cls, now)
  if (notHeld) {
    if (!(await isInProgress(notHeld))) await letGoPromo('seats not held')
    if (notHeld.status !== 409 || (await notHeld.clone().json()).code !== 'sold_out') return notHeld
    // Full now. If an earlier try of this attempt paid (its hold ran out and
    // the seat was resold), the booking stands: record it, never say "not charged".
    const recovered = await paidEarlier(cls, orderLines)
    if (recovered === 'unknown') {
      return fail(409, 'sold_out', 'That class just filled up. If you already paid, check your email for a receipt before trying again.')
    }
    return recovered ?? notHeld
  }
  const letGo = async (why: string) => {
    try {
      await release(cls!.id, bookingId)
    } catch (err) {
      logger.error('HELD SEATS NOT RELEASED (they run out by themselves)', { bookingId, why, error: String(err) })
    }
    await letGoPromo(why)
  }

  // ── 3. One Square order ─────────────────────────────────────────────────────
  let order: { orderId: string; totalCents: number; lineTotals?: { totalCents: number; taxCents: number }[] }
  try {
    order = await createOrder(orderLines)
  } catch (err) {
    if (squareErrorCodes(err).includes('IDEMPOTENCY_KEY_REUSED')) {
      // An earlier try of this attempt made a different order. It may be paid.
      return unknownOutcome(cls, null, err)
    }
    logger.error('Class order failed — releasing seats', { bookingId, error: err instanceof Error ? err.message : String(err) })
    await letGo('order failed')
    return fail(502, 'unavailable')
  }

  // Square's total is what is charged; our quote is for display.
  // M2: we round a half-cent of tax up, per line; Square may round it down. So Square up to 1 cent per line
  // lower is expected rounding (always in the customer's favour): charged, logged, no owners' email.
  const roundingCents = q!.lines.length
  const verdict = judgeDrift(q!.totalCents, order.totalCents, { tellBelowCents: roundingCents, tellAboveCents: roundingCents })
  if (verdict.kind === 'same' && order.totalCents < q!.totalCents) {
    logger.info('Class order a few cents under the quote (half-cent tax rounding) — charging Square’s total', { bookingId, quote: q!.totalCents, square: order.totalCents, lines: roundingCents })
  }
  // Money M1: never more than the Pay button said. Square's total above the shown total → nothing charged.
  if (verdict.kind !== 'refuse' && expectedTotalCents !== null && order.totalCents > expectedTotalCents) {
    logger.error('Square total above what the customer was shown — refusing', { bookingId, orderId: order.orderId, shown: expectedTotalCents, square: order.totalCents })
    await letGo('above the shown total')
    await alertOwners(
      `Class booking refused: Square's total ${dollars(order.totalCents)} was more than the ${dollars(expectedTotalCents)} ${givenName} was shown for ${cls.content.name}. Nothing was charged. Open the class in /admin and tap Update the register.`,
    ).catch(() => undefined)
    return fail(502, 'unavailable', PRICE_MISMATCH_MESSAGE)
  }
  if (verdict.kind === 'refuse') {
    logger.error('Class order total far above the quote — refusing', { bookingId, orderId: order.orderId, quote: q!.totalCents, square: order.totalCents })
    await letGo('price mismatch')
    await alertOwners(
      `Class booking refused, price mismatch: ${cls.content.name}, booking ${bookingId}. Quote ${dollars(q!.totalCents)}, Square ${dollars(order.totalCents)}. Open the class in /admin and tap Update the register. Nothing was charged.`,
    ).catch(() => undefined)
    return fail(502, 'unavailable', PRICE_MISMATCH_MESSAGE)
  }
  if (verdict.kind === 'charge-and-tell') {
    // D4: the POS item still had the early-bird price after it ended (the hourly flip hadn't run yet).
    const posBehind = orderLines.shortCents > 0 && verdict.driftCents < 0
    if (verdict.driftCents > 0) {
      logger.warn('Class order total a little above the quote — charging Square’s total', { bookingId, quote: q!.totalCents, square: order.totalCents })
    } else {
      // Lower is charged as Square says, but the owners hear of it: usually a taxable class on the POS without its tax.
      logger.warn('Class order total below the quote — charging Square’s total', { bookingId, quote: q!.totalCents, square: order.totalCents })
    }
    await tellOwnersOfDrift(
      `Class price differed — ${cls.content.name}`, `booking ${bookingId}`, q!.totalCents, order.totalCents,
      verdict.driftCents > 0 ? '' : posBehind
        ? 'The register still had the early-bird price. It goes back to the regular price within the hour.'
        : 'Check the class tax in /admin › More › Register setup, then tap Update them all there (or open the class and tap Update the register).',
    )
  }
  const charged = order.totalCents

  // ── 4. Charge ───────────────────────────────────────────────────────────────
  const verificationToken = typeof body.verificationToken === 'string' && body.verificationToken.length <= 4000 ? body.verificationToken : undefined
  const result = await chargeOrder({ orderId: order.orderId, amountCents: charged, paymentToken, email, attemptId, ...(verificationToken ? { verificationToken } : {}) })
  if (result.kind === 'declined') {
    if (result.reason === 'failed') {
      logger.error('Class payment failed — releasing seats', { bookingId, paymentId: result.paymentId })
      await letGo('payment failed')
    } else {
      const err = result.error
      logger.error('Class payment refused — releasing seats', { bookingId, codes: result.codes, error: err instanceof Error ? err.message : String(err) })
      await letGo('card declined')
    }
    return fail(402, 'card_declined')
  }
  if (result.kind === 'unknown') return unknownOutcome(cls, order, result.error)
  const payment = result.payment
  if (result.recovered) {
    logger.info('Charge answer was unclear but the order is paid — confirming', { bookingId, orderId: order.orderId })
  }

  // ── Paid. Nothing below may turn this into a failure. ───────────────────────
  const lines = await confirmPaid(cls, { orderId: order.orderId, paymentId: payment.id, chargedCents: charged, lineTotals: order.lineTotals })
  await cancelledMeanwhile(cls, { orderId: order.orderId, paymentId: payment.id, chargedCents: charged })
  return finish({ cls, q: q!, lines, charged, receiptUrl: payment.receiptUrl ?? null, simulated: false, onFile })

  // ── helpers (closures over this request) ────────────────────────────────────

  /**
   * Stage 4, waitlist first: someone waiting fits the free seats and this
   * booking would take one they need → sold out, nothing held or charged, and
   * the waitlist runs (after the reply). At the door "Add over capacity"
   * still seats them. A waitlist we can't read charges nothing (fail closed).
   */
  async function waitlistFirst(c: ScheduledClass, at: Date): Promise<Response | null> {
    if (door && body.overCapacity === true) return null
    let short: string | null
    try {
      short = waitlistGoesFirst(c, await getLedger(c.id), await getWaitlist(c.id), q!.sessionIds, q!.seats, at)
    } catch (err) {
      logger.error('Waitlist unreadable before booking — refusing', { classId: c.id, error: String(err) })
      return fail(502, 'unavailable')
    }
    if (!short) return null
    logger.info('Booking refused: the waitlist goes first', { classId: c.id, bookingId, door })
    const kick = import('@lib/classes/waitlist-runner').then(({ runWaitlist }) => runWaitlist(c.id, { reason: 'booking', origin: new URL(request.url).origin })).catch(() => undefined)
    const netlify = (locals as { netlify?: { context?: { waitUntil?: (p: Promise<unknown>) => void } } } | undefined)?.netlify?.context
    if (typeof netlify?.waitUntil === 'function') netlify.waitUntil(kick)
    else await kick
    return fail(409, 'sold_out', door
      ? 'That seat goes to someone on the waitlist first. Nothing was charged. Ask Catherine or Kaden if they should be seated anyway.'
      : soldOutMessage(c, short, 0))
  }

  function setQuote(c: ScheduledClass, value: Quote) {
    q = value
    holdInput = {
      bookingId, passId, source: door ? 'door-card' : 'online', customer: person, ttlMinutes: HOLD_MINUTES,
      ...(member ? { by: byOf(member) } : {}),
      // At the door the crew may seat someone on a full day on purpose (the same rule as a comp).
      ...(door && body.overCapacity === true ? { allowOverCapacity: true } : {}),
      ...(req.seats ? { seats: req.seats } : {}),
    }
    seatsLabel = seatsLabelFor(c, value.lines.filter((l) => l.kind === 'seat'))
    firstStart = c.sessions.find((s) => s.id === value.sessionIds[0])?.startIso ?? c.sessions[0]?.startIso ?? ''
  }

  /** The order: catalog lines, and the early-bird and code as per-line discounts (S4-R1), so Square's total is the quote's. */
  function createOrder(o: { lines: OrderLine[]; discounts: OrderLineDiscount[] }) {
    return providers.payment.createClassOrder({
      locationId: siteConfig.providers.booking.config.locationId,
      customerId,
      idempotencyKey: attemptKey(attemptId, 'order'),
      lines: o.lines,
      ...(o.discounts.length ? { lineDiscounts: o.discounts } : {}),
      referenceId: bookingId,
    })
  }

  /**
   * Did an earlier try of this attempt pay? The same order key gives back the
   * same order, and Square says whether it is paid. Paid → the seats are
   * recorded (over capacity if need be) and the booked answer returned.
   * null = Square shows no payment; 'unknown' = we couldn't ask.
   */
  async function paidEarlier(c: ScheduledClass, lines: { lines: OrderLine[]; discounts: OrderLineDiscount[] }): Promise<Response | null | 'unknown'> {
    const earlier = await paidOnOrder(() => createOrder(lines))
    if (earlier.kind === 'unknown') {
      logger.error('Could not ask Square whether an earlier try paid', { bookingId, error: String(earlier.error) })
      return 'unknown'
    }
    if (earlier.kind === 'unpaid') return null
    const { payment: found, order } = earlier
    logger.warn('An earlier try of this attempt was paid — recording the seats', { bookingId, orderId: order.orderId })
    const charged = found.amount || order.totalCents
    const confirmed = await confirmPaid(c, { orderId: order.orderId, paymentId: found.id, chargedCents: charged, lineTotals: order.lineTotals })
    await cancelledMeanwhile(c, { orderId: order.orderId, paymentId: found.id, chargedCents: charged })
    return finish({ cls: c, q: q!, lines: confirmed, charged, receiptUrl: found.receiptUrl ?? null, simulated: false, onFile })
  }

  /**
   * I-5: paid and confirmed, but an owner may have cancelled the class between this booking's hold and its
   * charge (the cancel listed who was booked before this seat landed). Read the class again; cancelled →
   * one To decide item (Refund them / It's already sorted) and one owners' text. Never refunds by itself.
   */
  async function cancelledMeanwhile(c: ScheduledClass, square: { orderId: string | null; paymentId: string | null; chargedCents: number }): Promise<void> {
    let fresh: ScheduledClass | null
    try {
      fresh = await getClass(c.id)
    } catch (err) {
      logger.error('Class unreadable after a paid booking (cancel check skipped)', { bookingId, error: String(err) })
      return
    }
    if (fresh && fresh.status !== 'cancelled') return
    logger.error('PAID ONTO A CLASS CANCELLED MEANWHILE', { classId: c.id, bookingId, orderId: square.orderId })
    try {
      const first = await notePaidOnCancelled({
        classId: c.id, className: c.content.name, bookingId, orderId: square.orderId, paymentId: square.paymentId,
        chargedCents: square.chargedCents, customer: person, last4: '', at: new Date().toISOString(),
      })
      if (!first) return
    } catch (err) {
      logger.error('Paid-on-cancelled item not saved — texting the owners anyway', { bookingId, error: String(err) })
    }
    await alertOwners(
      `${who} paid ${dollars(square.chargedCents)} for ${seatsLabel}, ${c.content.name}, just as it was cancelled. Nothing was refunded. Open /admin › To decide › Paid just as the class was cancelled to refund them.`,
    ).catch(() => undefined)
  }

  /** The charge may have gone through: keep the seats a day, tell a person, say we're not sure. */
  async function unknownOutcome(c: ScheduledClass, order: { orderId: string; totalCents: number } | null, err: unknown): Promise<Response> {
    logger.error('CLASS PAYMENT OUTCOME UNKNOWN — seats kept, needs a person', {
      bookingId, attemptId, orderId: order?.orderId ?? null, codes: squareErrorCodes(err), error: err instanceof Error ? err.message : String(err),
    })
    await keepHeld()
    await alertOwners(
      `Class payment unclear: ${who}, ${seatsLabel}, ${c.content.name}, ${formatSlotLabel(firstStart)}. Seats held a day; if Square shows it paid they're booked for you and you get a text. Check Square for a${order ? ` ${dollars(order.totalCents)}` : ''} payment${order ? ` on order ${order.orderId}` : ''}. Booking ${bookingId}, attempt ${attemptId}.`,
    ).catch(() => undefined)
    return fail(502, 'unknown_outcome')
  }

  async function keepHeld() {
    const until = new Date(Date.now() + UNCLEAR_HOLD_HOURS * 3_600_000).toISOString()
    try {
      await extendHold(cls!.id, bookingId, until)
    } catch (err) {
      logger.error('Could not extend the hold on an unclear payment', { bookingId, error: String(err) })
    }
    // R15: the code's use stays with the seats while nobody knows whether they paid.
    if (q?.promo) {
      await extendUse(q.promo.code, bookingId, until).catch((err) => {
        logger.error('Could not keep the code\'s use with an unclear payment', { bookingId, code: q!.promo!.code, error: String(err) })
      })
    }
  }

  /**
   * Reserve the code's use for this booking, as long as its seat hold, before
   * anything is held or charged. Used up → 409 with the sentence; a store
   * that can't be written → 502 (fail closed). null = go on.
   */
  async function holdPromo(at: Date): Promise<Response | null> {
    if (!q?.promo || !promo) return null
    try {
      const r = await reserveUse(q.promo.code, bookingId, new Date(at.getTime() + HOLD_MINUTES * 60_000).toISOString(), at, promo.maxUses)
      if (r === 'used-up') return fail(409, 'promo', `${PROMO_REFUSALS.usedUp} Nothing was charged.`)
      return null
    } catch (err) {
      logger.error('Promo use not reserved — refusing', { bookingId, code: q.promo.code, error: String(err) })
      return fail(502, 'unavailable')
    }
  }

  /** A booking that didn't go through gives its code's use back (it runs out by itself if this fails). */
  async function letGoPromo(why: string) {
    if (!q?.promo) return
    await releaseUse(q.promo.code, bookingId).catch((err) => {
      logger.error('Promo use not released (it runs out by itself)', { bookingId, why, code: q!.promo!.code, error: String(err) })
    })
  }

  /** M6: paid → the hold becomes a use (tried twice; a failure tells the owners: the code could go one over). */
  async function useThePromo(c: ScheduledClass) {
    if (!q?.promo) return
    await countUse(q.promo.code, bookingId, { id: c.id, name: c.content.name })
  }

  /** Paid: confirm the seats. Never fails the booking; a failed write tells a person and keeps the hold. */
  async function confirmPaid(c: ScheduledClass, square: { orderId: string | null; paymentId: string | null; chargedCents: number; lineTotals?: { totalCents: number; taxCents: number }[] }): Promise<LedgerLine[]> {
    try {
      const lines = await confirm(c.id, bookingId, square, { cls: c, quote: q!, input: holdInput! }, new Date())
      await useThePromo(c)
      return lines
    } catch (err) {
      logger.error('PAID CLASS SEATS NOT RECORDED', { bookingId, orderId: square.orderId, error: String(err) })
      // M-g: a free booking has no Square order, so no payment notice will ever count its code. The booking is
      // real, so count the use now (exactly once: confirmUse is keyed by the booking id).
      if (!square.orderId) await useThePromo(c)
      await keepHeld()
      await alertOwners(
        `${simulated ? '(test booking, no action needed) ' : ''}Class paid, seats not recorded yet: ${who}, ${seatsLabel}, ${c.content.name}, ${formatSlotLabel(firstStart)}. Held a day; ${square.orderId ? `Square's payment notice books them, or it shows in /admin › To decide. Order ${square.orderId}` : `Nothing was charged (a free booking). To give them their seats for good: on /staff, open the class › Comp a seat › their name, email and seats › Comp${q!.promo ? ` (code ${q!.promo.code}: its use is already counted)` : ''}. The held seats let go by themselves after a day`}, booking ${bookingId}.`,
      ).catch(() => undefined)
      // Answer from the quote: the customer has paid.
      return q!.lines.filter((l) => l.kind === 'seat').map((l) => ({
        bookingId, ticketTypeId: l.ticketTypeId, sessionIds: q!.sessionIds,
        square: { orderId: square.orderId, paymentId: square.paymentId, lineUid: null, chargedCents: square.chargedCents },
        priceCents: l.cents, taxCents: l.taxCents, addOnCents: 0, addOnTaxCents: 0,
      })) as LedgerLine[]
    }
  }

  async function holdSeats(c: ScheduledClass, at: Date): Promise<Response | null> {
    try {
      const held = await hold(c, q!, holdInput!, at)
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
      // One confirmation and one owners' note per booking (T8, R42): a retry racing the first try,
      // or Square's payment notice, may already have sent them. Whoever claims the marker sends both.
      const mine = await claimConfirmation(bookingId)
      if (!mine) logger.info('Class confirmation already sent for this booking', { bookingId })
      const sendOnce = async (): Promise<boolean> => {
        if (!mine) return true
        const sent = await sendClassConfirmation({
          origin: new URL(request.url).origin,
          bookingId, cls: c, sessionIds: qq.sessionIds, seats: qq.seats, seatsLabel,
          email, givenName, receiptUrl: f.receiptUrl, totalChargedCents: f.charged,
          ...(f.charged === 0 && !f.simulated ? { free: true } : {}),
          ...(pickLines.length ? { pickLines } : {}),
          ...(f.onFile ? { alsoTo: f.onFile } : {}),
        }).catch((err) => {
          logger.error('Class confirmation email failed (booking still confirmed)', { bookingId, error: String(err) })
          return false
        })
        if (!sent) await releaseConfirmation(bookingId)
        return sent
      }
      const [sent] = await Promise.all([
        sendOnce(),
        f.simulated || !mine
          ? Promise.resolve()
          : announceBooking({
              kind: 'class', who: `${givenName} ${familyName}`, what: `${seatsLabel}, ${c.content.name}`,
              when: formatSlotLabel(firstStart), paidCents: f.charged, email, phone,
              ...(pickLines.length || qq.promo || qq.discountCents ? { extra: [...pickLines, ...discountNotes(qq)].join('; ') } : {}),
            }),
        // A door sale on the studio iPad isn't a site conversion.
        door ? Promise.resolve() : reportBooking({
          requestUrl: request.url,
          kind: 'workshop',
          bookingId,
          // M8: what was actually charged (after the early-bird and the code, tax included).
          amountCents: f.charged,
          email, firstName: givenName, lastName: familyName,
          items: c.content.ticketTypes
            .map((t) => ({ t, n: qq.lines.filter((l) => l.kind === 'seat' && l.ticketTypeId === t.id).length }))
            .filter(({ n }) => n > 0)
            .map(({ t, n }) => ({
              item_id: `${c.id}:${passId}:${t.id}`, item_name: `${c.content.name} (${t.label})`, item_category: 'class',
              // Each seat at what it came to after discounts (before tax), not the list price.
              price: Math.round(qq.lines.filter((l) => l.kind === 'seat' && l.ticketTypeId === t.id).reduce((s, l) => s + l.cents, 0) / n) / 100, quantity: n,
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

/** The answer says the same attempt is still running elsewhere. */
async function isInProgress(res: Response): Promise<boolean> {
  return res.status === 409 && (await res.clone().json().catch(() => ({})))?.code === 'in_progress'
}

/** For the owners' text: "Early-bird −$10.00", "Code FALLFRIENDS −$4.50". */
function discountNotes(q: Quote): string[] {
  const by = new Map<string, number>()
  for (const l of q.lines) for (const d of l.discounts) by.set(d.name, (by.get(d.name) ?? 0) + d.cents)
  return [...by].map(([name, cents]) => `${name} −${dollars(cents)}`)
}

/** Review I2: the new total, so the page can show it and let them pay it. Nothing was held or charged. */
function priceChanged(q: Quote, detail: string): Response {
  return new Response(
    JSON.stringify({ error: 'Unable to book class', code: 'price_changed', detail, quote: publicQuote(q) }),
    { status: 409, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
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
        totalChargedCents: extra.chargedCents ?? first.square.chargedCents ?? lines.reduce((s, l) => s + paidCentsOf(l), 0),
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
