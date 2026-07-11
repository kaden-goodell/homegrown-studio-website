/**
 * Pure date math for the take-home kit product.
 *
 * Everything is a YYYY-MM-DD string manipulated through `Date.UTC` — never a
 * local-timezone Date — so month/year rollovers are handled by the calendar
 * and DST can't shift a result (UTC has no DST). The one place a wall-clock
 * "now" enters is the caller's studio-local today string (en-CA/America/Chicago
 * convention, matching WhatsOnCalendar's todayISO); this module only compares
 * strings, it never reads the clock.
 */
import { kitConfig } from '@config/kit.config'

const THURSDAY = 4 // Sun=0 … Thu=4

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m, d]
}

/** date + days, as a YYYY-MM-DD string. Rolls months/years; DST-safe (pure UTC). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Day of week (Sun=0 … Sat=6) for a YYYY-MM-DD string, via UTC. */
function dayOfWeek(date: string): number {
  const [y, m, d] = parts(date)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Whole days from `a` to `b` (both YYYY-MM-DD); negative if `b` precedes `a`. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a)
  const [by, bm, bd] = parts(b)
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
}

/**
 * Latest Thursday on or before the party date — the kit pickup day. A party on
 * a Thursday picks up that same morning; any other day falls back to that
 * party-week's Thursday.
 */
export function pickupThursdayFor(partyDate: string): string {
  const back = (dayOfWeek(partyDate) - THURSDAY + 7) % 7
  return addDays(partyDate, -back)
}

/** Return-by day: pickup + 6 days, which always lands on a Wednesday. */
export function returnByFor(pickupDate: string): string {
  return addDays(pickupDate, 6)
}

/** The week key for a party date: its pickup Thursday (YYYY-MM-DD). */
export function weekKeyFor(partyDate: string): string {
  return pickupThursdayFor(partyDate)
}

/**
 * Is the party far enough out to order? Pickup must be at least the configured
 * lead time (7 days) from `now`. `now` is the studio-local today string.
 */
export function isOrderable(partyDate: string, now: string): boolean {
  return daysBetween(now, pickupThursdayFor(partyDate)) >= kitConfig.leadTimeDays
}

/**
 * The pickup week staff are currently assembling FOR: the next Thursday
 * strictly after `today`. Mon–Wed point at this week's Thursday; Thursday
 * morning rolls over to next week's (that day's pickups were assembled last
 * week); Fri–Sun continue building toward the coming Thursday.
 */
export function assemblyWeekKeyFor(today: string): string {
  return addDays(pickupThursdayFor(today), 7)
}

/** True when the YYYY-MM-DD string is a Thursday — a valid kit week key. */
export function isWeekKey(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && dayOfWeek(date) === THURSDAY
}

/**
 * The package tier a guest count maps to: round up to the next serves-5 and
 * clamp to a configured tier. 11→15, 16→20, 21+→null (no package that large),
 * and counts below the smallest tier likewise return null.
 */
export function tierFor(guests: number): number | null {
  const rounded = Math.ceil(guests / 5) * 5
  return kitConfig.tiers.some((t) => t.serves === rounded) ? rounded : null
}
