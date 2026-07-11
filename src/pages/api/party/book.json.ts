import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { siteConfig } from '@config/site.config'
import { providers } from '@config/providers'
import { partyConfig } from '@config/party.config'
import { partyContent } from '@config/party-content'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { savePartyRecord, newHostToken, type PartyRecord } from '@lib/party-store'
import { isStartOpen } from '@lib/party-availability'
import { sendPartyConfirmationEmail } from '@lib/email'
import { partyInviteUrl, googleCalendarUrl, buildIcs, addMinutesIso } from '@lib/party-share'
import { inviteContent } from '@config/invite-content'
import { formatSlotLabel } from '@lib/studio-time'
import type { Booking } from '@providers/interfaces/booking'

const logger = createLogger('api:party:book')

/** Build + persist the party record for the host's management view. Returns hostToken or null. */
async function persistParty(bookingId: string, body: BookRequest): Promise<string | null> {
  const hostToken = newHostToken()
  const record: PartyRecord = {
    bookingId,
    hostToken,
    craftName: body.craft?.name ?? 'Craft party',
    startIso: body.startTime,
    durationMinutes: body.durationMinutes ?? null,
    hostName: [body.customer.firstName, body.customer.lastName].filter(Boolean).join(' '),
    hostEmail: body.customer.email,
    guestCount: Math.floor(body.people ?? 0),
    title: null,
    dropOff: false, // host-party default; PNO drop-off events would set true
    createdAt: new Date().toISOString(),
  }
  try {
    await savePartyRecord(record)
    return hostToken
  } catch (err) {
    logger.error('Party record save failed — retrying once', {
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    })
    try {
      await savePartyRecord(record)
      return hostToken
    } catch (err2) {
      logger.error('Party record save failed after retry (booking still succeeded)', {
        bookingId,
        error: err2 instanceof Error ? err2.message : String(err2),
      })
      return null
    }
  }
}

interface BookRequest {
  startTime: string
  serviceVariationId: string
  serviceVariationVersion: number
  durationMinutes: number
  craft: {
    id: string
    name: string
    perHeadCents: number
    /** Upper bound when the craft has a price range — email display only. */
    perHeadMaxCents?: number
    /** Catalog description — rides into the confirmation email only. */
    description?: string
    /** Catalog image — rides into the confirmation email only. */
    imageUrl?: string
  }
  people: number
  customer: {
    firstName: string
    lastName: string
    email: string
    /** Required — the studio's day-of contact channel for the host. */
    phone: string
  }
  paymentToken: string
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`party-book:${clientAddress}`, 5, 60_000)) {
    return errorResponse('Too many booking attempts — give it a minute.', 429)
  }
  let body: BookRequest
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  // --- Validation ---
  if (
    !body.startTime ||
    !body.durationMinutes ||
    !body.serviceVariationId ||
    body.serviceVariationVersion == null
  ) {
    return errorResponse('Missing party time information', 400)
  }
  if (!body.paymentToken) {
    return errorResponse('Missing payment information', 400)
  }
  if (!body.customer?.email || !body.customer?.firstName?.trim() || !body.customer?.lastName?.trim()) {
    return errorResponse('Full name and email are required', 400)
  }
  if ((body.customer?.phone ?? '').replace(/\D/g, '').length < 10) {
    return errorResponse('A phone number is required — it’s how we reach you on party day', 400)
  }
  if (!body.craft?.id || body.craft.perHeadCents == null) {
    return errorResponse('Missing craft selection', 400)
  }
  const people = Math.floor(body.people ?? 0)
  if (people < partyConfig.minGuests) {
    return errorResponse(`Parties are for groups of ${partyConfig.minGuests} or more`, 400)
  }
  if (people > partyConfig.maxGuests) {
    return errorResponse(`Bookings are limited to ${partyConfig.maxGuests} guests`, 400)
  }

  const locationId = siteConfig.providers.booking.config.locationId

  // Craft image for the confirmation email: absolute http(s) only; site-relative
  // paths resolve against this deployment's origin. Anything else is dropped.
  const requestOrigin = new URL(request.url).origin
  const rawImage = String(body.craft.imageUrl ?? '')
  const craftImageUrl = /^https?:\/\//.test(rawImage)
    ? rawImage
    : rawImage.startsWith('/')
      ? `${requestOrigin}${rawImage}`
      : ''

  let bookingIdForLog: string | undefined

  // Dev-only: skip Square entirely and return a synthetic confirmation so the
  // booking flow (and its waiver/invite handoff) can be exercised without a
  // real charge or a live booking. Gated to `astro dev` — never in prod.
  if (paymentBypassEnabled()) {
    logger.info('Payment bypass active — returning synthetic party booking')
    const bookingId = `dev_${Date.now().toString(36)}`
    const hostToken = await persistParty(bookingId, body)
    // Send the real confirmation email too (no-ops without GMAIL_* creds) so
    // the whole flow — including the email — is testable locally. Beware: with
    // creds in .env this sends an ACTUAL email to whatever address you typed.
    const bypassOrigin = new URL(request.url).origin
    const bypassSlotLabel = formatSlotLabel(body.startTime)
    const bypassInviteUrl = partyInviteUrl(
      { bookingId, craftName: body.craft.name, slotLabel: bypassSlotLabel, startIso: body.startTime },
      bypassOrigin,
    )
    // Host's calendar event — token-free details ON PURPOSE: hosts often invite
    // guests via this very calendar event, and the party-page URL is the key to
    // the whole roster. The email itself carries the private link instead.
    const bypassCalEvent = {
      title: `${body.craft.name} — Party at Homegrown Studio`,
      startIso: body.startTime,
      endIso: addMinutesIso(body.startTime, body.durationMinutes),
      details: `Your private party at Homegrown Studio.\n\nInvitation link for guests: ${bypassInviteUrl}`,
      location: inviteContent.where,
    }
    const { sent: bypassEmailSent } = hostToken
      ? await sendPartyConfirmationEmail({
          to: body.customer.email,
          hostName: body.customer.firstName,
          craftName: body.craft.name,
          craftDescription: String(body.craft.description ?? '').slice(0, 2000),
          craftImageUrl,
          perHeadCents: body.craft.perHeadCents,
          perHeadMaxCents: body.craft.perHeadMaxCents,
          slotLabel: bypassSlotLabel,
          hostPageUrl: `${bypassOrigin}/party/${encodeURIComponent(bookingId)}?key=${encodeURIComponent(hostToken)}`,
          inviteUrl: bypassInviteUrl,
          totalChargedCents: partyConfig.basePriceCents,
          receiptUrl: null,
          googleCalendarUrl: googleCalendarUrl(bypassCalEvent),
          icsContent: buildIcs(bypassCalEvent),
          bookingRef: bookingId,
        })
      : { sent: false }
    return new Response(
      JSON.stringify({
        data: {
          bookingId,
          hostToken,
          orderId: `dev_order_${Date.now().toString(36)}`,
          receiptUrl: null,
          totalCharged: partyConfig.basePriceCents,
          emailSent: bypassEmailSent,
          customer: { id: 'dev-customer' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    // Step 1: Re-verify the slot server-side BEFORE any Square write.
    // A race between two browsers choosing the same slot must be caught here.
    try {
      const isOpen = await isStartOpen(body.startTime, body.serviceVariationId)
      if (!isOpen) {
        return errorResponse(
          'That time was just booked by someone else. Your card was not charged — pick another time.',
          409,
        )
      }
    } catch (err) {
      logger.error('Availability re-check failed — proceeding', { error: String(err) })
      // availability lookup failure must not block booking
    }

    // Step 2: Find or create customer
    let customer: Awaited<ReturnType<typeof providers.customer.findOrCreate>>
    try {
      customer = await providers.customer.findOrCreate({
        email: body.customer.email,
        givenName: body.customer.firstName,
        familyName: body.customer.lastName,
        phone: body.customer.phone,
      })
    } catch (err) {
      logger.error('Customer find-or-create failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      return errorResponse(
        "We couldn't start your booking. Your card was not charged — please try again.",
        502,
      )
    }

    logger.info('Customer resolved', { customerId: customer.id })

    // Step 3: Create the single whole-room booking FIRST — before charging.
    // If this fails the customer has not been charged. Craft selection is stored
    // on an existing field (specialRequests) — no new custom-attribute definitions
    // (Square's 10-cap is maxed). orderIdRef is intentionally omitted here; we
    // don't yet have an order ID and we don't want to fail the booking over it.
    let booking: Booking
    try {
      booking = await providers.booking.createBooking({
        slotId: body.startTime,
        customerId: customer.id,
        eventType: 'party',
        guestCount: people,
        // Description deliberately excluded — Square note fields have length
        // caps; the description only rides into the confirmation email.
        specialRequests: JSON.stringify({ craft: { id: body.craft.id, name: body.craft.name, perHeadCents: body.craft.perHeadCents } }),
        teamMemberId: partyConfig.square.defaultTeamMemberId,
        serviceVariationId: body.serviceVariationId,
        serviceVariationVersion: body.serviceVariationVersion,
        durationMinutes: body.durationMinutes,
      })
    } catch (err) {
      logger.error('createBooking failed — slot may be gone', {
        error: err instanceof Error ? err.message : String(err),
      })
      return errorResponse(
        "We couldn't reserve that time. Your card was not charged — please try again.",
        502,
      )
    }

    bookingIdForLog = booking.id
    logger.info('Party booking created', { bookingId: booking.id })

    /** Cancel the booking if payment fails. Non-fatal — logs an orphan warning if cancel also fails. */
    async function releaseBooking(b: { id: string; version?: number }): Promise<void> {
      try {
        await providers.booking.cancelBooking(b.id, b.version ?? 0)
      } catch (err) {
        logger.error('ORPHANED BOOKING — cancel failed after payment failure', {
          bookingId: b.id,
          error: String(err),
        })
      }
    }

    // Step 4: Deposit model — charge ONLY the flat studio fee now. The per-head
    // craft cost is settled in person at the studio based on actual attendance.
    const lineItems = [
      {
        name: 'Whole Studio Party — studio fee',
        quantity: 1,
        pricePerUnit: partyConfig.basePriceCents,
      },
    ]

    let order: Awaited<ReturnType<typeof providers.payment.createOrder>>
    let payment: Awaited<ReturnType<typeof providers.payment.processPayment>>
    try {
      order = await providers.payment.createOrder({
        locationId,
        customerId: customer.id,
        lineItems,
      })

      // Deposit only — guard against charging a divergent amount.
      const expectedTotal = partyConfig.basePriceCents
      if (order.totalAmount !== expectedTotal) {
        logger.error('Party order total mismatch', {
          orderId: order.id,
          orderTotal: order.totalAmount,
          expectedTotal,
        })
        await releaseBooking(booking)
        return errorResponse(
          'Pricing mismatch — your card was not charged and the date was released. Please try again or text us.',
          500,
        )
      }

      logger.info('Order created', { orderId: order.id, totalAmount: order.totalAmount })

      payment = await providers.payment.processPayment({
        orderId: order.id,
        paymentToken: body.paymentToken,
        amount: order.totalAmount,
        currency: 'USD',
        buyerEmailAddress: body.customer.email,
      })
    } catch (err) {
      logger.error('Order/payment failed — releasing booking', {
        bookingId: booking.id,
        error: err instanceof Error ? err.message : String(err),
      })
      await releaseBooking(booking)
      return errorResponse(
        "Payment didn't go through, so we released the date. Your card was not charged — please try again.",
        502,
      )
    }

    logger.info('Payment processed', { paymentId: payment.id, status: payment.status })

    if (payment.status === 'failed') {
      await releaseBooking(booking)
      return errorResponse(
        'Payment was declined, so we released the date. Please try a different card.',
        402,
      )
    }

    // Step 5: Persist party record + send confirmation email.
    const hostToken = await persistParty(booking.id, body)

    const origin = new URL(request.url).origin
    const hostPageUrl = hostToken
      ? `${origin}/party/${encodeURIComponent(booking.id)}?key=${encodeURIComponent(hostToken)}`
      : `${origin}/book`
    const slotLabel = formatSlotLabel(body.startTime)
    const inviteUrl = partyInviteUrl(
      { bookingId: booking.id, craftName: body.craft.name, slotLabel, startIso: body.startTime },
      origin,
    )
    // Host's calendar event — token-free details (the invite link is shareable).
    const calEvent = {
      title: `${body.craft.name} — Party at Homegrown Studio`,
      startIso: body.startTime,
      endIso: addMinutesIso(body.startTime, body.durationMinutes),
      details: `Your private party at Homegrown Studio.\n\nInvitation link for guests: ${inviteUrl}`,
      location: inviteContent.where,
    }

    const { sent: emailSent } = await sendPartyConfirmationEmail({
      to: body.customer.email,
      hostName: body.customer.firstName,
      craftName: body.craft.name,
      craftDescription: String(body.craft.description ?? '').slice(0, 2000),
      craftImageUrl,
      perHeadCents: body.craft.perHeadCents,
      perHeadMaxCents: body.craft.perHeadMaxCents,
      slotLabel,
      hostPageUrl,
      inviteUrl,
      totalChargedCents: order.totalAmount,
      receiptUrl: payment.receiptUrl ?? null,
      googleCalendarUrl: googleCalendarUrl(calEvent),
      icsContent: buildIcs(calEvent),
      bookingRef: booking.id,
    })

    return new Response(
      JSON.stringify({
        data: {
          bookingId: booking.id,
          hostToken,
          orderId: order.id,
          receiptUrl: payment.receiptUrl ?? null,
          totalCharged: order.totalAmount,
          emailSent,
          customer: {
            id: customer.id,
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Party booking failed', { error: msg, ...(bookingIdForLog ? { bookingId: bookingIdForLog } : {}) })
    return errorResponse(
      `Something went wrong finishing your booking. Don't rebook — if you were charged, we'll make it right.${partyContent.textNumber ? ` Text us at ${partyContent.textNumber}.` : ''}`,
      500,
    )
  }
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: 'Unable to complete party booking', detail }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}
