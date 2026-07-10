import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'
import { providers } from '@config/providers'
import { partyConfig } from '@config/party.config'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { savePartyRecord, newHostToken, type PartyRecord } from '@lib/party-store'

const logger = createLogger('api:party:book')

/** Build + persist the party record for the host's management view. Best-effort. */
async function persistParty(bookingId: string, body: BookRequest): Promise<string> {
  const hostToken = newHostToken()
  const record: PartyRecord = {
    bookingId,
    hostToken,
    craftName: body.craft?.name ?? 'Craft party',
    startIso: body.startTime,
    durationMinutes: body.durationMinutes ?? null,
    hostName: `${body.customer.firstName} ${body.customer.lastName}`.trim(),
    hostEmail: body.customer.email,
    guestCount: Math.floor(body.people ?? 0),
    title: null,
    dropOff: false, // birthday-style default; drop-off events (PNO) set true
    createdAt: new Date().toISOString(),
  }
  try {
    await savePartyRecord(record)
  } catch (err) {
    logger.error('Party record save failed (booking still succeeded)', {
      bookingId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return hostToken
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
  }
  people: number
  customer: {
    firstName: string
    lastName: string
    email: string
    phone: string
  }
  paymentToken: string
}

export const POST: APIRoute = async ({ request }) => {
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
    !body.serviceVariationVersion
  ) {
    return errorResponse('Missing party time information', 400)
  }
  if (!body.paymentToken) {
    return errorResponse('Missing payment information', 400)
  }
  if (!body.customer?.email || !body.customer?.firstName || !body.customer?.lastName) {
    return errorResponse('Name and email are required', 400)
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

  // Dev-only: skip Square entirely and return a synthetic confirmation so the
  // booking flow (and its waiver/invite handoff) can be exercised without a
  // real charge or a live booking. Gated to `astro dev` — never in prod.
  if (paymentBypassEnabled()) {
    logger.info('Payment bypass active — returning synthetic party booking')
    const bookingId = `dev_${Date.now().toString(36)}`
    const hostToken = await persistParty(bookingId, body)
    return new Response(
      JSON.stringify({
        data: {
          bookingId,
          hostToken,
          orderId: `dev_order_${Date.now().toString(36)}`,
          receiptUrl: null,
          totalCharged: partyConfig.basePriceCents,
          customer: { id: 'dev-customer' },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    // Step 1: Find or create customer
    const customer = await providers.customer.findOrCreate({
      email: body.customer.email,
      givenName: body.customer.firstName,
      familyName: body.customer.lastName,
      phone: body.customer.phone,
    })

    logger.info('Customer resolved', { customerId: customer.id, email: customer.email })

    // Step 2: Deposit model — charge ONLY the flat studio fee now. The per-head
    // craft cost is settled in person at the studio based on actual attendance,
    // so it's recorded on the booking (Step 5) but never charged here.
    const lineItems = [
      {
        name: 'Whole Studio Party — studio fee',
        quantity: 1,
        pricePerUnit: partyConfig.basePriceCents,
      },
    ]

    // Step 3: Create order
    const order = await providers.payment.createOrder({
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
      return errorResponse('Pricing mismatch. Your card was not charged.', 500)
    }

    logger.info('Order created', { orderId: order.id, totalAmount: order.totalAmount })

    // Step 4: Process payment
    const payment = await providers.payment.processPayment({
      orderId: order.id,
      paymentToken: body.paymentToken,
      amount: order.totalAmount,
      currency: 'USD',
      buyerEmailAddress: body.customer.email,
    })

    logger.info('Payment processed', { paymentId: payment.id, status: payment.status })

    if (payment.status === 'failed') {
      return errorResponse('Payment was declined. Please try a different card.', 402)
    }

    // Step 5: Create the single whole-room booking.
    // Craft selection is stored on an existing field (specialRequests) — no new
    // custom-attribute definitions (Square's 10-cap is maxed).
    const booking = await providers.booking.createBooking({
      slotId: body.startTime,
      customerId: customer.id,
      eventType: 'party',
      guestCount: people,
      specialRequests: JSON.stringify({ craft: body.craft }),
      orderIdRef: order.id,
      teamMemberId: partyConfig.square.defaultTeamMemberId,
      serviceVariationId: body.serviceVariationId,
      serviceVariationVersion: body.serviceVariationVersion,
      durationMinutes: body.durationMinutes,
    })

    logger.info('Party booking created', { bookingId: booking.id })

    // Persist party metadata + host token for the host's management view.
    const hostToken = await persistParty(booking.id, body)

    // Step 6: Return success response
    return new Response(
      JSON.stringify({
        data: {
          bookingId: booking.id,
          hostToken,
          orderId: order.id,
          receiptUrl: payment.receiptUrl ?? null,
          totalCharged: order.totalAmount,
          customer: {
            id: customer.id,
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Party booking failed', { error: msg })
    return errorResponse(
      'An unexpected error occurred. Your card was not charged.',
      500
    )
  }
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: 'Unable to complete party booking', detail }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
