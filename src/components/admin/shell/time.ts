/**
 * The one way /admin writes times (fix round 1, R-A5): "6–8 PM",
 * "9 AM–12:30 PM", "All day". A no-break space before AM/PM, so a time
 * never breaks across lines.
 */
import { studioClock } from '@lib/studio-time'
import { localDate } from '@lib/party-slots'
import { dayLabel } from '../classes/dates'

const NBSP = ' '

function parts(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return { clock: `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}`, period: h < 12 ? 'AM' : 'PM' }
}

/** Midnight and noon by name (fix round 1): "12 AM" reads as a puzzle. */
const named = (hhmm: string) => (hhmm.startsWith('00:00') ? 'midnight' : hhmm.startsWith('12:00') ? 'noon' : null)

/** "13:30" → "1:30 PM"; "12:00" → "noon"; "00:00" → "midnight" */
export function clock(hhmm: string): string {
  const n = named(hhmm)
  if (n) return n
  const p = parts(hhmm)
  return `${p.clock}${NBSP}${p.period}`
}

/** "18:00","20:00" → "6–8 PM"; "09:00","12:30" → "9 AM–12:30 PM"; "09:00","12:00" → "9 AM–noon". The period shows once when both ends share it. */
export function clockRange(from: string, to: string): string {
  // At the start of a line it's "Noon–2 PM", not "noon–2 PM" (N7).
  if (named(from) || named(to)) { const r = `${clock(from)}–${clock(to)}`; return r[0].toUpperCase() + r.slice(1) }
  const a = parts(from), b = parts(to)
  return a.period === b.period ? `${a.clock}–${b.clock}${NBSP}${b.period}` : `${a.clock}${NBSP}${a.period}–${b.clock}${NBSP}${b.period}`
}

/** The same for two instants, in studio time. */
export function timeSpan(startIso: string, endIso: string): string {
  return clockRange(studioClock(startIso), studioClock(endIso))
}

/** "Fri Oct 23 · 6–8 PM", studio time. */
export function dayAndSpan(startIso: string, endIso: string): string {
  return `${dayLabel(localDate(startIso))} · ${timeSpan(startIso, endIso)}`
}

/** "Sat Oct 17 · 9:14 AM", studio time. */
export function dayAndClock(iso: string): string {
  return `${dayLabel(localDate(iso))} · ${clock(studioClock(iso))}`
}

/** A day ("2026-11-14") and an optional start ("13:00"): "Sat Nov 14 · 1 PM". */
export function dayAndStart(ymd: string, hhmm?: string): string {
  return `${dayLabel(ymd)}${hhmm ? ` · ${clock(hhmm)}` : ''}`
}
