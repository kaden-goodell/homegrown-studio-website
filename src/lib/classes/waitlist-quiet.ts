/**
 * Final customer review I12: the waitlist charges a saved card and texts
 * "you're in" only between 8 AM and 8 PM studio time (America/Chicago). A seat
 * freed at 11:40 PM waits: nobody is charged or texted at midnight, and the
 * every-10-minutes sweep picks it up from 8 AM. Client-safe.
 */
import { studioClock } from '@lib/studio-time'

export const WAITLIST_DAY_STARTS = 8 // 8:00 AM
export const WAITLIST_DAY_ENDS = 20 // 8:00 PM

/** Outside 8 AM–8 PM in Chicago: no waitlist charges or texts now. */
export function waitlistQuietNow(now: Date): boolean {
  const hour = Number(studioClock(now.toISOString()).slice(0, 2))
  return hour < WAITLIST_DAY_STARTS || hour >= WAITLIST_DAY_ENDS
}

export const QUIET_NOTE = 'It’s outside 8 AM to 8 PM, so nobody on the waitlist is charged or texted now. It picks up again at 8 AM.'
