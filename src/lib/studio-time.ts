/**
 * All customer/staff-facing times are studio-local (America/Chicago), always.
 *
 * Import from this module for any date/time display — never call toLocaleString
 * without an explicit timeZone option, or out-of-state viewers will see wrong times.
 */
import { partyConfig } from '@config/party.config'
import { localToUtcISO } from '@lib/party-slots'

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
