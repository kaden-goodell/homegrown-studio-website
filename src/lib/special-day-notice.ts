import { CAFE_HOURS, CAFE_SPECIAL_DAYS, formatHours, formatRange } from '@config/hours'
import { localToUtcISO } from '@lib/party-slots'

/**
 * Announced Craft Café special days (CAFE_SPECIAL_DAYS entries with
 * `announce`), shaped for the site-wide bar and the big card. Pages are
 * prerendered, so each notice carries the instants it shows between and the
 * page's script decides on the visitor's clock.
 */
export interface DayNotice {
  date: string
  headline: string
  /** "SAT" */
  weekday: string
  /** "NOV 7" */
  monthDay: string
  /** "Sat Nov 7" */
  shortDate: string
  /** "9 AM – 8 PM" */
  hours: string
  /** "Saturdays 9 AM – 1 PM", the usual café hours, or '' when there are none. */
  regularHours: string
  /** Shown from this instant (midnight, `daysBefore` days ahead) … */
  showFromIso: string
  /** … until the café closes that day. */
  showUntilIso: string
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function dayParts(ymd: string): { weekday: string; month: string; day: number } {
  const [y, m, d] = ymd.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d, 12))
  return {
    weekday: at.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    month: at.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    day: d,
  }
}

/** "Saturdays 9 AM – 1 PM" from CAFE_HOURS. */
export function regularCafeHours(): string {
  return formatHours(CAFE_HOURS)
    .map((h) => `${h.days.replace(/day\b/g, 'days')} ${h.time}`)
    .join(', ')
}

export function cafeDayNotices(): DayNotice[] {
  return CAFE_SPECIAL_DAYS.filter((d) => d.announce)
    .map((d) => {
      const p = dayParts(d.date)
      return {
        date: d.date,
        headline: d.announce!.headline,
        weekday: p.weekday.toUpperCase(),
        monthDay: `${p.month.toUpperCase()} ${p.day}`,
        shortDate: `${p.weekday} ${p.month} ${p.day}`,
        hours: formatRange(d.opens, d.closes),
        regularHours: regularCafeHours(),
        showFromIso: localToUtcISO(addDays(d.date, -d.announce!.daysBefore), '00:00'),
        showUntilIso: localToUtcISO(d.date, d.closes),
      }
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1))
}

/** The notice showing at `now`: the earliest one whose window holds it. */
export function activeDayNotice(now: Date, notices: DayNotice[] = cafeDayNotices()): DayNotice | null {
  const t = now.getTime()
  return notices.find((n) => t >= Date.parse(n.showFromIso) && t < Date.parse(n.showUntilIso)) ?? null
}
