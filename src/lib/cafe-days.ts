import { cafeHoursOn } from '@config/hours'
import { OPEN_STUDIO_START_DATE } from '@config/opening'
import { CONFIG_STUDIO_DAYS, isStudioOpenOn, type StudioDays } from '@config/studio-days'

/**
 * Does Craft Café run on this studio date (YYYY-MM-DD)? Its weekday (on a day
 * the studio opens) or a special day (any day of the week: a special day opens
 * the studio, whenever it falls), weekly days on/after the start date, never on a closed day. Pass the loaded
 * studio days (getStudioDays() on the server, the API payload in the
 * browser); the default is the config.
 */
export function cafeRunsOn(ymd: string, days: StudioDays = CONFIG_STUDIO_DAYS): boolean {
  // A special day the owners added runs whenever it falls, even before the start date (UI review, 3 Nov:
  // a "Tue Nov 3 pop-up café" was on the website but missing from /admin and /staff).
  if ((ymd < OPEN_STUDIO_START_DATE && !isSpecialCafeDay(ymd, days)) || !isStudioOpenOn(ymd, days)) return false
  return cafeHoursOn(ymd, days.cafe) !== null
}

/** An owner-added special café day on this date. */
export function isSpecialCafeDay(ymd: string, days: StudioDays = CONFIG_STUDIO_DAYS): boolean {
  return days.cafe.special.some((s) => s.date === ymd)
}

/** Café hours on a date when it runs, else null: cafeRunsOn and cafeHoursOn together. */
export function cafeOn(ymd: string, days: StudioDays = CONFIG_STUDIO_DAYS): { opens: string; closes: string } | null {
  return cafeRunsOn(ymd, days) ? cafeHoursOn(ymd, days.cafe) : null
}
