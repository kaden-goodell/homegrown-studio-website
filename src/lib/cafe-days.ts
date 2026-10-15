import { cafeHoursOn } from '@config/hours'
import { OPEN_STUDIO_START_DATE } from '@config/opening'
import { studioOpenOn } from '@config/closures'

/** Does Craft Café run on this studio date (YYYY-MM-DD)? Its weekday or a special day, on/after the start date, not a closed day. */
export function cafeRunsOn(ymd: string): boolean {
  if (ymd < OPEN_STUDIO_START_DATE || !studioOpenOn(ymd)) return false
  return cafeHoursOn(ymd) !== null
}
