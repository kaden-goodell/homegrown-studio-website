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
      identify(distinctId: string, properties?: Record<string, unknown>): void
      reset(): void
      logger?: {
        info(message: string, attributes?: Record<string, unknown>): void
      }
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

export function trackPaymentStarted(amount: number): void {
  capture('payment_started', { amount })
}

/**
 * `amount` in dollars. Also emits the GA4 `purchase` conversion event —
 * with the booking id and what was bought when given, which turns on GA's
 * Monetization reports (revenue by craft / class) and de-duplicates repeats.
 */
export function trackPaymentCompleted(
  amount: number,
  details?: { kind: BookingKindForAnalytics; transactionId?: string | null; items?: AnalyticsItem[]; extra?: Record<string, unknown> },
): void {
  capture('payment_completed', { amount, ...(details ? { kind: details.kind, ...details.extra } : {}) })
  if (typeof window !== 'undefined') {
    window.gtag?.('event', 'purchase', {
      value: amount,
      currency: 'USD',
      ...(details?.transactionId ? { transaction_id: details.transactionId } : {}),
      ...(details?.items ? { items: details.items } : {}),
      ...(details ? { booking_kind: details.kind, ...details.extra } : {}),
    })
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

/** A "tell me when…" sign-up. `interest` says what they were looking at. */
export function trackNotifyMe(interest: string): void {
  capture('notify_me_signup', { interest })
}

// ── Staff operations ───────────────────────────────────────────────────────

/** A staff member records one or more arrivals; the staff console identity owns the event. */
export function trackStaffCheckinCompleted(personCount: number, dropOff: boolean): void {
  capture('staff_checkin_completed', { person_count: personCount, drop_off: dropOff })
}

/** A staff member completes an attendee pickup without storing collector details. */
export function trackStaffCheckoutCompleted(personCount: number, pickupCodeUsed: boolean): void {
  capture('staff_checkout_completed', { person_count: personCount, pickup_code_used: pickupCodeUsed })
}

/** A staff member uses the documented pickup override flow. */
export function trackStaffPickupOverridden(personCount: number, reason: 'called-parent' | 'parent-present' | 'other'): void {
  capture('staff_pickup_overridden', { person_count: personCount, reason })
}

/** A staff member issues or reissues a pickup code. */
export function trackPickupCodeReissued(): void {
  capture('pickup_code_reissued')
}

/** A staff member successfully mints a gift card; recipient details are deliberately omitted. */
export function trackGiftCardCreated(amount: number): void {
  capture('gift_card_created', { amount })
}

/** A staff member completes a kit fulfillment or service action. */
export function trackKitOrderUpdated(action: string): void {
  capture('kit_order_updated', { action })
}

// ── Funnel + ecommerce (GA4 recommended event names) ───────────────────────

export type BookingKindForAnalytics = 'party' | 'workshop' | 'kit'

/** One thing that can be bought, in GA4's item shape. Prices in dollars. */
export interface AnalyticsItem {
  item_id: string
  item_name: string
  /** party / workshop / kit / cafe */
  item_category: string
  price?: number
  quantity?: number
  /** Position in the list it was shown in (0 = first). */
  index?: number
}

/** A list of crafts / classes was shown (the party page, the café menu, workshops). */
export function trackViewItemList(listName: string, items: AnalyticsItem[]): void {
  capture('view_item_list', { item_list_name: listName, items: items.slice(0, 50) })
}

/** Someone opened or picked one thing from a list. */
export function trackSelectItem(listName: string, item: AnalyticsItem): void {
  capture('select_item', { item_list_name: listName, items: [item] })
}

/** Someone looked at one thing in detail (a craft's "read more", a class's page). */
export function trackViewItem(item: AnalyticsItem): void {
  capture('view_item', { currency: 'USD', value: item.price ?? 0, items: [item] })
}

/** Reached the details + payment step. */
export function trackBeginCheckout(kind: BookingKindForAnalytics, value: number, items: AnalyticsItem[], extra?: Record<string, unknown>): void {
  capture('begin_checkout', { booking_kind: kind, currency: 'USD', value, items, ...extra })
}

/** Pressed pay (card, Apple Pay, Google Pay or gift card). */
export function trackAddPaymentInfo(kind: BookingKindForAnalytics, value: number, method: string): void {
  capture('add_payment_info', { booking_kind: kind, currency: 'USD', value, payment_type: method })
}

/** A choice inside a booking flow: the date, the time, the guest count… */
export function trackBookingChoice(kind: BookingKindForAnalytics, choice: string, value?: string | number): void {
  capture('booking_choice', { booking_kind: kind, choice, ...(value !== undefined ? { choice_value: value } : {}) })
}

/** Closed a booking flow without finishing. `lastStep` is where they were. */
export function trackBookingAbandoned(kind: BookingKindForAnalytics, lastStep: string, extra?: Record<string, unknown>): void {
  capture('booking_abandoned', { booking_kind: kind, last_step: lastStep, ...extra })
}

/** Something went wrong in front of a customer (no dates loaded, time taken, card declined…). */
export function trackBookingProblem(kind: BookingKindForAnalytics, problem: string, detail?: string): void {
  capture('booking_problem', { booking_kind: kind, problem, ...(detail ? { detail: detail.slice(0, 100) } : {}) })
}

/** A "book" / call-to-action button. `where` says which part of which page. */
export function trackCtaClick(label: string, where: string, href?: string): void {
  capture('cta_click', { label: label.slice(0, 60), where, ...(href ? { link_url: href } : {}) })
}

/** Phone, text, email or directions — someone reaching out (a lead). */
export function trackContactClick(method: 'phone' | 'text' | 'email' | 'directions', where: string): void {
  capture('generate_lead', { method, where })
  capture('contact_click', { method, where })
}

/** Shared a link (party invite, a class, the site). */
export function trackShare(contentType: string, method: string, itemId?: string): void {
  capture('share', { content_type: contentType, method, ...(itemId ? { item_id: itemId } : {}) })
}
