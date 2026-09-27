/**
 * Studio hours. THE single source: the footer, homepage and Open Studio page
 * show `formatHours(STUDIO_HOURS)`, and the business details given to Google
 * are built from the same list, so the two can never disagree.
 *
 * 24-hour, studio-local (America/Chicago). Days not listed are closed.
 * Hours must cover every scheduled workshop (Sunday workshops run 7–9 PM).
 *
 * Client-safe: no imports, no env.
 */
export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'

export interface HoursEntry {
  days: Weekday[]
  /** HH:MM, 24-hour */
  opens: string
  /** HH:MM, 24-hour */
  closes: string
}

export const STUDIO_HOURS: HoursEntry[] = [
  { days: ['Thursday', 'Friday'], opens: '16:00', closes: '21:00' },
  { days: ['Saturday'], opens: '09:00', closes: '21:00' },
  { days: ['Sunday'], opens: '14:00', closes: '21:00' },
]

function parts(hhmm: string): { hour: number; minute: string; period: 'AM' | 'PM' } {
  const [h, m] = hhmm.split(':').map(Number)
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: String(m).padStart(2, '0'), period: h < 12 ? 'AM' : 'PM' }
}

const clock = (p: ReturnType<typeof parts>) => (p.minute === '00' ? `${p.hour}` : `${p.hour}:${p.minute}`)

/** "4 – 9 PM", "9 AM – 9 PM", "9:30 AM – 12 PM". The period shows once when both ends share it. */
export function formatRange(opens: string, closes: string): string {
  const a = parts(opens)
  const b = parts(closes)
  return a.period === b.period
    ? `${clock(a)} – ${clock(b)} ${b.period}`
    : `${clock(a)} ${a.period} – ${clock(b)} ${b.period}`
}

function joinDays(days: Weekday[]): string {
  if (days.length <= 1) return days.join('')
  if (days.length === 2) return `${days[0]} & ${days[1]}`
  return `${days.slice(0, -1).join(', ')} & ${days[days.length - 1]}`
}

/** The display form used across the site: [{ days: 'Thursday & Friday', time: '4 – 9 PM' }, …] */
export function formatHours(hours: HoursEntry[]): { days: string; time: string }[] {
  return hours.map((h) => ({ days: joinDays(h.days), time: formatRange(h.opens, h.closes) }))
}
