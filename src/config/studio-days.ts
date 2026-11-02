/**
 * When the studio is open, when it's shut and when Craft Café runs: the
 * studio's weekly hours, the closed days and the café hours, as one value the
 * date rules take. Owners edit all three on /admin; the server loads them
 * (src/lib/studio-settings.ts → getStudioDays()) and hands them to these pure
 * rules, and pages in the browser get them in their API payload. Until an
 * owner first saves, it is exactly the config (CONFIG_STUDIO_DAYS), so the
 * site behaves as it always has.
 *
 * Client-safe: no env, no server imports.
 */
import { closureOn, closures, type Closure } from './closures'
import { CONFIG_CAFE_HOURS, CONFIG_STUDIO_WEEKLY, WEEKDAYS, type CafeHours, type CafeWeekly } from './hours'

export interface StudioDays {
  closures: Closure[]
  cafe: CafeHours
  /** The studio's weekly hours, one row per open weekday. A weekday with no row is closed. */
  studio: CafeWeekly[]
}

export const CONFIG_STUDIO_DAYS: StudioDays = { closures, cafe: CONFIG_CAFE_HOURS, studio: CONFIG_STUDIO_WEEKLY }

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

/** The weekdays (0 = Sunday) the studio opens: the ones with hours. */
export function openWeekdaysOf(studio: CafeWeekly[] | undefined = CONFIG_STUDIO_WEEKLY): Set<number> {
  return new Set((studio ?? CONFIG_STUDIO_WEEKLY).map((w) => WEEKDAYS.indexOf(w.weekday)).filter((n) => n >= 0))
}

/** The studio's hours on a weekday (0 = Sunday), or null when it's usually closed. */
export function studioHoursOnWeekday(weekday: number, studio: CafeWeekly[] | undefined = CONFIG_STUDIO_WEEKLY): { opens: string; closes: string } | null {
  const row = (studio ?? CONFIG_STUDIO_WEEKLY).find((w) => w.weekday === WEEKDAYS[weekday])
  return row ? { opens: row.opens, closes: row.closes } : null
}

/**
 * Open for business on this date: a weekday with studio hours, or a Craft
 * Café special day (a special day opens the studio that day, even on a
 * usually closed weekday), and never inside a closed day.
 */
export function isStudioOpenOn(ymd: string, days: StudioDays = CONFIG_STUDIO_DAYS): boolean {
  if (closureOn(ymd, days.closures)) return false
  if (openWeekdaysOf(days.studio).has(weekdayOf(ymd))) return true
  return days.cafe.special.some((d) => d.date === ymd)
}
