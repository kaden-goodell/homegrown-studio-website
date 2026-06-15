import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'
import { providers } from '@config/providers'
import { partyConfig } from '@config/party.config'
import { craftBreakdown, partyTotalCents } from '@lib/party-pricing'

const logger = createLogger('api:party:book')

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
  const people = Math.max(1, Math.floor(body.people ?? 0))
  if (people < 1) {
    return errorResponse('At least one guest is required', 400)
  }
  if (people > partyConfig.maxGuests) {
    return errorResponse(`Bookings are limited to ${partyConfig.maxGuests} guests`, 400)
  }

  const locationId = siteConfig.providers.booking.config.locationId

  try {
    // Step 1: Find or create customer
    const customer = await providers.customer.findOrCreate({
      email: body.customer.email,
      givenName: body.customer.firstName,
      familyName: body.customer.lastName,
      phone: body.customer.phone,
    })

    logger.info('Customer resolved', { customerId: customer.id, email: customer.email })

    // Step 2: Build line items — flat base (never discounted) + per-head craft
    // cost with the tiered volume discount applied via craftBreakdown (one line
    // item per breakdown entry).
    const lineItems = [
      {
        name: 'Whole Studio Party',
        quantity: 1,
        pricePerUnit: partyConfig.basePriceCents,
      },
      ...craftBreakdown(body.craft.name, body.craft.perHeadCents, people).map((line) => ({
        name: line.label,
        quantity: line.qty,
        pricePerUnit: line.unitCents,
      })),
    ]

    // Step 3: Create order
    const order = await providers.payment.createOrder({
      locationId,
      customerId: customer.id,
      lineItems,
    })

    // The order total (base + discounted craft line items) must match the single
    // source of truth used by the client so we never charge a divergent amount.
    const expectedTotal = partyTotalCents(body.craft.perHeadCents, people)
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

    // Step 6: Return success response
    return new Response(
      JSON.stringify({
        data: {
          bookingId: booking.id,
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
