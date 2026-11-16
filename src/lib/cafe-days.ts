import { cafeWindowsOn } from '@config/hours'
import { OPEN_STUDIO_START_DATE } from '@config/opening'
import { closureOn } from '@config/closures'

/**
 * Does Craft Café run on this studio date (YYYY-MM-DD)? Its weekday or a special
 * day, on/after the start date, not a closed day. A special day counts even on
 * a weekday the studio isn't usually open (Thanksgiving week Mon–Wed, 9–2).
 */
export function cafeRunsOn(ymd: string): boolean {
  if (ymd < OPEN_STUDIO_START_DATE || closureOn(ymd)) return false
  return cafeWindowsOn(ymd).length > 0
}
