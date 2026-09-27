/**
 * All customer/staff-facing times are studio-local (America/Chicago), always.
 *
 * Import from this module for any date/time display — never call toLocaleString
 * without an explicit timeZone option, or out-of-state viewers will see wrong times.
 */
import { partyConfig } from '@config/party.config'
import { localToUtcISO } from '@lib/party-slots'
import { formatTimeRange } from '@components/calendar/calendar-view-model'

const TZ = partyConfig.timezone // 'America/Chicago'

/** Advance a YYYY-MM-DD string by one calendar day. */
function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** "12:00 PM" — studio-local time only. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  })
}

/** "Sat, Aug 8" — studio-local day. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TZ,
  })
}

/** "Aug 8" — studio-local day, for a button or a short sentence. */
export function formatMonthDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })
}

/** "19:00" — studio-local wall clock. */
export function studioClock(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

/** "7–9 PM", "9:00 AM–12:30 PM" — studio-local, the one format used site-wide. */
export function formatTimeSpan(startIso: string, endIso: string): string {
  return formatTimeRange(studioClock(startIso), studioClock(endIso))
}

/** "Fri, Oct 16 · 7–9 PM" */
export function formatDayAndSpan(startIso: string, endIso: string): string {
  return `${formatDay(startIso)} · ${formatTimeSpan(startIso, endIso)}`
}

/** "Sat, Aug 8 · 12:00 PM CT" — slot labels on booking UI. */
export function formatSlotLabel(iso: string): string {
  const d = new Date(iso)
  const datePart = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: TZ,
  })
  return `${datePart} · ${formatTime(iso)} CT`
}

/** "Sat, Aug 8, 12:00 PM" — dashboard/console rows (no CT suffix). */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  })
}

/**
 * UTC instant range covering exactly one studio-local calendar day.
 *
 * Uses localToUtcISO for both midnight boundaries so DST-change days are
 * computed correctly (23 h on spring-forward, 25 h on fall-back) rather
 * than blindly adding 24 h.
 */
export function studioDayUtcRange(ymd: string): { startIso: string; endIso: string } {
  const startIso = localToUtcISO(ymd, '00:00')
  const nextMidnightMs = new Date(localToUtcISO(nextDay(ymd), '00:00')).getTime()
  const endIso = new Date(nextMidnightMs - 1).toISOString()
  return { startIso, endIso }
}
