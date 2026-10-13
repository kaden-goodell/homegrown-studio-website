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
import { issueEmailFixTicket, onFileToAskAbout, type EmailFixTicket } from '@lib/email-fix'
import { guestSeatName } from '@lib/guest-seats'
import { taxCents } from '@lib/tax'
import { announceBooking } from '@lib/booking-alert'
import { canBeBooked } from '@lib/workshop-rules'
import { getEventMeta } from '@lib/event-meta'
import { saveSeatChoices } from '@lib/seat-choices'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { cleanAttribution } from '@lib/attribution'
import { reportBooking } from '@lib/posthog-server'
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
/**
 * One payment token per seat, all different (a token pays once). A 1-seat
 * booking may send the older single `paymentToken`. Null when they don't add up.
 */
export function paymentTokensFor(body: any, seats: number): string[] | null {
  const raw: unknown[] = Array.isArray(body?.paymentTokens) ? body.paymentTokens : seats === 1 && body?.paymentToken ? [body.paymentToken] : []
  if (raw.length !== seats) return null
  if (!raw.every((t) => typeof t === 'string' && t.length > 0 && t.length <= 4000)) return null
  if (new Set(raw).size !== seats) return null
  return raw as string[]
}

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  if (!bookingsOpen(request, 'workshops')) return bookingsClosedResponse()
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
  if (!paymentToken && !Array.isArray(body.paymentTokens)) return fail(400, 'invalid')
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
  // The email on their Square record, when the phone matched it and it is a
  // letter or two off what they typed: we can't tell which is the typo.
  let onFile: string | null = null
  let matchedBy: EmailFixTicket['matchedBy'] = 'unknown'
  if (customerLookup.status === 'fulfilled') {
    customerId = customerLookup.value.id
    const found = customerLookup.value as { email?: string; matchedBy?: EmailFixTicket['matchedBy'] }
    matchedBy = found.matchedBy ?? 'unknown'
    onFile = onFileToAskAbout(email, found)
  } else {
    // Not fatal: the booking service keeps its own contact for the customer.
    logger.error('Customer lookup failed — continuing', { error: String(customerLookup.reason) })
  }

  // Square counts one person per class booking, so every seat is its own
  // booking and its own charge: seat 1 in the booker's name, seats 2+ as
  // named guests ("Maxie Gardner (guest 2 of 3)"), shared with staff seats
  // (src/lib/guest-seats.ts). A card token pays once, so the card form sends
  // one token per seat.
  let booked: { bookingId: string; orderId: string | null; status: string; receiptUrl: string | null; totalChargedCents?: number | null }
  let seatsBooked = seats
  const squareBookingIds: string[] = []
  // Which seat numbers were paid (a later one can be declined).
  const paidSeats: number[] = []
  let chargedSum: number | null = 0
  if (simulated) {
    // Simulated payments (local dev, deploy previews): every refusal above has
    // already run. Nothing is held or charged; carry on as a paid booking.
    logger.warn('Payment bypassed (simulated booking)', { workshopId: workshop.id, name: workshop.name, seats })
    booked = { bookingId: `bypass-${attemptId}`, orderId: null, status: 'accepted', receiptUrl: null }
    chargedSum = null
  } else {
    // ── 2. One payment token per seat, all different ─────────────────────────
    const tokens = paymentTokensFor(body, seats)
    if (!tokens) {
      logger.error('Refused: not one distinct payment token per seat', {
        seats,
        tokens: Array.isArray(body.paymentTokens) ? body.paymentTokens.length : body.paymentToken ? 1 : 0,
        distinct: Array.isArray(body.paymentTokens) ? new Set(body.paymentTokens).size : null,
        sourceKind: String(body.sourceKind ?? 'card'),
      })
      return fail(400, 'invalid', seats > 1 && body.sourceKind === 'wallet'
        ? 'Google Pay covers one seat at a time. For more seats, pay with a card. Nothing was charged.'
        // A page loaded before multi-seat checkout went live sends one token
        // for every seat; trying again there would fail the same way.
        : !Array.isArray(body.paymentTokens)
          ? 'This page is out of date. Reload it and book again. Nothing was charged.'
          : 'We couldn’t set up a payment for every seat. Nothing was charged. Please try again.')
    }

    // ── 3. A guest record per extra seat, so Square's roster names each one ──
    const seatCustomer: (string | undefined)[] = [customerId]
    const seatPerson = (seat: number) =>
      seat === 1 ? { givenName, familyName, email } : { givenName, familyName: guestSeatName(familyName, seat, seats), email }
    try {
      // All at once, so a big group takes no longer than two seats.
      seatCustomer.push(...(await Promise.all(Array.from({ length: seats - 1 }, (_, i) => providers.customer.createGuest({
        givenName,
        familyName: guestSeatName(familyName, i + 2, seats),
        note: `Online seat ${i + 2} of ${seats} with ${givenName} ${familyName} <${email}>, ${workshop.name}.`,
      })))).map((c) => c.id))
    } catch (err) {
      logger.error('Could not create a guest customer before booking — refusing', { error: err instanceof Error ? err.message : String(err) })
      return fail(502, 'unavailable')
    }

    // ── 4. Hold every seat (nothing charged) ─────────────────────────────────
    const held = await Promise.allSettled(Array.from({ length: seats }, (_, i) => providers.workshop.reserveSeats({
      scheduleId: String(classScheduleId),
      startAt: String(startAt),
      seats: 1,
      customer: seatPerson(i + 1),
      ...(note && i === 0 ? { note } : {}),
    })))
    const holds: SeatReservation[] = held.flatMap((h) => (h.status === 'fulfilled' ? [h.value] : []))
    // Held, unpaid seats. Square often won't cancel a hold; it expires by itself.
    const letGo = async (bookingIds: string[]) => {
      await Promise.all(bookingIds.map((id) => providers.workshop.releaseSeats(id).catch(() => undefined)))
    }
    const notHeld = held.find((h): h is PromiseRejectedResult => h.status === 'rejected')
    if (notHeld) {
      const seatError = asSeatBookingError(notHeld.reason)
      const raw = seatError?.raw ?? String(notHeld.reason)
      const code = seatError?.kind === 'refused' ? classifyClassBookingError(raw, 'create') : 'unavailable'
      logger.error('Could not hold seats', { held: holds.length, of: seats, code, raw: raw.slice(0, 500) })
      await letGo(holds.map((h) => h.bookingId))
      return fail(code === 'sold_out' || code === 'already_booked' ? 409 : 502, code)
    }

    // ── 5. Charge seat 1 ─────────────────────────────────────────────────────
    try {
      booked = await providers.workshop.payForSeats({
        reservation: holds[0],
        scheduleId: String(classScheduleId),
        paymentToken: tokens[0],
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
        logger.error('Seat payment refused — releasing seats', { bookingId: holds[0].bookingId, code, raw: raw.slice(0, 500) })
        try {
          await providers.workshop.releaseSeats(holds[0].bookingId)
        } catch (releaseErr) {
          logger.error('HELD SEATS NOT RELEASED after a refused payment', {
            bookingId: holds[0].bookingId,
            error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
          })
        }
        await letGo(holds.slice(1).map((h) => h.bookingId))
        return fail(code === 'card_declined' ? 402 : code === 'sold_out' || code === 'already_booked' ? 409 : 502, code)
      }

      // No answer. The charge may have gone through: keep the seats, tell a person.
      logger.error('SEAT PAYMENT OUTCOME UNKNOWN — seats kept, needs a person', {
        bookingId: holds[0].bookingId,
        attemptId,
        raw: raw.slice(0, 500),
      })
      await alertOwners(
        `Workshop payment unclear: ${givenName} ${familyName} (${email}${phone ? `, ${phone}` : ''}), ${seats} seat${seats === 1 ? '' : 's'}, ${formatSlotLabel(String(startAt))}.${note ? ` Picks: ${note}.` : ''} Check Square for the payment, then confirm with them or cancel booking ${holds[0].bookingId}.`,
      ).catch(() => undefined)
      return fail(502, 'unknown_outcome')
    }
    squareBookingIds.push(booked.bookingId)
    paidSeats.push(1)
    chargedSum = typeof booked.totalChargedCents === 'number' ? booked.totalChargedCents : null

    // ── 6. Charge seats 2+, all at once ──────────────────────────────────────
    // Seat 1 is paid, so the booking stands whatever happens here. A seat that
    // is declined is let go (never charged); one with no answer is kept for a
    // person to check. The owners are told either way.
    const rest = await Promise.allSettled(holds.slice(1).map((hold, i) => providers.workshop.payForSeats({
      reservation: hold,
      scheduleId: String(classScheduleId),
      paymentToken: tokens[i + 1],
      idempotencyKey: attemptKey(attemptId, `pay-${i + 2}`),
      fallbackCustomerId: seatCustomer[i + 1],
    })))
    const declined: number[] = []
    const unclear: number[] = []
    rest.forEach((r, i) => {
      const seat = i + 2
      if (r.status === 'fulfilled') {
        paidSeats.push(seat)
        squareBookingIds.push(r.value.bookingId)
        chargedSum = chargedSum !== null && typeof r.value.totalChargedCents === 'number' ? chargedSum + r.value.totalChargedCents : null
        return
      }
      const seatError = asSeatBookingError(r.reason)
      const raw = seatError?.raw ?? String(r.reason)
      ;(seatError?.kind === 'refused' ? declined : unclear).push(seat)
      logger.error('Extra seat not paid — the booking keeps the seats that were', { bookingId: booked.bookingId, seat, of: seats, kind: seatError?.kind ?? 'unknown', raw: raw.slice(0, 500) })
    })
    seatsBooked = paidSeats.length
    if (declined.length > 0 || unclear.length > 0) {
      await letGo(declined.map((seat) => holds[seat - 1].bookingId))
      const who = `${givenName} ${familyName} (${email}${phone ? `, ${phone}` : ''})`
      const list = (xs: number[]) => xs.join(', ')
      await alertOwners(
        `Partly booked: ${who} asked for ${seats} seats in ${workshop.name}, ${formatSlotLabel(workshop.startAt)}. ${seatsBooked} paid and booked.` +
          (declined.length ? ` Seat${declined.length === 1 ? '' : 's'} ${list(declined)} declined: not booked, not charged.` : '') +
          (unclear.length ? ` Seat${unclear.length === 1 ? '' : 's'} ${list(unclear)}: payment unclear. Check Square (booking${unclear.length === 1 ? '' : 's'} ${unclear.map((seat) => holds[seat - 1].bookingId).join(', ')}).` : '') +
          ' They were told on screen.',
      ).catch(() => undefined)
    }
  }

  // ── Paid and confirmed. Nothing below may turn this into a failure. ────────
  // Only the seats actually paid for (a later seat can be declined).
  const paidPicks = simulated || paidSeats.length === seats
    ? picks
    : picks.filter((p) => paidSeats.includes(p.seat)).map((p) => ({ ...p, seat: paidSeats.indexOf(p.seat) + 1 }))
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
        seats: seatsBooked,
        picks: paidPicks,
        at: new Date().toISOString(),
        attemptId,
        ...(simulated ? { simulated: true as const } : {}),
        ...(squareBookingIds.length > 1 ? { squareBookingIds } : {}),
        ...(cleanAttribution(body.attribution) ? { attribution: cleanAttribution(body.attribution)! } : {}),
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
  // What the card paid, tax included: Square's figure when it gives one.
  const chargedCents = chargedSum !== null
    ? chargedSum
    : workshop.priceCents * seatsBooked + taxCents(workshop.priceCents * seatsBooked, workshop.taxPercent)
  // ── The email, the owners' text and analytics: all at once, and on Netlify
  // after the reply, so the customer sees "You're booked" as soon as the money
  // and the record are in. A confirmation that fails to send then texts the
  // owners, since the booked screen has already said it is on its way.
  const paidBooking = booked
  const finishing = async (): Promise<boolean> => {
    const [sent] = await Promise.all([
      sendWorkshopConfirmation({
        origin: new URL(request.url).origin,
        bookingId: paidBooking.bookingId,
        workshop,
        seats: seatsBooked,
        email,
        givenName,
        receiptUrl: paidBooking.receiptUrl,
        options: settings.options,
        picks: paidPicks,
        totalChargedCents: chargedCents,
        ...(onFile ? { alsoTo: onFile } : {}),
      }).catch((err) => {
        logger.error('Workshop confirmation email failed (booking still confirmed)', {
          bookingId: paidBooking.bookingId,
          error: err instanceof Error ? err.message : String(err),
        })
        return false
      }),
      simulated
        ? Promise.resolve()
        : announceBooking({
            kind: 'class',
            who: `${givenName} ${familyName}`,
            what: `${seatsBooked} seat${seatsBooked === 1 ? '' : 's'}, ${workshop.name}`,
            when: formatSlotLabel(workshop.startAt),
            paidCents: chargedCents,
            email,
            ...(phone ? { phone } : {}),
            ...(note ? { extra: note } : {}),
          }),
      reportBooking({
        requestUrl: request.url,
        kind: 'workshop',
        bookingId: paidBooking.bookingId,
        amountCents: workshop.priceCents * seatsBooked,
        email,
        firstName: givenName,
        lastName: familyName,
        items: [{ item_id: workshop.scheduleId, item_name: workshop.name, item_category: 'workshop', price: workshop.priceCents / 100, quantity: seatsBooked }],
        attribution: cleanAttribution(body.attribution),
        posthogId: body.posthogId,
        simulated,
        extra: {
          seats: seatsBooked,
          class: workshop.name,
          class_date: workshop.startAt.slice(0, 10),
          days_ahead: Math.round((Date.parse(workshop.startAt) - Date.now()) / 86_400_000),
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
      if (sent || simulated) return
      await alertOwners(
        `Confirmation email didn't send: ${givenName} ${familyName} <${email}>, ${seatsBooked} seat${seatsBooked === 1 ? '' : 's'}, ${workshop.name}, ${formatSlotLabel(workshop.startAt)}. The booking is paid (${paidBooking.bookingId}); please send them the details.`,
      ).catch(() => undefined)
    }).catch(() => undefined))
    emailSent = true
  } else {
    // Local dev and tests: no Netlify context, so finish before replying.
    emailSent = await finishing()
  }

  return new Response(
    JSON.stringify({
      data: {
        bookingId: booked.bookingId,
        orderId: booked.orderId,
        status: booked.status,
        receiptUrl: booked.receiptUrl,
        totalChargedCents: chargedCents,
        seatsBooked,
        seatsRequested: seats,
        emailSent,
        // "Wrong email? Fix it" / "Which email is right?" on the booked screen.
        emailCheck: {
          token: issueEmailFixTicket({ kind: 'workshop', bookingId: booked.bookingId, customerId: simulated ? '' : customerId ?? '', typed: email, onFile, matchedBy, eventId: workshop.scheduleId }),
          sentTo: email,
          onFile,
        },
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
