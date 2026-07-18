/**
 * Typed analytics wrapper — dual-dispatches every event to PostHog and GA4.
 *
 * Each function no-ops for any backend that isn't loaded (neither script is
 * present without its key — see Analytics.astro), so components can call these
 * unconditionally. GA4 receives the same event names; `payment_completed`
 * additionally fires a GA4 `purchase` event with value, which is what Google
 * Ads conversion import keys on (HOM-150).
 */

declare global {
  interface Window {
    posthog?: {
      capture(event: string, properties?: Record<string, unknown>): void
    }
    gtag?: (...args: unknown[]) => void
  }
}

function capture(event: string, properties?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  window.posthog?.capture(event, properties)
  window.gtag?.('event', event, properties ?? {})
}

export function trackWizardStarted(eventType: string): void {
  capture('wizard_started', { event_type: eventType })
}

export function trackWizardStepCompleted(step: string): void {
  capture('wizard_step_completed', { step })
}

export function trackBookingCompleted(eventType: string): void {
  capture('booking_completed', { event_type: eventType })
}

export function trackCouponApplied(codeName: string): void {
  capture('coupon_applied', { code: codeName })
}

export function trackPaymentStarted(amount: number): void {
  capture('payment_started', { amount })
}

/** `amount` in dollars. Also emits the GA4 `purchase` conversion event. */
export function trackPaymentCompleted(amount: number): void {
  capture('payment_completed', { amount })
  if (typeof window !== 'undefined') {
    window.gtag?.('event', 'purchase', { value: amount, currency: 'USD' })
  }
}

export function trackPaymentFailed(error: string): void {
  capture('payment_failed', { error })
}

export function trackInquirySubmitted(eventType: string): void {
  capture('inquiry_submitted', { event_type: eventType })
}

export function trackWizardAbandoned(lastStep: string, eventType: string): void {
  capture('wizard_abandoned', { lastStep, eventType })
}

export function trackWorkshopSeatBooked(workshopName: string, price: number): void {
  capture('workshop_seat_booked', { workshopName, price })
}

export function trackNewsletterSubscribed(): void {
  capture('newsletter_subscribed')
}
