import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'
import { providers } from '@config/providers'
import { reservationConfig } from '@config/reservation.config'

const logger = createLogger('api:reservations:book')

interface BookRequest {
  startTime: string
  durationMinutes: number
  tableCount: number
  wholeStudio: boolean
  partyTable: boolean
  dedicatedHost: boolean
  depositPerTableCents: number
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
  if (!body.startTime || !body.durationMinutes) {
    return errorResponse('Missing reservation time information', 400)
  }
  if (!body.paymentToken) {
    return errorResponse('Missing payment information', 400)
  }
  if (!body.customer?.email || !body.customer?.firstName || !body.customer?.lastName) {
    return errorResponse('Name and email are required', 400)
  }
  if (!body.depositPerTableCents || body.depositPerTableCents <= 0) {
    return errorResponse('Missing deposit price', 400)
  }

  const tableCount = body.wholeStudio ? 6 : Math.max(1, Math.min(body.tableCount ?? 1, 6))
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

    // Step 2: Build line items
    const lineItems = []
    const totalTableDeposit = body.depositPerTableCents * tableCount

    if (body.wholeStudio) {
      lineItems.push({
        name: 'Whole Studio Reservation',
        quantity: 1,
        pricePerUnit: totalTableDeposit,
      })
    } else {
      lineItems.push({
        name: 'Table Reservation',
        quantity: tableCount,
        pricePerUnit: body.depositPerTableCents,
      })
    }

    if (body.partyTable) {
      lineItems.push({
        name: 'Party Table Add-On',
        quantity: 1,
        pricePerUnit: 5000, // $50
      })
    }

    if (body.dedicatedHost) {
      lineItems.push({
        name: 'Dedicated Host Add-On',
        quantity: 1,
        pricePerUnit: 10000, // $100
      })
    }

    // Step 3: Create order
    const order = await providers.payment.createOrder({
      locationId,
      customerId: customer.id,
      lineItems,
    })

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

    // Step 5: Create bookings (one per table)
    const addOns: string[] = []
    if (body.partyTable) addOns.push('party_table')
    if (body.dedicatedHost) addOns.push('dedicated_host')

    const eventType = body.wholeStudio ? 'whole_studio' : 'table_reservation'
    const bookingIds: string[] = []

    for (let i = 0; i < tableCount; i++) {
      const booking = await providers.booking.createBooking({
        slotId: body.startTime,
        customerId: customer.id,
        eventType,
        addOns: i === 0 ? addOns : [], // only set add-ons on first booking
        orderIdRef: order.id,
      })
      bookingIds.push(booking.id)
    }

    logger.info('Bookings created', { bookingIds, tableCount })

    // Step 6: Create gift card with craft credit
    let giftCardId: string | undefined
    let craftCreditCents = 0

    if (body.wholeStudio) {
      craftCreditCents = reservationConfig.wholeStudioCraftCreditCents
    } else {
      craftCreditCents = Math.round(
        totalTableDeposit * reservationConfig.tableCraftCreditPercent / 100
      )
    }

    if (craftCreditCents > 0 && providers.giftcard) {
      try {
        const giftCard = await providers.giftcard.createAndLink({
          amountCents: craftCreditCents,
          customerId: customer.id,
          locationId,
        })

        giftCardId = giftCard.id
        logger.info('Gift card created', { giftCardId, craftCreditCents })

        // Store gift card ID on the first booking
        if (providers.booking.setCustomAttribute) {
          await providers.booking.setCustomAttribute(bookingIds[0], 'gift_card_id', giftCardId)
          logger.info('Gift card ID stored on booking', { bookingId: bookingIds[0], giftCardId })
        }
      } catch (err) {
        // Gift card creation is non-critical — log but don't fail the booking
        logger.error('Gift card creation failed (booking still valid)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Step 7: Return success response
    return new Response(
      JSON.stringify({
        data: {
          bookingIds,
          orderId: order.id,
          paymentId: payment.id,
          receiptUrl: payment.receiptUrl ?? null,
          giftCardId: giftCardId ?? null,
          craftCreditCents,
          totalCharged: order.totalAmount,
          customer: {
            id: customer.id,
            name: `${customer.givenName} ${customer.familyName}`,
            email: customer.email,
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
    logger.error('Reservation booking failed', { error: msg })
    return errorResponse(
      'An unexpected error occurred. Your card was not charged.',
      500
    )
  }
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: 'Unable to complete reservation', detail }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
