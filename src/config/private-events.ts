/**
 * Private events the studio has taken by hand (not booked through the site).
 * Each shows on the public calendar as "Private Event" at its time, with no
 * name or details. Times are studio-local.
 *
 * Client-safe: no imports, no env.
 */
export interface PrivateEvent {
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, 24-hour */
  startTime: string
  /** HH:MM, 24-hour */
  endTime: string
}

export const privateEvents: PrivateEvent[] = [
  // Kaden, 15 Nov 2026: private event Sat Dec 12 from 5:30 (no set end; show 9).
  // Kirkland Kristmas was taken off that night; the café closes at 3 to set up.
  { date: '2026-12-12', startTime: '17:30', endTime: '21:00' },
]
