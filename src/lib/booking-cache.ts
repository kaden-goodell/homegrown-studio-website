/**
 * The public booking pages and lists (/workshops, /calendar and their JSON)
 * are kept at Netlify's edge for a few minutes (cache-headers.ts). They carry
 * the cache tag below, so a flip of the online booking switch can clear them
 * at once instead of waiting for the kept copy to go stale. Best effort: the
 * booking endpoints always ask the switch themselves, so a page that is a
 * minute behind can never book anything the switch refuses.
 *
 * Server only.
 */
import { createLogger } from '@lib/logger'

const logger = createLogger('booking-cache')

export const BOOKING_CACHE_TAG = 'booking-pages'

/** Clears the kept copies of the booking pages. Never throws; false when it couldn't (off Netlify, say). */
export async function purgeBookingPages(): Promise<boolean> {
  if (typeof process === 'undefined' || process.env.NETLIFY !== 'true') return false
  try {
    const { purgeCache } = await import('@netlify/functions')
    await purgeCache({ tags: [BOOKING_CACHE_TAG] })
    return true
  } catch (e) {
    logger.warn('Booking pages could not be cleared from the edge cache', { error: e instanceof Error ? e.message : String(e) })
    return false
  }
}
