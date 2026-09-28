/**
 * Party start-time logic. We GENERATE the offered starts from config (per-weekday
 * schedule in `partyDays`) rather than filtering Square's raw availability, so exact
 * half-hour anchors (e.g. 11:30, 4:30) and per-day windows are possible. Square is
 * only consulted for existing bookings, to drop slots that are already taken.
 *
 * Schedule: starts step by (durationMinutes + cleanupBufferMinutes) from each day's
 * `firstStart`, while start + party + cleanup ≤ `lastWrap` (keeps the evening
 * workshop slot clear). See `partyDays` in party.config.ts.
 */
import { partyConfig, partyDays } from '../config/party.config'
import { closureOn } from '../config/closures'

const DAY_MS = 86_400_000

/** Local hour (0–23) of an ISO timestamp in the studio's timezone. */
export function localHour(iso: string, tz: string = partyConfig.timezone): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  }).formatToParts(new Date(iso))
  return parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
}

/** Local YYYY-MM-DD of an ISO timestamp in the studio's timezone. */
export function localDate(iso: string, tz: string = partyConfig.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Convert a studio-local date (YYYY-MM-DD) + time (HH:MM) to a UTC ISO string. */
export function localToUtcISO(ymd: string, hhmm: string, tz: string = partyConfig.timezone): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm))
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess)
  const p: Record<string, string> = {}
  for (const x of parts) p[x.type] = x.value
  const asSeen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  const offset = asSeen - guess.getTime()
  return new Date(guess.getTime() - offset).toISOString()
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Occupancy of one party (party + cleanup) in ms — used for overlap checks. */
function occupancyMs(): number {
  return (partyConfig.durationMinutes + partyConfig.cleanupBufferMinutes) * 60_000
}

/** Studio-local YYYY-MM-DD, `days` after the studio's today. */
function studioDatePlus(days: number, now: Date): string {
  const [y, m, d] = localDate(now.toISOString()).split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days, 12))
  return shifted.toISOString().slice(0, 10)
}

/**
 * The dates a party can be booked for today, both ends included
 * (studio-local YYYY-MM-DD). THE single rule for "which dates are on offer":
 *   - not before opening day
 *   - not with less than `minLeadDays` notice
 *   - not further ahead than `bookingWindowDays`
 * A day inside that span can still be closed (see closures.ts): bookableOn says so.
 */
export function bookableDates(now: Date = new Date()): { first: string; last: string } {
  const soonest = studioDatePlus(partyConfig.minLeadDays, now)
  return {
    // YYYY-MM-DD strings compare lexically.
    first: soonest > partyConfig.bookingOpensDate ? soonest : partyConfig.bookingOpensDate,
    last: studioDatePlus(partyConfig.bookingWindowDays, now),
  }
}

/** Why a date is or isn't on offer. The server uses this to explain a refusal. */
export function bookableOn(
  ymd: string,
  now: Date = new Date(),
): 'ok' | 'before_opening' | 'closed' | 'too_soon' | 'too_far' {
  if (ymd < partyConfig.bookingOpensDate) return 'before_opening'
  if (closureOn(ymd)) return 'closed'
  const { first, last } = bookableDates(now)
  if (ymd < first) return 'too_soon'
  if (ymd > last) return 'too_far'
  return 'ok'
}

/**
 * Offered party start ISO timestamps for a local calendar date (YYYY-MM-DD).
 * Empty for any date outside bookableDates(): this is the one choke point
 * behind availability, the dates list, the calendar and the server's re-check.
 */
export function partyStartsForDate(ymd: string, now: Date = new Date()): string[] {
  if (bookableOn(ymd, now) !== 'ok') return []
  const [y, m, d] = ymd.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  const cfg = partyDays[weekday]
  if (!cfg) return []

  const step = partyConfig.durationMinutes + partyConfig.cleanupBufferMinutes
  const first = minutesOfDay(cfg.firstStart)
  const wrap = minutesOfDay(cfg.lastWrap)

  const out: string[] = []
  for (let t = first; t + step <= wrap; t += step) {
    const hh = String(Math.floor(t / 60)).padStart(2, '0')
    const mm = String(t % 60).padStart(2, '0')
    out.push(localToUtcISO(ymd, `${hh}:${mm}`))
  }
  return out
}

/** All offered party starts whose start falls within [startIso, endIso], sorted. */
export function partyStartsInRange(startIso: string, endIso: string, now: Date = new Date()): string[] {
  const startMs = new Date(startIso).getTime()
  const endMs = new Date(endIso).getTime()
  const seen = new Set<string>()
  const out: string[] = []
  for (let t = startMs; t <= endMs + DAY_MS; t += DAY_MS) {
    const ymd = localDate(new Date(Math.min(t, endMs)).toISOString())
    if (seen.has(ymd)) continue
    seen.add(ymd)
    for (const iso of partyStartsForDate(ymd, now)) {
      const ms = new Date(iso).getTime()
      if (ms >= startMs && ms <= endMs) out.push(iso)
    }
  }
  return out.sort()
}

/**
 * Drop starts whose party+cleanup window overlaps any already-booked start.
 * Bookings are normally at offered starts, but overlap keeps manual bookings safe.
 */
export function removeBooked(starts: string[], bookedStartIsos: string[]): string[] {
  const occupy = occupancyMs()
  const booked = bookedStartIsos.map((b) => new Date(b).getTime())
  return starts.filter((s) => {
    const cs = new Date(s).getTime()
    return !booked.some((bs) => cs < bs + occupy && bs < cs + occupy)
  })
}
