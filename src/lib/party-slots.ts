/**
 * Filters raw Square availability into the party start times we actually offer:
 * spaced by 2h party + 1h cleanup, and no later than `latestStartHourLocal` (3pm)
 * so every party (incl. cleanup) wraps by 6pm — the "6pm-exclusive" rule that frees
 * the evening for workshops. Used by both the availability endpoint and the calendar.
 */
import { partyConfig } from '../config/party.config'

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

/**
 * Given Square availability slots (each with a `startAt` ISO string), return only the
 * ones we offer as party starts: local start hour ≤ 3pm, spaced ≥3h apart per day.
 */
export function offeredPartyStarts<T extends { startAt: string }>(slots: T[]): T[] {
  const tz = partyConfig.timezone
  const spacingMs = partyConfig.slotSpacingHours * 3_600_000

  const eligible = slots
    .filter((s) => localHour(s.startAt, tz) <= partyConfig.latestStartHourLocal)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())

  const out: T[] = []
  const lastPerDay = new Map<string, number>()
  for (const s of eligible) {
    const day = localDate(s.startAt, tz)
    const t = new Date(s.startAt).getTime()
    const last = lastPerDay.get(day)
    if (last === undefined || t - last >= spacingMs) {
      out.push(s)
      lastPerDay.set(day, t)
    }
  }
  return out
}
