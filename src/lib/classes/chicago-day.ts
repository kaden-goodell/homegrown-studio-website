/**
 * "Until a date" means the end of that day in Chicago (the studio's day).
 * Promo code last days and early-bird end dates both use this.
 *
 * Pure and browser-safe: Intl only, no imports.
 */
const TZ = 'America/Chicago'
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

/** The studio's calendar day (YYYY-MM-DD) at `now`. */
export function chicagoYmd(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** A real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !YMD_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Still on or before `lastYmd` in Chicago at `now` (so it works all of that day). */
export function onOrBeforeDay(lastYmd: string, now: Date): boolean {
  return chicagoYmd(now) <= lastYmd
}

/** "Fri Oct 30" from YYYY-MM-DD (calendar math only, no time zone). */
export function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .replace(',', '')
}
