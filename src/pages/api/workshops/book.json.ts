import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { bookingsOpen, bookingsClosedResponse } from '@lib/bookings-gate'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { providers } from '@config/providers'
import { MAX_SEATS_PER_BOOKING } from '@config/class-booking.config'
import { asSeatBookingError } from '@lib/errors'
import { attemptKey, classifyClassBookingError, isAttemptId, type CheckoutErrorCode } from '@lib/checkout-attempt'
import { workshopMessages, TEXT_US } from '@lib/checkout-messages'
import { alertOwners } from '@lib/owner-alert'
import { formatSlotLabel } from '@lib/studio-time'
import { sendWorkshopConfirmation } from '@lib/workshop-confirmation'
import { canBeBooked } from '@lib/workshop-rules'
import { getEventMeta } from '@lib/event-meta'
import { saveSeatChoices } from '@lib/seat-choices'
import { paymentBypassEnabled } from '@lib/dev-flags'
import {
  cutoffClosedMessage,
  effectiveCutoffHours,
  isSignupClosed,
  picksNote,
  validatePicks,
  type CutoffSettings,
  type SeatPick,
} from '@lib/seat-options'
import type { SeatReservation, Workshop } from '@providers/interfaces/workshop'

const logger = createLogger('api:workshops:book')
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Book and pay for workshop seats.
 *
 *   1. look the workshop up, and find or create the customer
 *      (a workshop with no price is not for sale and is refused here)
 *   1b. refuse after the class's sign-up cutoff, and unless every seat has a valid pick (nothing held yet)
 *   2. hold the seats            (nothing charged)
 *   3. charge and confirm        (one step: both happen or neither)
 *   4. send our confirmation email
 *
 * Every failure ends in one of three honest answers (see checkout-attempt.ts):
 * known not charged, charged, or unknown. If the charge is refused, the held
 * seats are let go so the customer's own failed try can't make the class look
 * full. If the charge gets no answer, the seats stay held and the owners are
 * told, because the customer may have paid.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!bookingsOpen(request)) return bookingsClosedResponse()
  if (rateLimited(`workshop-book:${clientAddress}`, 5, 60_000)) {
    return fail(429, 'unavailable', 'That’s a lot of attempts in a row. Give it a minute, then try again.')
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid')
  }

  const { classScheduleId, startAt, customer, paymentToken, verificationToken } = body ?? {}
  if (!classScheduleId || !startAt || Number.isNaN(Date.parse(String(startAt)))) return fail(400, 'invalid')
  if (!paymentToken) return fail(400, 'invalid')
  if (body.sourceKind === 'gift_card') {
    return fail(400, 'invalid', `Gift cards can’t be used for class seats — ${TEXT_US} and we’ll add you.`)
  }

  const givenName = String(customer?.givenName ?? '').trim()
  const familyName = String(customer?.familyName ?? '').trim()
  const email = String(customer?.email ?? '').trim()
  const phone = String(customer?.phone ?? '').trim()
  if (!givenName || !familyName) return fail(400, 'invalid', 'Add your first and last name.')
  if (!EMAIL_RE.test(email)) return fail(400, 'invalid', 'That email doesn’t look right. Check for typos.')

  const seats = Number(body.seats ?? 1)
  if (!Number.isInteger(seats) || seats < 1) return fail(400, 'invalid')
  if (seats > MAX_SEATS_PER_BOOKING) {
    return fail(400, 'invalid', `One booking can hold up to ${MAX_SEATS_PER_BOOKING} seats. For a bigger group, book a private party.`)
  }

  // Older cached pages may not send one; then every request is its own attempt.
  const attemptId = isAttemptId(body.attemptId) ? body.attemptId : randomUUID()

  // Simulated payments (local dev and Netlify previews only): no real customer is created in Square.
  const simulated = paymentBypassEnabled(request)

  // ── 1. The workshop, the customer and the class's settings, looked up together
  const [workshopLookup, customerLookup, metaLookup] = await Promise.allSettled([
    lookUp(typeof body.workshopId === 'string' ? body.workshopId : '', String(classScheduleId), String(startAt)),
    simulated
      ? Promise.resolve({ id: 'dev-customer' })
      : providers.customer.findOrCreate({ email, givenName, familyName, ...(phone ? { phone } : {}) }),
    getEventMeta('workshop', String(classScheduleId)),
  ])

  // The workshop must be one we can see, with a price. If we can't tell, we
  // don't sell: nothing has been held or charged at this point.
  if (workshopLookup.status === 'rejected' || !workshopLookup.value) {
    logger.error('Workshop not found before booking — refusing', {
      scheduleId: String(classScheduleId),
      startAt: String(startAt),
      ...(workshopLookup.status === 'rejected' ? { error: String(workshopLookup.reason) } : {}),
    })
    return fail(502, 'unavailable')
  }
  const workshop = workshopLookup.value
  if (!canBeBooked(workshop.priceCents)) {
    logger.error('Refused a booking for a workshop with no price', { workshopId: workshop.id, name: workshop.name })
    return fail(409, 'not_open')
  }

  // ── 1b. Sign-up cutoff and seat picks (spec C) ─────────────────────────────
  // Settings we can't read are a refusal: a class with questions must never be
  // sold without its picks. Nothing has been held or charged yet.
  if (metaLookup.status === 'rejected') {
    logger.error('Event settings unreadable before booking — refusing', {
      scheduleId: String(classScheduleId),
      error: String(metaLookup.reason),
    })
    return fail(502, 'unavailable')
  }
  const settings: CutoffSettings = {
    options: metaLookup.value?.options ?? [],
    signupCutoffHours: metaLookup.value?.signupCutoffHours ?? null,
  }
  if (isSignupClosed(workshop.startAt, settings)) {
    return fail(409, 'not_open', cutoffClosedMessage(effectiveCutoffHours(settings)))
  }
  const picksCheck = validatePicks(settings.options, seats, body.picks)
  if (!picksCheck.ok) return fail(400, 'invalid', picksCheck.error)
  const picks: SeatPick[] = picksCheck.value
  // Square keeps the picks only as a booking note ("Pumpkin color: Lavender ×2").
  const note = picksNote(settings.options, picks)

  let customerId: string | undefined
  if (customerLookup.status === 'fulfilled') {
    customerId = customerLookup.value.id
  } else {
    // Not fatal: the booking service keeps its own contact for the customer.
    logger.error('Customer lookup failed — continuing', { error: String(customerLookup.reason) })
  }

  let booked: { bookingId: string; orderId: string | null; status: string; receiptUrl: string | null }
  if (simulated) {
    // Simulated payments (local dev, deploy previews): every refusal above has
    // already run. Nothing is held or charged; carry on as a paid booking.
    logger.warn('Payment bypassed (simulated booking)', { workshopId: workshop.id, name: workshop.name, seats })
    booked = { bookingId: `bypass-${attemptId}`, orderId: null, status: 'accepted', receiptUrl: null }
  } else {
    // ── 2. Hold the seats ─────────────────────────────────────────────────────
    let reservation: SeatReservation
    try {
      reservation = await providers.workshop.reserveSeats({
        scheduleId: String(classScheduleId),
        startAt: String(startAt),
        seats,
        customer: { givenName, familyName, email },
        ...(note ? { note } : {}),
      })
    } catch (err) {
      const seatError = asSeatBookingError(err)
      const raw = seatError?.raw ?? String(err)
      const code = seatError?.kind === 'refused' ? classifyClassBookingError(raw, 'create') : 'unavailable'
      logger.error('Could not hold seats', { code, raw: raw.slice(0, 500) })
      return fail(code === 'sold_out' || code === 'already_booked' ? 409 : 502, code)
    }

    // ── 3. Charge and confirm ─────────────────────────────────────────────────
      try {
      booked = await providers.workshop.payForSeats({
        reservation,
        scheduleId: String(classScheduleId),
        paymentToken: String(paymentToken),
        verificationToken: verificationToken ? String(verificationToken) : undefined,
        idempotencyKey: attemptKey(attemptId, 'pay'),
        fallbackCustomerId: customerId,
      })
    } catch (err) {
      const seatError = asSeatBookingError(err)
      const refused = seatError?.kind === 'refused'
      const raw = seatError?.raw ?? String(err)

      if (refused) {
        // The service said no, so nothing was charged. Let the seats go.
        const code = classifyClassBookingError(raw, 'complete')
        logger.error('Seat payment refused — releasing seats', { bookingId: reservation.bookingId, code, raw: raw.slice(0, 500) })
        try {
          await providers.workshop.releaseSeats(reservation.bookingId)
        } catch (releaseErr) {
          logger.error('HELD SEATS NOT RELEASED after a refused payment', {
            bookingId: reservation.bookingId,
            error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
          })
        }
        return fail(code === 'card_declined' ? 402 : code === 'sold_out' || code === 'already_booked' ? 409 : 502, code)
      }

      // No answer. The charge may have gone through: keep the seats, tell a person.
      logger.error('SEAT PAYMENT OUTCOME UNKNOWN — seats kept, needs a person', {
        bookingId: reservation.bookingId,
        attemptId,
        raw: raw.slice(0, 500),
      })
      await alertOwners(
        `Workshop payment unclear: ${givenName} ${familyName} (${email}${phone ? `, ${phone}` : ''}), ${seats} seat${seats === 1 ? '' : 's'}, ${formatSlotLabel(String(startAt))}.${note ? ` Picks: ${note}.` : ''} Check Square for the payment, then confirm with them or cancel booking ${reservation.bookingId}.`,
      ).catch(() => undefined)
      return fail(502, 'unknown_outcome')
    }
  }

  // ── Paid and confirmed. Nothing below may turn this into a failure. ────────
  // The structured picks behind the roster (spec C/D). Written only now, once
  // the money is taken. A failed write never fails the booking: the picks are
  // in the customer's email and in the owner alert (Square's booking note may
  // have been dropped on a retry), so a person can add them by hand.
  // Every paid booking gets a record (picks or not): the roster compares a
  // family's seats with who they check as crafting.
  {
    try {
      await saveSeatChoices({
        eventKind: 'workshop',
        eventId: workshop.scheduleId,
        bookingId: booked.bookingId,
        orderId: booked.orderId,
        customer: { givenName, familyName, email, phone },
        seats,
        picks,
        at: new Date().toISOString(),
        attemptId,
        ...(simulated ? { simulated: true as const } : {}),
      })
    } catch (err) {
      logger.error('SEAT PICKS NOT SAVED (booking is paid)', {
        bookingId: booked.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
      if (picks.length > 0) await alertOwners(
        `${simulated ? '(test booking, no action needed) ' : ''}Seat picks not saved: ${givenName} ${familyName}, ${workshop.name}, ${formatSlotLabel(workshop.startAt)}. ${note}. Booking ${booked.bookingId} is ${simulated ? 'simulated' : 'paid'}; ${simulated ? 'ignore this' : 'add these picks by hand'}.`,
      ).catch(() => undefined)
    }
  }
  let emailSent = false
  try {
    emailSent = await sendWorkshopConfirmation({
      origin: new URL(request.url).origin,
      bookingId: booked.bookingId,
      workshop,
      seats,
      email,
      givenName,
      receiptUrl: booked.receiptUrl,
      options: settings.options,
      picks,
      totalChargedCents: workshop.priceCents * seats,
    })
  } catch (err) {
    logger.error('Workshop confirmation email failed (booking still confirmed)', {
      bookingId: booked.bookingId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return new Response(
    JSON.stringify({
      data: {
        bookingId: booked.bookingId,
        orderId: booked.orderId,
        status: booked.status,
        receiptUrl: booked.receiptUrl,
        emailSent,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}

async function lookUp(workshopId: string, scheduleId: string, startAt: string): Promise<Workshop | null> {
  const find = async () => {
    if (workshopId) {
      const byId = await providers.workshop.getWorkshop(workshopId)
      if (byId && byId.scheduleId === scheduleId) return byId
    }
    const t = new Date(startAt).getTime()
    const all = await providers.workshop.listWorkshops()
    return all.find((w) => w.scheduleId === scheduleId && new Date(w.startAt).getTime() === t) ?? null
  }
  // Runs before anything is held or charged. A lookup that hangs is a refusal, not a wait.
  return Promise.race([find(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))])
}

/** A plain sentence for the customer, plus a code the booking panel can act on. */
function fail(status: number, code: CheckoutErrorCode, detail?: string) {
  return new Response(
    JSON.stringify({ error: 'Unable to book workshop', code, detail: detail ?? workshopMessages[code] }),
    { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
  )
}
