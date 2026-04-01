import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'

const logger = createLogger('api:reservations:cancel')

const CANCELLATION_WINDOW_HOURS = 24

interface CancelRequest {
  bookingIds: string[]
  giftCardId?: string
}

export const POST: APIRoute = async ({ request }) => {
  let body: CancelRequest
  try {
    body = await request.json()
  } catch {
    return errorResponse('Invalid request body', 400)
  }

  if (!body.bookingIds?.length) {
    return errorResponse('At least one booking ID is required', 400)
  }

  try {
    // Step 1: Check the first booking to determine refund type
    const firstBooking = await providers.booking.getBooking(body.bookingIds[0])
    const startAt = new Date(firstBooking.slot.startAt)
    const now = new Date()
    const hoursUntilBooking = (startAt.getTime() - now.getTime()) / (1000 * 60 * 60)
    const isFullRefund = hoursUntilBooking >= CANCELLATION_WINDOW_HOURS

    logger.info('Cancellation requested', {
      bookingIds: body.bookingIds,
      hoursUntilBooking: Math.round(hoursUntilBooking * 10) / 10,
      refundType: isFullRefund ? 'full_refund' : 'store_credit',
      giftCardId: body.giftCardId ?? null,
    })

    // Step 2: Cancel all bookings (try all even if some fail)
    const cancelResults: { id: string; success: boolean; error?: string }[] = []

    for (const bookingId of body.bookingIds) {
      try {
        await providers.booking.cancelBooking(bookingId, 0)
        cancelResults.push({ id: bookingId, success: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error('Failed to cancel booking', { bookingId, error: msg })
        cancelResults.push({ id: bookingId, success: false, error: msg })
      }
    }

    const allCancelled = cancelResults.every((r) => r.success)
    const anyCancelled = cancelResults.some((r) => r.success)

    if (!anyCancelled) {
      return errorResponse('Failed to cancel any bookings. Please contact us for assistance.', 500)
    }

    if (!allCancelled) {
      logger.error('Partial cancellation — some bookings failed', {
        results: cancelResults,
      })
    }

    // Step 3: Handle gift card based on refund type
    if (isFullRefund && body.giftCardId && providers.giftcard) {
      // Full refund: deactivate gift card — this is critical because the customer
      // gets their money back. Leaving the gift card active means double credit.
      await providers.giftcard.deactivate(body.giftCardId)
      logger.info('Gift card deactivated for full refund', { giftCardId: body.giftCardId })
    }
    // Store credit: gift card stays active — nothing to do

    const refundType = isFullRefund ? 'full_refund' : 'store_credit'
    const message = isFullRefund
      ? 'Your reservation has been cancelled and you will receive a full refund. Your craft credit gift card has been deactivated.'
      : 'Your reservation has been cancelled. Your craft credit gift card remains active as store credit.'

    return new Response(
      JSON.stringify({
        data: {
          cancelled: true,
          refundType,
          message: body.giftCardId
            ? message
            : 'Your reservation has been cancelled.' +
              (isFullRefund ? ' You will receive a full refund.' : ''),
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Reservation cancellation failed', { error: msg })
    return errorResponse(
      'An unexpected error occurred while cancelling your reservation. Please contact us for assistance.',
      500
    )
  }
}

function errorResponse(detail: string, status: number) {
  return new Response(
    JSON.stringify({ error: 'Unable to cancel reservation', detail }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
