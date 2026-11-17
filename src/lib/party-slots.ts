/**
 * Party start-time logic from the config, as it has always answered. The rules
 * themselves live in src/lib/parties/party-times.ts and take the owners' saved
 * party settings; these are thin wrappers over them with configPartySettings()
 * (starts step by durationMinutes + cleanupBufferMinutes from each day's
 * `firstStart` while start + party + cleanup ≤ `lastWrap`; see `partyDays` in
 * party.config.ts). Square is only consulted for existing bookings.
 */
import { partyConfig } from '../config/party.config'
import { CONFIG_STUDIO_DAYS, type StudioDays } from '../config/studio-days'
import * as T from './parties/party-times'
import { partyTermsForStart } from './party-terms'

// The studio-local time helpers live with the pure party rules now; every
// import of them from here keeps working.
export { localHour, localDate, localToUtcISO } from './parties/party-times'


/**
 * The dates a party can be booked for today, both ends included
 * (studio-local YYYY-MM-DD), from the config: not before opening day, not
 * with less than `minLeadDays` notice, not further ahead than
 * `bookingWindowDays`. A day inside that span can still be closed: bookableOn
 * says so. (Saved settings: src/lib/parties/party-times.ts.)
 */
export function bookableDates(now: Date = new Date()): { first: string; last: string } {
  return T.bookableDates(T.configPartySettings().times, now)
}

/**
 * Why a date is or isn't on offer. `days`: the closed days and café hours in
 * use (getStudioDays() on the server); the default is the config.
 */
export function bookableOn(
  ymd: string,
  now: Date = new Date(),
  days: StudioDays = CONFIG_STUDIO_DAYS,
): 'ok' | 'before_opening' | 'closed' | 'too_soon' | 'too_far' {
  return T.bookableOn(T.configPartySettings().times, ymd, now, days)
}

/**
 * Offered party start ISO timestamps for a local calendar date (YYYY-MM-DD),
 * from the config. Empty for any date outside bookableDates().
 */
export function partyStartsForDate(ymd: string, now: Date = new Date(), days: StudioDays = CONFIG_STUDIO_DAYS): string[] {
  return T.partyStartsForDate(T.configPartySettings(), ymd, now, days)
}

/** All offered party starts whose start falls within [startIso, endIso], sorted. */
export function partyStartsInRange(startIso: string, endIso: string, now: Date = new Date(), days: StudioDays = CONFIG_STUDIO_DAYS): string[] {
  return T.partyStartsInRange(T.configPartySettings(), startIso, endIso, now, days)
}

/** A booked party: its start, and its length when the booking says (else that day's usual length). */
export type BookedParty = string | { startAt: string; durationMinutes?: number | null }

/**
 * Drop starts whose party+cleanup window overlaps any already-booked party
 * (and its cleanup). Each side uses its own length, so a 2-hour weeknight
 * party and a 90-minute weekend one are both measured right. Bookings are
 * normally at offered starts, but overlap keeps manual bookings safe.
 */
export function removeBooked(starts: string[], booked: BookedParty[]): string[] {
  const buffer = partyConfig.cleanupBufferMinutes * 60_000
  const spans = booked.map((b) => {
    const startAt = typeof b === 'string' ? b : b.startAt
    const own = typeof b === 'string' ? undefined : b.durationMinutes
    const minutes = own && own > 0 ? own : partyTermsForStart(startAt).durationMinutes
    const start = new Date(startAt).getTime()
    return { start, end: start + minutes * 60_000 }
  })
  return starts.filter((s) => {
    const cs = new Date(s).getTime()
    const ce = cs + partyTermsForStart(s).durationMinutes * 60_000
    return !spans.some((b) => cs < b.end + buffer && b.start < ce + buffer)
  })
}
