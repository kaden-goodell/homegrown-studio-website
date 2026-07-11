import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { providers } from '@config/providers'
import { getPartyRecord } from '@lib/party-store'
import { kitThemes } from '@config/kit-content'
import { weekKeyFor } from '@lib/kit-dates'
import { studioDateOf } from '@lib/party-availability'
import { releaseWeekClaim } from '@lib/kit-store'

export const POST: APIRoute = async ({ request }) => {
  const logger = createLogger('api:booking:cancel')
  const startTime = Date.now()
  try {
    const body = await request.json()
    await providers.booking.cancelBooking(body.bookingId, body.bookingVersion)
    logger.info('Booking cancelled', {
      duration_ms: Date.now() - startTime,
      bookingId: body.bookingId,
    })

    // Free the themed-table week on the shared kit ledger, or the slot stays
    // falsely consumed all week and the over-commitment radar false-positives.
    // Best-effort — a cancelled booking must still report success.
    try {
      const record = await getPartyRecord(body.bookingId)
      if (record?.theme?.claimRef) {
        const ledgerThemeId = kitThemes.find((t) => t.id === record.theme!.themeId)?.ledgerThemeId ?? record.theme!.themeId
        const weekKey = weekKeyFor(studioDateOf(record.startIso))
        await releaseWeekClaim(ledgerThemeId, weekKey, record.theme.claimRef)
        logger.info('Themed-table claim released', { bookingId: body.bookingId, weekKey })
      }
    } catch (err) {
      logger.warn('Themed-table claim release failed (booking still cancelled)', {
        bookingId: body.bookingId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return new Response(JSON.stringify({ data: { success: true } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    logger.error('Booking cancellation failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - startTime,
    })
    await providers.notification.send({
      type: 'api-failure',
      title: 'Booking cancellation failed',
      details: { route: 'booking/cancel', error: String(error) },
      severity: 'warning',
      timestamp: new Date().toISOString(),
    })
    return new Response(
      JSON.stringify({ error: 'Unable to cancel booking' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
