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
      get_distinct_id?(): string
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

/** This visitor's PostHog id, sent with a booking so the server's record of
 *  it joins the visit (see posthog-server.ts). Undefined when not loaded. */
export function posthogId(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try { return window.posthog?.get_distinct_id?.() } catch { return undefined }
}

/** After a booking: this browser is that customer from now on (their earlier
 *  and later visits join their person in PostHog). */
export function identifyBooker(email: string, firstName: string, lastName: string): void {
  if (typeof window === 'undefined' || !email) return
  try { window.posthog?.identify(email.trim().toLowerCase(), { email: email.trim().toLowerCase(), name: `${firstName} ${lastName}`.trim() }) } catch { /* ignore */ }
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
export function trackNotifyMe(interest: string, where?: string): void {
  capture('notify_me_signup', { interest, ...(where ? { where } : {}) })
}

/** A "tell me when…" sign-up that didn't go through. */
export function trackNotifyMeFailed(interest: string, reason: 'invalid' | 'rate_limited' | 'server' | 'network', where?: string): void {
  capture('notify_me_failed', { interest, reason, ...(where ? { where } : {}) })
}

/** Opened the "tell me when…" form on a class that isn't on sale yet or is full. */
export function trackWaitlistOpened(itemId: string, itemName: string, reason: 'coming_soon' | 'sold_out'): void {
  capture('waitlist_opened', { item_id: itemId, item_name: itemName, reason })
}

export function trackNewsletterFailed(reason: 'server' | 'network'): void {
  capture('newsletter_failed', { reason })
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

/** `other`: a shared piece (the payment form) used outside a known flow. */
export type BookingKindForAnalytics = 'party' | 'workshop' | 'kit' | 'other'

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
  // Each choice gets its own property (chosen_date, chosen_guests…): one shared
  // property got typed as a date by PostHog, which then read 30 guests as Jan 30.
  capture('booking_choice', { booking_kind: kind, choice, ...(value !== undefined ? { [`chosen_${choice.replace(/[^a-z0-9_]/gi, '_').slice(0, 30)}`]: value } : {}) })
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

/** Turned the gift-card box on or off at checkout. */
export function trackGiftCardToggle(on: boolean, kind: BookingKindForAnalytics = 'other'): void {
  capture('gift_card_toggle', { on, booking_kind: kind })
}

/** Saved an event to their calendar. */
export function trackAddToCalendar(source: 'host_dashboard' | 'invite' | 'confirmation', type: 'google' | 'ics', kind?: BookingKindForAnalytics): void {
  capture('add_to_calendar', { source, type, ...(kind ? { booking_kind: kind } : {}) })
}

/** Followed (or passed on) a link to the participation agreement. */
export function trackWaiverLinkClick(source: string): void {
  capture('waiver_link_click', { source })
}

/** The "your party" banner shown to someone who just booked. */
export function trackRecentPartyBanner(action: 'open' | 'dismiss'): void {
  capture('recent_party_banner', { action })
}

// ── What's On calendar (/calendar) ─────────────────────────────────────────

export function trackCalendarFilter(filter: string): void {
  capture('calendar_filter', { filter })
}

export function trackCalendarView(view: 'list' | 'month'): void {
  capture('calendar_view', { view })
}

export function trackCalendarMonthNav(direction: 'prev' | 'next' | 'today'): void {
  capture('calendar_month_nav', { direction })
}

export function trackCalendarDaySelect(date: string, eventCount: number): void {
  capture('calendar_day_select', { date, event_count: eventCount })
}

export function trackCalendarShowMore(shown: number): void {
  capture('calendar_show_more', { shown })
}

export function trackCalendarEventClick(e: { eventKind: string; itemId?: string; date: string; bookable: boolean }): void {
  capture('calendar_event_click', { event_kind: e.eventKind, date: e.date, bookable: e.bookable, ...(e.itemId ? { item_id: e.itemId } : {}) })
}

export function trackCalendarLoadFailed(detail?: string): void {
  capture('calendar_load_failed', detail ? { detail: detail.slice(0, 100) } : {})
}

/** The Craft Café menu couldn't load, or the visitor pressed "try again". */
export function trackCraftMenu(action: 'load_failed' | 'retry'): void {
  capture('craft_menu', { action })
}

// ── Site navigation ────────────────────────────────────────────────────────

export function trackNavMenuOpen(): void {
  capture('nav_menu_open')
}

export function trackNavClick(label: string, where: string, href?: string): void {
  capture('nav_click', { label: label.slice(0, 60), where, ...(href ? { link_url: href } : {}) })
}

export function trackFaqOpen(question: string, where?: string): void {
  capture('faq_open', { question: question.slice(0, 100), ...(where ? { where } : {}) })
}

// ── Participation agreement (counts only — never names) ────────────────────

/** No party or class on the link = a walk-in (Craft Café) agreement. */
export type WaiverKindForAnalytics = 'party' | 'workshop' | 'open_studio'

export function trackWaiverStarted(kind: WaiverKindForAnalytics, kiosk: boolean): void {
  capture('waiver_started', { kind, kiosk })
}

/** A step of the agreement flow: the returning-family lookup, the form… */
export function trackWaiverStep(step: string, kind: WaiverKindForAnalytics, kiosk: boolean, extra?: Record<string, string | number | boolean>): void {
  capture('waiver_step', { step, kind, kiosk, ...extra })
}

export function trackWaiverSigned(d: { kind: WaiverKindForAnalytics; kids: number; dropOff: boolean; kiosk: boolean; returning?: boolean }): void {
  capture('waiver_signed', { kind: d.kind, kids: d.kids, drop_off: d.dropOff, kiosk: d.kiosk, ...(d.returning !== undefined ? { returning: d.returning } : {}) })
}

// ── Markup-declared events ─────────────────────────────────────────────────

const EVENT_NAME = /^[a-z][a-z0-9_]{1,39}$/

/**
 * An event named in page markup (`data-track-event` — see analytics-auto.ts),
 * for .astro pages with no script of their own. Only a snake_case name and
 * short plain values get through.
 */
export function trackMarkupEvent(event: string, props: Record<string, string | number | boolean>): void {
  if (!EVENT_NAME.test(event)) return
  capture(event, props)
}
