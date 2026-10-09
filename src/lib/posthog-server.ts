/**
 * Bookings reported to PostHog by the server: the browser's own events can be
 * blocked (ad blockers, a closed tab right after paying), these cannot. They
 * are the source of truth for revenue in PostHog; the browser's `purchase` is
 * the same booking seen from the visit.
 *
 * Only the live site reports (local dev and previews would count our own
 * tests), never a simulated booking, and a failure never touches the booking.
 */
import type { Attribution } from '@lib/attribution'
import type { AnalyticsItem } from '@lib/analytics'

const HOST = 'https://us.i.posthog.com'

export interface ServerBooking {
  requestUrl: string
  kind: 'party' | 'workshop' | 'kit'
  bookingId: string
  amountCents: number
  email: string
  firstName: string
  lastName: string
  items: AnalyticsItem[]
  attribution?: Attribution | null
  /** The browser's PostHog id, so the visit and the booking join up. */
  posthogId?: unknown
  simulated?: boolean
  extra?: Record<string, string | number | boolean>
}

/** Live site only. Exported for tests. */
export function reportsFrom(requestUrl: string): boolean {
  try { return /(^|\.)ourhometownstudio\.com$/.test(new URL(requestUrl).hostname) } catch { return false }
}

/** The PostHog events for one booking (an identify that joins the visit, then the booking). */
export function bookingEvents(b: ServerBooking, now = new Date()): Record<string, unknown>[] {
  const email = b.email.trim().toLowerCase()
  const anon = typeof b.posthogId === 'string' && b.posthogId.length > 0 && b.posthogId.length < 200 ? b.posthogId : null
  const a = b.attribution
  const source = a ? {
    first_source: a.first.source, first_medium: a.first.medium, first_campaign: a.first.campaign ?? null, first_landing: a.first.landing,
    last_source: a.last.source, last_medium: a.last.medium, last_campaign: a.last.campaign ?? null, visits_before_booking: a.visits,
  } : {}
  const ts = now.toISOString()
  return [
    {
      event: '$identify',
      distinct_id: email,
      timestamp: ts,
      properties: {
        ...(anon && anon !== email ? { $anon_distinct_id: anon } : {}),
        $set: { email, name: `${b.firstName} ${b.lastName}`.trim(), last_booking_kind: b.kind, last_booking_at: ts },
        $set_once: { first_booking_kind: b.kind, first_booking_at: ts, ...(a ? { first_source: a.first.source, first_medium: a.first.medium, first_campaign: a.first.campaign ?? null } : {}) },
      },
    },
    {
      event: 'booking_paid',
      distinct_id: email,
      timestamp: ts,
      properties: {
        booking_kind: b.kind,
        booking_id: b.bookingId,
        revenue: b.amountCents / 100,
        currency: 'USD',
        items: b.items,
        item_names: b.items.map((i) => i.item_name).join(', '),
        ...source,
        ...(b.extra ?? {}),
        $insert_id: `booking_paid-${b.bookingId}`,
      },
    },
  ]
}

export async function reportBooking(b: ServerBooking): Promise<void> {
  const token = import.meta.env.PUBLIC_POSTHOG_PROJECT_TOKEN
  if (!token || b.simulated || !reportsFrom(b.requestUrl)) return
  try {
    await fetch(`${HOST}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: token, batch: bookingEvents(b) }),
      signal: AbortSignal.timeout(2500),
    })
  } catch { /* analytics never fails a booking */ }
}
