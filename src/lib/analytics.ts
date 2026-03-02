/**
 * Typed PostHog analytics wrapper.
 * Each function calls window.posthog?.capture() if loaded, no-ops otherwise.
 * This keeps tracking calls clean in components without direct PostHog coupling.
 */

declare global {
  interface Window {
    posthog?: {
      capture(event: string, properties?: Record<string, unknown>): void
    }
  }
}

function capture(event: string, properties?: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    window.posthog?.capture(event, properties)
  }
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

export function trackPaymentCompleted(amount: number): void {
  capture('payment_completed', { amount })
}

export function trackPaymentFailed(error: string): void {
  capture('payment_failed', { error })
}

export function trackInquirySubmitted(eventType: string): void {
  capture('inquiry_submitted', { event_type: eventType })
}
