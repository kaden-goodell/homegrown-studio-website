/**
 * Days the studio is closed, on top of the usual Monday to Wednesday.
 *
 * A closed day has no party times: the booking panel does not offer it, the
 * server refuses it, the calendar marks it, and nobody who asked to be told
 * about a date is emailed about it. To close more days, add a line here.
 *
 * Client-safe: no imports, no env.
 */
export interface Closure {
  /** First closed day, studio-local YYYY-MM-DD. */
  from: string
  /** Last closed day, studio-local YYYY-MM-DD (included). */
  to: string
  /** Completes "Closed for …". */
  name: string
  /** Dresses the calendar for the occasion. Without one, the days look like any closed day. */
  holiday?: Holiday
}

/** The holidays the calendar knows how to dress up for (colours in global.css). */
export type Holiday = 'halloween' | 'thanksgiving' | 'christmas'

export const closures: Closure[] = [
  // Kaden, 27 Sep 2026: closed Friday to Sunday of Halloween weekend, and from
  // 21 December to New Year's Day, opening again on Saturday 2 January.
  { from: '2026-10-30', to: '2026-11-01', name: 'Halloween weekend', holiday: 'halloween' },
  // Kaden, 9 Oct 2026: closed Thanksgiving weekend, Thursday to Sunday.
  { from: '2026-11-26', to: '2026-11-29', name: 'Thanksgiving weekend', holiday: 'thanksgiving' },
  { from: '2026-12-21', to: '2027-01-01', name: 'the Christmas holidays', holiday: 'christmas' },
]

/** The studio opens Thursday to Sunday (0 = Sunday). */
export const OPEN_WEEKDAYS: ReadonlySet<number> = new Set([0, 4, 5, 6])

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}

function dayAfter(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10)
}

/** The closure covering this day, if there is one. */
export function closureOn(ymd: string, list: Closure[] = closures): Closure | null {
  // YYYY-MM-DD strings compare lexically.
  return list.find((c) => ymd >= c.from && ymd <= c.to) ?? null
}

/** Open for business: a usual open weekday that is not inside a closure. */
export function studioOpenOn(ymd: string, list: Closure[] = closures): boolean {
  return OPEN_WEEKDAYS.has(weekdayOf(ymd)) && !closureOn(ymd, list)
}

/** Every day of a closure, first to last. */
export function daysOf(closure: Closure): string[] {
  const days: string[] = []
  // The bound only guards a bad list: no closure runs for a year.
  for (let day = closure.from; day <= closure.to && days.length < 366; day = dayAfter(day)) days.push(day)
  return days
}

/** The first open day after a closure ends. */
export function reopensOn(closure: Closure, list: Closure[] = closures): string {
  let day = dayAfter(closure.to)
  // A year of days is far more than any run of closures; the bound only guards a bad list.
  for (let i = 0; i < 366 && !studioOpenOn(day, list); i++) day = dayAfter(day)
  return day
}
