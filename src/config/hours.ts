/**
 * Studio hours. THE single source: the footer, homepage and Open Studio page
 * show `formatHours(STUDIO_HOURS)`, and the business details given to Google
 * are built from the same list, so the two can never disagree.
 *
 * 24-hour, studio-local (America/Chicago). Days not listed are closed.
 * Hours must cover every scheduled workshop (Sunday workshops run 6–8 PM).
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
  { days: ['Thursday'], opens: '18:00', closes: '20:00' }, // the 6–8 workshop only (Kaden, 1 Nov 2026)
  { days: ['Friday'], opens: '16:00', closes: '21:00' },
  { days: ['Saturday'], opens: '09:00', closes: '21:00' },
  { days: ['Sunday'], opens: '13:00', closes: '20:00' }, // first party 1:00, the 6–8 workshop ends at 8 (Kaden, 1 Nov 2026)
]

/**
 * Craft Café (walk-in) hours — a subset of the studio hours. Saturday
 * mornings only: the rest of the weekend is parties and workshops
 * (Kaden, 8 Oct 2026). Shown wherever the site says "walk-in hours".
 */
export const CAFE_HOURS: HoursEntry[] = [
  { days: ['Saturday'], opens: '09:00', closes: '13:00' }, // 9–1 (Kaden, 1 Nov 2026)
]

/**
 * One-off Craft Café days that replace the weekly hours for that date, on
 * top of (or instead of) CAFE_HOURS. A date may have more than one entry: each
 * is its own window (Sat Nov 28 runs 9–1 and 4–8). Party times keep an hour
 * clear of every window (CAFE_PARTY_GAP_MINUTES in party.config.ts).
 */
export interface CafeSpecialDay {
  /** Studio-local YYYY-MM-DD. */
  date: string
  /** HH:MM, 24-hour */
  opens: string
  /** HH:MM, 24-hour */
  closes: string
  name: string
  /**
   * Optional announcement: a slim bar on every page plus a big card on the
   * homepage and the Craft Café page, from `daysBefore` days ahead until the
   * café closes that day (see special-day-notice.ts). Leave it off for a
   * quiet special day.
   */
  announce?: { headline: string; daysBefore: number }
}

export const CAFE_SPECIAL_DAYS: CafeSpecialDay[] = [
  // Kaden, 15 Oct 2026: "Make craft cafe all day November 7th. We're going to
  // do a big giant grand opening." Kaden, 1 Nov 2026: 9 AM to 8 PM.
  {
    date: '2026-11-07', opens: '09:00', closes: '20:00', name: 'Craft Café grand opening',
    announce: { headline: 'Grand Opening Day', daysBefore: 21 },
  },
  // Kaden, 11 Nov 2026 (his flyer): café all weekend in place of the BYOB and
  // Sunday Swap classes he took down.
  { date: '2026-11-13', opens: '16:00', closes: '20:00', name: 'Craft Café' },
  { date: '2026-11-14', opens: '09:00', closes: '14:00', name: 'Craft Café' },
  { date: '2026-11-15', opens: '14:00', closes: '18:00', name: 'Craft Café' },
  // Kaden, 15 Nov 2026: Nov/Dec weekends are Craft Café in place of Friday and
  // Saturday parties (see partyNoDates in party.config.ts). Sat Nov 28 has two
  // windows around Laura's booked 1:30 party.
  { date: '2026-11-21', opens: '09:00', closes: '18:00', name: 'Craft Café' },
  // Kaden, 16 Nov 2026: Thanksgiving week, café 9–2 Mon–Wed (weeknight party
  // times at 6 stay open).
  { date: '2026-11-23', opens: '09:00', closes: '14:00', name: 'Craft Café' },
  { date: '2026-11-24', opens: '09:00', closes: '14:00', name: 'Craft Café' },
  { date: '2026-11-25', opens: '09:00', closes: '14:00', name: 'Craft Café' },
  { date: '2026-11-28', opens: '09:00', closes: '13:00', name: 'Craft Café' },
  { date: '2026-11-28', opens: '16:00', closes: '20:00', name: 'Craft Café' },
  { date: '2026-12-04', opens: '16:00', closes: '20:00', name: 'Craft Café' },
  { date: '2026-12-05', opens: '09:00', closes: '18:00', name: 'Craft Café' },
  { date: '2026-12-11', opens: '16:00', closes: '20:00', name: 'Craft Café' },
  // Kaden, 15 Nov 2026: café closes at 3 on Dec 12 to set up the 5:30 private event.
  { date: '2026-12-12', opens: '09:00', closes: '15:00', name: 'Craft Café' },
  { date: '2026-12-18', opens: '16:00', closes: '20:00', name: 'Craft Café' },
  { date: '2026-12-19', opens: '09:00', closes: '18:00', name: 'Craft Café' },
]

export interface CafeWindow {
  /** HH:MM, 24-hour */
  opens: string
  /** HH:MM, 24-hour */
  closes: string
}

/**
 * Every Craft Café window on a date, earliest first. Special days win over
 * the weekly hours (all of that date's entries). Empty when there's no café.
 */
export function cafeWindowsOn(ymd: string): CafeWindow[] {
  const special = CAFE_SPECIAL_DAYS.filter((d) => d.date === ymd)
    .map((d) => ({ opens: d.opens, closes: d.closes }))
    .sort((a, b) => (a.opens < b.opens ? -1 : 1))
  if (special.length) return special
  const [y, m, d] = ymd.split('-').map(Number)
  const weekday = (['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const)[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const weekly = CAFE_HOURS.find((h) => h.days.includes(weekday))
  return weekly ? [{ opens: weekly.opens, closes: weekly.closes }] : []
}

/**
 * The café's whole span on a date: first opening to last closing. Null when
 * there's no café. With two windows this covers the gap between them, so use
 * cafeWindowsOn for anything that needs the real hours.
 */
export function cafeHoursOn(ymd: string): CafeWindow | null {
  const windows = cafeWindowsOn(ymd)
  return windows.length ? { opens: windows[0].opens, closes: windows[windows.length - 1].closes } : null
}

/** "9 AM – 1 PM · 4 – 8 PM": every window on a date, for one line. */
export function formatWindows(windows: CafeWindow[]): string {
  return windows.map((w) => formatRange(w.opens, w.closes)).join(' · ')
}

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
