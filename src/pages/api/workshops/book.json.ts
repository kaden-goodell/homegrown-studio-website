import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { siteConfig } from '@config/site.config'

const CLASSES_API_BASE = 'https://app.squareup.com/appointments/api/buyer/classes'

/**
 * Workshop booking via Square's buyer-facing classes API.
 *
 * Flow:
 * 1. Resolve/create customer
 * 2. Create pending class booking (reserves seat)
 * 3. Complete booking with payment token (charges + confirms atomically)
 */
export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:workshops:book')

  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  const { classScheduleId, startAt, customer, seats, paymentToken, verificationToken } = body

  if (!classScheduleId || !startAt) {
    return errorResponse('Missing class information', 400)
  }
  if (!paymentToken) {
    return errorResponse('Missing payment information', 400)
  }
  if (!customer?.email || !customer?.givenName) {
    return errorResponse('Name and email are required', 400)
  }

  const seatCount = Math.max(1, Math.min(seats ?? 1, 20))
  const locationId = siteConfig.providers.booking.config.locationId
  const config = siteConfig.providers.booking.config as import('@config/site.config').SquareConfig

  try {
    // Step 1: Resolve customer
    const { createSquareClient } = await import('@providers/square/client')
    const client = createSquareClient(config)

    let customerId: string
    const searchRes = await client.customers.search({
      query: { filter: { emailAddress: { exact: customer.email } } },
    })
    const existing = (searchRes as any).customers ?? []
    if (existing.length > 0) {
      customerId = existing[0].id
    } else {
      const res = await client.customers.create({
        givenName: customer.givenName,
        familyName: customer.familyName,
        emailAddress: customer.email,
      })
      customerId = ((res as any).customer ?? res).id
    }

    logger.info('Customer resolved', { customerId, email: customer.email })

    // Step 2: Create booking
    const createRes = await fetch(
      `${CLASSES_API_BASE}/class_bookings?unit_token=${locationId}`,
      {
        method: 'POST',
        headers: buyerHeaders(),
        body: JSON.stringify({
          class_schedule_id: classScheduleId,
          start_at: startAt,
          customer: {
            given_name: customer.givenName,
            family_name: customer.familyName,
            email_address: customer.email,
          },
          quantity: seatCount,
        }),
      },
    )

    if (!createRes.ok) {
      const text = await createRes.text()
      logger.error('Booking creation failed', { status: createRes.status, error: text })
      return errorResponse(`Booking failed: ${text}`, createRes.status)
    }

    const createData = await createRes.json()
    const classBooking = createData.class_booking
    const bookingId = classBooking.id

    // The contact_token from the booking response is what /complete expects as customer_id
    // This is different from the Customers API ID
    const contactToken = classBooking.customer?.contact_token ?? classBooking.contact_token

    logger.info('Booking created', {
      bookingId,
      orderId: classBooking.order_id,
      contactToken,
      customerId,
      customerObj: JSON.stringify(classBooking.customer),
    })

    // Step 3: Complete with payment
    const completeBody: any = {
      class_booking: {
        id: bookingId,
        class_schedule_id: classScheduleId,
        customer_id: contactToken || customerId,
      },
      payment_source_id: paymentToken,
      idempotency_key: crypto.randomUUID(),
    }
    if (verificationToken) {
      completeBody.verification_token = verificationToken
    }

    logger.info('Calling /complete', {
      bookingId,
      customerIdUsed: contactToken || customerId,
      paymentTokenPrefix: paymentToken?.substring(0, 20),
      hasVerificationToken: !!verificationToken,
      completeBody: JSON.stringify(completeBody),
    })

    const completeRes = await fetch(
      `${CLASSES_API_BASE}/class_bookings/${bookingId}/complete?unit_token=${locationId}`,
      {
        method: 'POST',
        headers: buyerHeaders(),
        body: JSON.stringify(completeBody),
      },
    )

    if (!completeRes.ok) {
      const text = await completeRes.text()
      logger.error('Completion failed', { bookingId, status: completeRes.status, error: text })
      return errorResponse(`Payment failed: ${text}`, completeRes.status)
    }

    const completed = (await completeRes.json()).class_booking

    logger.info('Booking completed', {
      bookingId: completed.id,
      status: completed.status,
      orderId: completed.order_id,
    })

    return new Response(JSON.stringify({
      data: {
        bookingId: completed.id,
        orderId: completed.order_id,
        status: completed.status,
        receiptUrl: completed.order?.receipt_url ?? null,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', { error: msg })
    return errorResponse('An unexpected error occurred. Your card was not charged.', 500)
  }
}

function buyerHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': 'https://book.squareup.com',
    'Referer': 'https://book.squareup.com/',
  }
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: 'Unable to book workshop', detail }),
    { status, headers: { 'Content-Type': 'application/json' } },
  )
}
