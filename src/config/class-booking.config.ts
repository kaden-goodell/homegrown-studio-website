/**
 * CLIENT-SAFE constants — anything a hydrated island needs from site.config.
 *
 * Lives in its own module because a hydrated island (WorkshopBookingModal,
 * QrModal) importing site.config directly pulls in the server env guard,
 * which throws in the browser (PROVIDER_MODE is server-only) and kills
 * hydration — the page freezes on skeletons.
 *
 * Square's buyer-facing Web Payments app ID — publishable by design; only
 * this app ID is accepted for `class_bookings` API tokens (the merchant app
 * ID is rejected — see square-class-bookings memory).
 */
export const CLASS_BOOKING_APP_ID = 'sq0idp-0WpGrONcXfCcfav3Lkd9Jg'

/** Canonical site origin, no trailing slash — re-exported as `siteConfig.url`
 *  for server code, and here for anything client-hydrated that already imports
 *  from this module. One definition, in `site-url.ts`, which is also
 *  import-free and so equally safe in the browser. */
export { SITE_URL } from './site-url'

/**
 * The most seats one booking can take. The booking panel and the server both
 * read this, so the panel can never offer a number the server will refuse.
 * Bigger groups book a private party instead.
 */
export const MAX_SEATS_PER_BOOKING = 20
