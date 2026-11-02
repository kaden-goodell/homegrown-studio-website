/**
 * Studio hours, as the site uses them until an owner first saves studio hours
 * on /admin (More › Hours & Craft Café › Studio hours); after that the saved
 * hours win (src/lib/studio-settings.ts → getStudioDays().studio). The footer
 * and the business details given to Google show the same list, so the two
 * can never disagree. The weekdays with hours are the days the studio opens.
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
 * top of (or instead of) CAFE_HOURS. Party times are kept off these days too
 * (see `partyFreeDays` in party.config.ts).
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
]

/** One weekday's Craft Café hours (the owner's "Saturday 9 AM – 12 PM" row). */
export interface CafeWeekly {
  weekday: Weekday
  /** HH:MM, 24-hour */
  opens: string
  /** HH:MM, 24-hour */
  closes: string
}

/**
 * Everything that says when Craft Café runs: the weekly rows and the special
 * days. Owners edit it on /admin (More › Hours & Craft Café); until they save,
 * it is exactly the config above (CONFIG_CAFE_HOURS).
 */
export interface CafeHours {
  weekly: CafeWeekly[]
  special: CafeSpecialDay[]
}

const rowsOf = (hours: HoursEntry[]): CafeWeekly[] => hours.flatMap((h) => h.days.map((weekday) => ({ weekday, opens: h.opens, closes: h.closes })))

export const CONFIG_CAFE_HOURS: CafeHours = {
  weekly: rowsOf(CAFE_HOURS),
  special: CAFE_SPECIAL_DAYS,
}

/** The studio's weekly hours as one row per open weekday (same shape as the café's rows). */
export const CONFIG_STUDIO_WEEKLY: CafeWeekly[] = rowsOf(STUDIO_HOURS)

export const WEEKDAYS: readonly Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Café hours on a date: a special day wins over the weekly hours. Null when
 * there's no café that day. Pass the loaded hours (`getCafeHours()` on the
 * server, the API payload in the browser); the default is the config.
 */
export function cafeHoursOn(ymd: string, cafe: CafeHours = CONFIG_CAFE_HOURS): { opens: string; closes: string } | null {
  const special = cafe.special.find((d) => d.date === ymd)
  if (special) return { opens: special.opens, closes: special.closes }
  const [y, m, d] = ymd.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const weekly = cafe.weekly.find((h) => h.weekday === weekday)
  return weekly ? { opens: weekly.opens, closes: weekly.closes } : null
}

/** The weekly rows as the site's hours list: days with the same hours share a row, in week order (Monday first). */
export function cafeHoursEntries(cafe: CafeHours = CONFIG_CAFE_HOURS): HoursEntry[] {
  return weeklyEntries(cafe.weekly)
}

/** Studio hours rows (getStudioDays().studio) as the site's hours list, like cafeHoursEntries. */
export function weeklyEntries(rows: CafeWeekly[]): HoursEntry[] {
  const order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const out: HoursEntry[] = []
  for (const w of [...rows].sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday))) {
    const same = out.find((e) => e.opens === w.opens && e.closes === w.closes)
    if (same) same.days.push(w.weekday)
    else out.push({ days: [w.weekday], opens: w.opens, closes: w.closes })
  }
  return out
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

/**
 * Craft Café's hours as customers read them, with noon and midnight by name
 * ("9 AM – noon", "Noon – 4 PM"), the same words /admin uses. Other times read
 * as formatRange.
 */
export function formatCafeRange(opens: string, closes: string): string {
  const word = (t: string) => (t.startsWith('00:00') ? 'midnight' : t.startsWith('12:00') ? 'noon' : null)
  if (!word(opens) && !word(closes)) return formatRange(opens, closes)
  const one = (t: string) => word(t) ?? (() => { const p = parts(t); return `${clock(p)} ${p.period}` })()
  const r = `${one(opens)} – ${one(closes)}`
  return r[0].toUpperCase() + r.slice(1)
}

/** formatHours for Craft Café (noon and midnight by name). */
export function formatCafeHours(hours: HoursEntry[]): { days: string; time: string }[] {
  return hours.map((h) => ({ days: joinDays(h.days), time: formatCafeRange(h.opens, h.closes) }))
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
