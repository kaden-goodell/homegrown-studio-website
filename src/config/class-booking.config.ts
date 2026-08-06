/**
 * CLIENT-SAFE constants for the buyer-facing class-bookings checkout.
 *
 * Lives in its own module because WorkshopBookingModal (a hydrated island)
 * needs it: importing site.config into a client bundle pulls in the server
 * env guard, which throws in the browser (PROVIDER_MODE is server-only) and
 * kills hydration — the workshops page freezes on skeletons.
 *
 * Square's buyer-facing Web Payments app ID — publishable by design; only
 * this app ID is accepted for `class_bookings` API tokens (the merchant app
 * ID is rejected — see square-class-bookings memory).
 */
export const CLASS_BOOKING_APP_ID = 'sq0idp-0WpGrONcXfCcfav3Lkd9Jg'
