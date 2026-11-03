import { cafeHoursOn } from '@config/hours'
import { OPEN_STUDIO_START_DATE } from '@config/opening'
import { CONFIG_STUDIO_DAYS, isStudioOpenOn, type StudioDays } from '@config/studio-days'

/**
 * Does Craft Café run on this studio date (YYYY-MM-DD)? Its weekday (on a day
 * the studio opens) or a special day (any day of the week: a special day opens
 * the studio), on/after the start date, not a closed day. Pass the loaded
 * studio days (getStudioDays() on the server, the API payload in the
 * browser); the default is the config.
 */
export function cafeRunsOn(ymd: string, days: StudioDays = CONFIG_STUDIO_DAYS): boolean {
  if (ymd < OPEN_STUDIO_START_DATE || !isStudioOpenOn(ymd, days)) return false
  return cafeHoursOn(ymd, days.cafe) !== null
}

/** Café hours on a date when it runs, else null: cafeRunsOn and cafeHoursOn together. */
export function cafeOn(ymd: string, days: StudioDays = CONFIG_STUDIO_DAYS): { opens: string; closes: string } | null {
  return cafeRunsOn(ymd, days) ? cafeHoursOn(ymd, days.cafe) : null
}
