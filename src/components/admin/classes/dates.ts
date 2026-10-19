/** Studio-day arithmetic for the admin screens. Days are YYYY-MM-DD in studio time. */
import { localDate, localToUtcISO } from '@lib/party-slots'
import { studioClock } from '@lib/studio-time'

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

/** 0 = Sunday. */
export const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay()

export const today = (now = new Date()) => localDate(now.toISOString())

/** The Sunday on or before the day. */
export const weekStart = (ymd: string) => addDays(ymd, -weekday(ymd))

/** The Monday on or before the day: /admin's weeks run Monday to Sunday, so a weekend stays together. */
export const weekStartMonday = (ymd: string) => addDays(ymd, -((weekday(ymd) + 6) % 7))

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`
}

export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1, 12)).toISOString().slice(0, 10)
}

/** Studio midnight at the start of the day, as UTC ISO. */
export const dayStartIso = (ymd: string) => localToUtcISO(ymd, '00:00')

/** A studio day and wall-clock time ("14:30") as UTC ISO. */
export const toIsoAt = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)

/** The studio day and wall clock of an instant. */
export function partsOf(iso: string): { day: string; time: string } {
  return { day: localDate(iso), time: studioClock(iso) }
}

/** "Wed Mar 12" */
export function dayLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
}

/** "March 2031" */
export function monthLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' })
}
