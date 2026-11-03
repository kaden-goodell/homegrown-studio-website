/**
 * Repeating dates (stage 4): the days a class repeats on, worked out from the
 * class as entered and a pattern (every week, every 2 weeks, or picked days),
 * each copy at the same Chicago wall-clock times. A copy is a separate class
 * (S4-R6); the server makes them one by one (admin-actions repeatClass).
 *
 * Pure and browser-safe: Intl only, type imports only. All instants are UTC
 * ISO; shifting keeps the studio's local start and end, so a 6 PM class stays
 * 6 PM across a clock change (its UTC hour moves instead).
 */
import { chicagoYmd } from './chicago-day'
import type { EarlyBird, Session } from './types'
import type { Result } from './validate'

export type RepeatPattern = { every: 1 | 2; untilYmd: string } | { dates: string[] }

/** Most dates one repeat makes, the class as entered included. */
export const MAX_REPEATS = 26

export const TOO_MANY = `Repeat up to ${MAX_REPEATS} dates at a time.`
export const UNTIL_BEFORE_FIRST = 'Pick an until date after the first date.'
export const UNTIL_PAST = 'Pick an until date from today on.'
export const PICK_A_DATE = 'Pick at least one more date.'
export const BAD_PATTERN = 'Pick how it repeats.'

const TZ = 'America/Chicago'
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Chicago wall clock of an instant: day and minutes since midnight. */
function wallOf(iso: string): { ymd: string; h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(iso))
  const p: Record<string, string> = {}
  for (const x of parts) p[x.type] = x.value
  return { ymd: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) % 24, m: Number(p.minute) }
}

/** Chicago's offset from UTC at an instant, in ms (−5 h in summer, −6 h in winter). */
function offsetAt(ms: number): number {
  const w = wallOf(new Date(ms).toISOString())
  const [y, mo, d] = w.ymd.split('-').map(Number)
  const seen = Date.UTC(y, mo - 1, d, w.h, w.m)
  return seen - Math.floor(ms / 60_000) * 60_000
}

/**
 * A Chicago wall-clock time as a UTC instant. Two passes, so a time just after
 * the clock change uses the offset in force then, not the one at midnight.
 */
export function chicagoToIso(ymd: string, h: number, m: number): string {
  const [y, mo, d] = ymd.split('-').map(Number)
  const asUtc = Date.UTC(y, mo - 1, d, h, m)
  let guess = asUtc - offsetAt(asUtc)
  guess = asUtc - offsetAt(guess)
  return new Date(guess).toISOString()
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (YYYY-MM-DD, calendar math). */
function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

function shiftIso(iso: string, days: number): string {
  const w = wallOf(iso)
  return chicagoToIso(addDaysYmd(w.ymd, days), w.h, w.m)
}

/** The class's first day (Chicago) — what a pattern counts from. */
export function firstDayOf(sessions: Session[]): string {
  const first = sessions.reduce((a, s) => (s.startIso < a.startIso ? s : a), sessions[0])
  return wallOf(first.startIso).ymd
}

/**
 * Every session moved by `days` whole local days, keeping its local start and
 * end. Copies get no session id (the server gives them new ones); the class
 * as entered (days = 0) keeps its own.
 */
export function shiftSessions(sessions: Session[], days: number): Session[] {
  if (days === 0) return sessions.map((s) => ({ ...s }))
  return sessions.map((s) => ({ id: '', startIso: shiftIso(s.startIso, days), endIso: shiftIso(s.endIso, days), capacity: s.capacity }))
}

/** A pattern as sent by the browser, checked. */
export function readPattern(raw: unknown): Result<RepeatPattern> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: BAD_PATTERN }
  const r = raw as Record<string, unknown>
  if (Array.isArray(r.dates)) {
    if (!r.dates.every(isYmd)) return { ok: false, error: 'One of the picked dates isn’t a real date.' }
    return { ok: true, value: { dates: r.dates as string[] } }
  }
  if ((r.every === 1 || r.every === 2) && isYmd(r.untilYmd)) return { ok: true, value: { every: r.every, untilYmd: r.untilYmd } }
  if (r.every === 1 || r.every === 2) return { ok: false, error: 'Pick an until date.' }
  return { ok: false, error: BAD_PATTERN }
}

/**
 * The dates a class repeats on. The first is always the class as entered;
 * every week / every 2 weeks runs while the copy's first day is on or before
 * `untilYmd` (Chicago); picked dates are first-session days, sorted, with
 * repeats and the entered day itself dropped. Multi-session classes (a camp)
 * move every session together. Past dates are not removed here: the preview
 * shows them as passed and the server refuses them (R37).
 */
export function repeatDates(firstSessions: Session[], pattern: RepeatPattern, todayYmd: string): Result<{ ymd: string; sessions: Session[] }[]> {
  if (!firstSessions.length) return { ok: false, error: 'Add a date.' }
  const first = firstDayOf(firstSessions)
  let offsets: number[]
  if ('dates' in pattern) {
    const picked = [...new Set(pattern.dates.filter(isYmd))].filter((d) => d !== first).sort()
    if (!picked.length) return { ok: false, error: PICK_A_DATE }
    offsets = [0, ...picked.map((d) => daysBetween(first, d))]
    if (offsets.length > MAX_REPEATS) return { ok: false, error: TOO_MANY }
  } else {
    if (!isYmd(pattern.untilYmd)) return { ok: false, error: 'Pick an until date.' }
    if (pattern.untilYmd < todayYmd) return { ok: false, error: UNTIL_PAST }
    if (pattern.untilYmd <= first) return { ok: false, error: UNTIL_BEFORE_FIRST }
    const step = pattern.every * 7
    const span = daysBetween(first, pattern.untilYmd)
    if (Math.floor(span / step) + 1 > MAX_REPEATS) return { ok: false, error: TOO_MANY }
    offsets = []
    for (let k = 0; k * step <= span; k++) offsets.push(k * step)
  }
  return { ok: true, value: offsets.map((o) => ({ ymd: addDaysYmd(first, o), sessions: shiftSessions(firstSessions, o) })).sort((a, b) => (a.ymd < b.ymd ? -1 : a.ymd > b.ymd ? 1 : 0)) }
}

/**
 * The early-bird moved to the same number of days before another date (M6):
 * ends 7 days before Nov 17 → ends 7 days before Dec 15. Null when that day
 * has already passed (the regular price is all that date has left).
 */
export function shiftEarlyBird(eb: EarlyBird | null | undefined, fromStartIso: string, toStartIso: string, now = new Date()): EarlyBird | null {
  if (!eb) return null
  const from = chicagoYmd(new Date(fromStartIso)), to = chicagoYmd(new Date(toStartIso))
  const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
  const until = addDaysYmd(eb.untilYmd, days)
  return until < chicagoYmd(now) ? null : { ...eb, untilYmd: until }
}
