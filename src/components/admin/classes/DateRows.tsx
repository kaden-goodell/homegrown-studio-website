import type { Session } from '@lib/classes/types'
import { newId } from '@lib/classes/validate'
import { addDays, partsOf, today, toIsoAt } from './dates'

/**
 * One date a class meets on, as typed. `minutes` is the row's own length:
 * when the day or start moves, the end moves with it and the length stays;
 * typing an end sets a new length. `id` is the session's id: a saved date
 * keeps its own (so a booked date is moved, not replaced); a new one gets a
 * fresh one, so a "Set dates" way to book can name it before it is saved.
 */
export interface DateRow { key: string; id: string; day: string; start: string; end: string; capacity: string; minutes: number }

let seq = 0
const key = () => `d${++seq}`

/** Minutes from start to end on one day; 0 when the end isn't after the start. */
export function lengthOf(day: string, start: string, end: string): number {
  if (!day || !start || !end || end <= start) return 0
  return Math.round((Date.parse(toIsoAt(day, end)) - Date.parse(toIsoAt(day, start))) / 60_000)
}

/** The wall clock `minutes` after `start` on `day` ("20:30"). */
export function endAfter(day: string, start: string, minutes: number): string {
  return partsOf(new Date(Date.parse(toIsoAt(day, start)) + minutes * 60_000).toISOString()).time
}

export function newDateRow(r: { day: string; start: string; end: string; capacity: string | number; id?: string }): DateRow {
  return { key: key(), id: r.id ?? newId('ses'), day: r.day, start: r.start, end: r.end, capacity: String(r.capacity), minutes: lengthOf(r.day, r.start, r.end) }
}

/** The rows for a class's saved dates. */
export function rowsOf(sessions: Session[]): DateRow[] {
  return sessions.map((s) => newDateRow({ id: s.id, day: partsOf(s.startIso).day, start: partsOf(s.startIso).time, end: partsOf(s.endIso).time, capacity: s.capacity }))
}

/** Run it again: the same dates a week on, same times and seats, as new dates. */
export function weekLater(sessions: Session[]): DateRow[] {
  return rowsOf(sessions).map((r) => ({ ...r, key: key(), id: newId('ses'), day: addDays(r.day, 7) }))
}

/**
 * Copied dates that would start before `from` move forward by whole weeks
 * until the first is on or after it, keeping each weekday, time and the gaps
 * between them (R37: Run it again never starts in the past).
 */
export function onOrAfter(rows: DateRow[], from: string, closed: (day: string) => boolean = () => false): DateRow[] {
  if (!rows.length) return rows
  let weeks = 0
  // Also past a closed day (a holiday) for the first date.
  while ((addDays(rows[0].day, weeks * 7) < from || closed(addDays(rows[0].day, weeks * 7))) && weeks < 520) weeks++
  return weeks ? rows.map((r) => ({ ...r, day: addDays(r.day, weeks * 7) })) : rows
}

/** The next date after the last one: a week later, same times and seats. */
function after(last: DateRow): DateRow {
  return { ...last, key: key(), id: newId('ses'), day: addDays(last.day, 7) }
}

export type Checked = { ok: true; sessions: { id: string; startIso: string; endIso: string; capacity: number }[] } | { ok: false; error: string }

/** The rows as sessions for the server, or the first thing to fix. */
export function checkRows(rows: DateRow[]): Checked {
  if (!rows.length) return { ok: false, error: 'Add a date.' }
  const sessions = []
  for (const r of rows) {
    if (!r.day || !r.start || !r.end) return { ok: false, error: 'Each date needs a day, a start and an end.' }
    if (r.end <= r.start) return { ok: false, error: 'A date has to end after it starts.' }
    const cap = /^\d+$/.test(r.capacity.trim()) ? Number(r.capacity.trim()) : 0
    if (cap < 1 || cap > 999) return { ok: false, error: 'Seats is 1 to 999.' }
    sessions.push({ id: r.id, startIso: toIsoAt(r.day, r.start), endIso: toIsoAt(r.day, r.end), capacity: cap })
  }
  return { ok: true, sessions }
}

/** Rows compared by what was typed, not their React keys. */
export const sameRows = (a: DateRow[], b: DateRow[]) =>
  a.length === b.length && a.every((r, i) => r.id === b[i].id && r.day === b[i].day && r.start === b[i].start && r.end === b[i].end && r.capacity.trim() === b[i].capacity.trim())

/**
 * The one way /admin picks dates (Dates tab, New class, Run it again): each
 * date is a fieldset "Date N" with Day · Starts · Ends · Seats; the end
 * follows the start, keeping the length; "+ Add another date" adds one a
 * week after the last.
 */
export default function DateRows({ rows, onChange, error, disabled, booked }: {
  rows: DateRow[]
  onChange: (rows: DateRow[]) => void
  /** A refusal about the dates (a clash, a bad time), shown right under them. */
  error?: string
  disabled?: boolean
  /** Seats taken on each saved date (by session id): shown on the date, so moving or removing it is never a surprise. */
  booked?: Record<string, number>
}) {
  function set(i: number, patch: Partial<DateRow>) {
    onChange(rows.map((r, n) => {
      if (n !== i) return r
      const next = { ...r, ...patch }
      if ((patch.start !== undefined || patch.day !== undefined) && next.day && next.start && next.minutes > 0) next.end = endAfter(next.day, next.start, next.minutes)
      if (patch.end !== undefined) next.minutes = lengthOf(next.day, next.start, next.end) || r.minutes
      return next
    }))
  }
  return (
    <div className="adm-dates" data-field="dates">
      {rows.map((r, i) => (
        <fieldset key={r.key} className="adm-date" disabled={disabled}>
          <legend>{`Date ${i + 1}`}</legend>
          {!!booked?.[r.id] && !disabled && <p className="adm-small adm-warntext adm-datebooked">{`${booked[r.id]} booked on this date. Moving it asks first; it can’t be removed while people are booked.`}</p>}
          <div className="adm-two">
            <label className="adm-fld"><span>Day</span><input type="date" value={r.day} onChange={(e) => set(i, { day: e.target.value })} /></label>
            <label className="adm-fld"><span>Seats</span><input inputMode="numeric" value={r.capacity} onChange={(e) => set(i, { capacity: e.target.value })} /></label>
          </div>
          <div className="adm-two">
            <label className="adm-fld"><span>Starts</span><input type="time" value={r.start} onChange={(e) => set(i, { start: e.target.value })} /></label>
            <label className="adm-fld"><span>Ends</span><input type="time" value={r.end} onChange={(e) => set(i, { end: e.target.value })} /></label>
          </div>
          {rows.length > 1 && !disabled && (booked?.[r.id]
            ? <p className="adm-small adm-muted">Has bookings</p>
            : <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onChange(rows.filter((_, n) => n !== i))}>{`Remove date ${i + 1}`}</button>)}
        </fieldset>
      ))}
      {error && <p role="alert" className="adm-error adm-fielderr">{error}</p>}
      {!disabled && (
        <button type="button" className="adm-btn is-ghost" onClick={() => onChange([...rows, after(rows[rows.length - 1] ?? newDateRow({ day: addDays(today(), 7), start: '18:00', end: '20:00', capacity: 12 }))])}>
          + Add another date
        </button>
      )}
      {rows.length > 1 && <p className="adm-small adm-muted">More than one date makes one class that meets on each of them.</p>}
    </div>
  )
}
