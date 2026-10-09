import { CAFE_HOURS } from '@config/hours'
import { OPEN_STUDIO_START_DATE } from '@config/opening'
import { studioOpenOn } from '@config/closures'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Does Craft Café run on this studio date (YYYY-MM-DD)? Its weekday, on/after the start date, not a closed day. */
export function cafeRunsOn(ymd: string): boolean {
  if (ymd < OPEN_STUDIO_START_DATE || !studioOpenOn(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return CAFE_HOURS.some((h) => h.days.includes(weekday))
}
