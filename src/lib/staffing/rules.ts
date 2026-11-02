/**
 * Staffing rules (stage 3). Pure and browser-safe: the /admin and /staff
 * screens use the same answers the server does.
 *
 *   eventKeyOf        a shared-schedule entry → its staffing key (or null: café,
 *                     blocked time and closed days are not staffable, S3-R2)
 *   verdict           can this person work this event, by their marks, in real
 *                     instants (a Chicago clock change can't shift a mark)
 *   neededFor         people wanted on it (OWNER-3: 1 for a class session or a
 *                     party unless an owner changed it; 0 = nobody, no warning)
 *   staffedState      staffed / short / none
 *   validateAvailability  what a person saves about when they can work
 *   movedSince        the event's times differ from when it was last seen
 */
import { localDate, localToUtcISO } from '../parties/party-times'
import type { Result } from '../classes/validate'
import type { Ask, Assignment, Availability, DayMark, EventKey, StaffableEvent, StaffableKind, StaffedState, StaffingEntry, TimeRange, Verdict } from './types'

export const DEFAULT_NEEDED: Readonly<Record<StaffableKind, number>> = { class: 1, party: 1, 'legacy-class': 1 }
export const MAX_NEEDED = 6
export const MAX_MARKS_PER_DAY = 4
export const MAX_NOTE = 120
export const DATE_WINDOW_DAYS = 365
/** Dates in one save (a year of days, with room to spare); more is refused before any work. */
export const MAX_DATES = 400

// ---------------------------------------------------------------- keys

const KEY_RE = /^(ses|party|legacy):[A-Za-z0-9_-]{1,100}$/

/** A well-formed staffing key (API input check). */
export function isEventKey(v: unknown): v is EventKey {
  return typeof v === 'string' && KEY_RE.test(v)
}

/** class → ses:<sessionId>, party → party:<id>, legacy-class → legacy:<id>; anything else (or a bad id) → null. */
export function eventKeyOf(b: { kind: string; id: string; sessionId?: string }): EventKey | null {
  let key: string | null = null
  if (b.kind === 'class') key = b.sessionId ? `ses:${b.sessionId}` : null
  else if (b.kind === 'party') key = `party:${b.id}`
  else if (b.kind === 'legacy-class') key = `legacy:${b.id}`
  return key && isEventKey(key) ? key : null
}

// ---------------------------------------------------------------- days and times

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

const weekdayOf = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number)
  return String(new Date(Date.UTC(y, m - 1, d)).getUTCDay())
}

/** "Sat, Oct 31" from a YYYY-MM-DD. */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Real instants [start, end) of a mark on a studio-local day. */
function markSpan(day: string, range: TimeRange | null): [number, number] {
  const next = Date.parse(localToUtcISO(addDays(day, 1), '00:00'))
  if (!range) return [Date.parse(localToUtcISO(day, '00:00')), next]
  const end = range.to === '24:00' ? next : Date.parse(localToUtcISO(day, range.to))
  return [Date.parse(localToUtcISO(day, range.from)), end]
}

/**
 * The marks in force on a day: that date's marks when it has any, else the
 * usual week's mark. When the date only has "can't, these hours" marks, the
 * usual week still holds for the rest of the day (usually Can on Saturdays +
 * "Nov 7 can't 9–12, dentist" → a 1:30 party that day is still Can).
 */
function marksOn(a: Availability, day: string): DayMark[] {
  const dated = a.dates?.[day]
  const w = a.weekly?.[weekdayOf(day)]
  if (dated && dated.length > 0) {
    const onlyHoursOff = dated.every((m) => m.kind === 'cant' && m.range)
    return onlyHoursOff && w ? [...dated, w] : dated
  }
  return w ? [w] : []
}

/**
 * Can this person work this event? A "can't" touching any minute of it →
 * cant; "can" covering all of it → can; covering part → partly; "can, only
 * some hours" on that day that doesn't touch it at all → outside (they gave
 * hours, and this isn't in them: neither Can't nor Not said); no mark →
 * unknown. An event touching two studio days checks both.
 */
export function verdict(a: Availability | null, ev: { startIso: string; endIso: string }): Verdict {
  return verdictWithNote(a, ev).verdict
}

/** "4–9 PM", "9 AM–1 PM", "4:30–9 PM", "8 PM–Midnight" (studio-local hours, in words). */
export function hoursWords(r: TimeRange): string {
  const part = (hhmm: string) => {
    if (hhmm === '24:00' || hhmm === '00:00') return { text: 'Midnight', suffix: '' }
    const [h, m] = hhmm.split(':').map(Number)
    const h12 = h % 12 === 0 ? 12 : h % 12
    return { text: m ? `${h12}:${String(m).padStart(2, '0')}` : String(h12), suffix: h >= 12 ? 'PM' : 'AM' }
  }
  const a = part(r.from), b = part(r.to)
  const end = b.suffix ? `${b.text} ${b.suffix}` : b.text
  if (a.suffix && a.suffix === b.suffix) return `${a.text}–${end}`
  return `${a.suffix ? `${a.text} ${a.suffix}` : a.text}–${end}`
}

/**
 * verdict, plus the note on the "can't" mark that decided it ("dentist"),
 * plus `hours`: the hours they gave in words ("4–9 PM") when the verdict is
 * outside or partly ('' otherwise), for owner screens.
 */
export function verdictWithNote(a: Availability | null, ev: { startIso: string; endIso: string }): { verdict: Verdict; note: string; hours: string } {
  const none = { verdict: 'unknown' as Verdict, note: '', hours: '' }
  if (!a) return none
  const s = Date.parse(ev.startIso), e = Date.parse(ev.endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return none
  const first = localDate(ev.startIso)
  const last = localDate(new Date(e - 1).toISOString())
  const cans: [number, number][] = []
  const given: string[] = []
  for (let day = first, i = 0; day <= last && i < 3; day = addDays(day, 1), i++) {
    for (const m of marksOn(a, day)) {
      const [ms, me] = markSpan(day, m.range)
      if (m.kind === 'cant') {
        if (ms < e && me > s) return { verdict: 'cant', note: m.note ?? '', hours: '' }
      } else {
        if (m.range) { const w = hoursWords(m.range); if (!given.includes(w)) given.push(w) }
        const cs = Math.max(ms, s), ce = Math.min(me, e)
        if (ce > cs) cans.push([cs, ce])
      }
    }
  }
  const hours = given.join(' and ')
  if (cans.length === 0) return given.length ? { verdict: 'outside', note: '', hours } : none
  cans.sort((x, y) => x[0] - y[0])
  let covered = 0, curS = cans[0][0], curE = cans[0][1]
  for (const [cs, ce] of cans.slice(1)) {
    if (cs <= curE) curE = Math.max(curE, ce)
    else { covered += curE - curS; curS = cs; curE = ce }
  }
  covered += curE - curS
  return covered >= e - s ? { verdict: 'can', note: '', hours: '' } : { verdict: 'partly', note: '', hours }
}

// ---------------------------------------------------------------- staffed or not

export function neededFor(e: StaffingEntry | null, kind: StaffableKind): number {
  return e && typeof e.needed === 'number' ? e.needed : DEFAULT_NEEDED[kind]
}

/**
 * none = nobody on, short = some but fewer than needed, staffed otherwise
 * (needed 0 is always staffed). `counts`: whether an assigned person still
 * counts (S3-R6: someone who left the team no longer does).
 */
export function staffedState(e: StaffingEntry | null, kind: StaffableKind, counts: (staffId: string) => boolean = () => true): StaffedState {
  const needed = neededFor(e, kind)
  if (needed <= 0) return 'staffed'
  const on = (e?.assigned ?? []).filter((p) => counts(p.staffId)).length
  if (on === 0) return 'none'
  return on < needed ? 'short' : 'staffed'
}

export function movedSince(e: StaffingEntry, ev: Pick<StaffableEvent, 'startIso' | 'endIso'>): boolean {
  if (!e.seen) return false
  return Date.parse(e.seen.startIso) !== Date.parse(ev.startIso) || Date.parse(e.seen.endIso) !== Date.parse(ev.endIso)
}

// ---------------------------------------------------------------- validation

const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field })
const FROM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const isTo = (v: string) => FROM_RE.test(v) || v === '24:00'
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function realDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function checkMark(raw: unknown, field: string): Result<DayMark> {
  if (!isObj(raw)) return fail("Pick Can or Can't.", field)
  if (raw.kind !== 'can' && raw.kind !== 'cant') return fail("Pick Can or Can't.", field)
  const note = raw.note === undefined || raw.note === null ? '' : raw.note
  if (typeof note !== 'string') return fail('Keep the note under 120 characters.', field)
  const trimmed = note.trim()
  if (trimmed.length > MAX_NOTE) return fail('Keep the note under 120 characters.', field)
  let range: TimeRange | null = null
  if (raw.range !== null && raw.range !== undefined) {
    if (!isObj(raw.range)) return fail('Pick a time from the list.', field)
    const { from, to } = raw.range
    if (typeof from !== 'string' || typeof to !== 'string' || !FROM_RE.test(from) || !isTo(to)) return fail('Pick a time from the list.', field)
    if (minutes(to) <= minutes(from)) return fail('Pick an end time after the start.', field)
    range = { from, to }
  }
  return { ok: true, value: { kind: raw.kind, range, note: trimmed } }
}

/** Marks overlap when either is all day, or their times overlap (touching is fine). */
function overlapping(marks: DayMark[]): boolean {
  if (marks.length > 1 && marks.some((m) => !m.range)) return true
  const sorted = [...marks].sort((a, b) => minutes(a.range!.from) - minutes(b.range!.from))
  return sorted.some((m, i) => i > 0 && minutes(m.range!.from) < minutes(sorted[i - 1].range!.to))
}

const sortMarks = (marks: DayMark[]): DayMark[] =>
  [...marks].sort((a, b) => (a.range ? minutes(a.range.from) : -1) - (b.range ? minutes(b.range.from) : -1))

/**
 * What a person saves about when they can work. Days of the week '0'..'6'
 * (unsaid days become null); dates from yesterday to a year ahead (older
 * dates are dropped quietly, they no longer matter); at most 4 marks a day,
 * none overlapping; notes up to 120 characters. Errors are sentences the
 * person can act on.
 */
export function validateAvailability(raw: unknown, now: Date): Result<Pick<Availability, 'weekly' | 'dates'>> {
  if (!isObj(raw) || !isObj(raw.weekly ?? {}) || !isObj(raw.dates ?? {})) return fail("We couldn't read those times. Try again.")
  const weekly: Record<string, DayMark | null> = { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }
  for (const [day, mark] of Object.entries((raw.weekly ?? {}) as Record<string, unknown>)) {
    if (!/^[0-6]$/.test(day)) return fail('Pick a day of the week.', `weekly.${day}`)
    if (mark === null || mark === undefined) continue
    const r = checkMark(mark, `weekly.${day}`)
    if (!r.ok) return r
    weekly[day] = r.value
  }

  const dateKeys = Object.keys((raw.dates ?? {}) as Record<string, unknown>)
  if (dateKeys.length > MAX_DATES) return fail("That's too many dates in one save. Take some off and try again.")
  const today = localDate(now.toISOString())
  const earliest = addDays(today, -1)
  const latest = addDays(today, DATE_WINDOW_DAYS)
  const dates: Record<string, DayMark[]> = {}
  for (const day of dateKeys.sort()) {
    const list = (raw.dates as Record<string, unknown>)[day]
    if (!realDate(day)) return fail('Pick a real date.', `dates.${day}`)
    if (!Array.isArray(list)) return fail("We couldn't read those times. Try again.", `dates.${day}`)
    if (day < earliest) continue // gone by: dropped
    if (day > latest) return fail('Pick a date within the next year.', `dates.${day}`)
    if (list.length === 0) continue
    if (list.length > MAX_MARKS_PER_DAY) return fail('Up to 4 times on one day.', `dates.${day}`)
    const marks: DayMark[] = []
    for (const m of list) {
      const r = checkMark(m, `dates.${day}`)
      if (!r.ok) return r
      marks.push(r.value)
    }
    if (overlapping(marks)) return fail(`Two of your times on ${dayLabel(day)} overlap. Change one.`, `dates.${day}`)
    dates[day] = sortMarks(marks)
  }
  return { ok: true, value: { weekly, dates } }
}

// ---------------------------------------------------------------- entry changes (pure; used inside updateEntry)

/**
 * Puts someone on (once: an existing assignment for the same person is kept
 * as it was). Their "I'd like to work this" is done with once they're on, so
 * it is cleared (taking them off later doesn't bring back an old ask).
 */
export function withAssigned(e: StaffingEntry, a: Assignment): StaffingEntry {
  const asks = e.asks.filter((x) => x.staffId !== a.staffId)
  if (e.assigned.some((x) => x.staffId === a.staffId)) return asks.length === e.asks.length ? e : { ...e, asks }
  return { ...e, assigned: [...e.assigned, a], asks }
}

export function withoutAssigned(e: StaffingEntry, staffId: string): StaffingEntry {
  return { ...e, assigned: e.assigned.filter((x) => x.staffId !== staffId) }
}

/**
 * Adds this person's "I'd like to work this", or replaces their note. Asking
 * again with the same note changes nothing (a double tap writes no second
 * history line); a new note keeps when they first asked.
 */
export function withAsk(e: StaffingEntry, ask: Ask): StaffingEntry {
  const was = e.asks.find((x) => x.staffId === ask.staffId)
  if (was && was.note === ask.note) return e
  const next = was ? { ...ask, at: was.at } : ask
  return { ...e, asks: [...e.asks.filter((x) => x.staffId !== ask.staffId), next] }
}

export function withoutAsk(e: StaffingEntry, staffId: string): StaffingEntry {
  return { ...e, asks: e.asks.filter((x) => x.staffId !== staffId) }
}

/** What `seen` remembers of an event: its times, title and whether it is cancelled. */
export function seenOf(ev: Pick<StaffableEvent, 'startIso' | 'endIso' | 'title' | 'status'>): { startIso: string; endIso: string; title: string; cancelled?: boolean } {
  return { startIso: ev.startIso, endIso: ev.endIso, title: ev.title, ...(ev.status !== 'on' ? { cancelled: true } : {}) }
}

/**
 * Records the event's times and title as seen now; SEQUENCE goes up when the
 * times moved or it was cancelled (or came back), so a calendar app updates
 * it in place (RFC 5545).
 */
export function withSeen(e: StaffingEntry, ev: { startIso: string; endIso: string; title: string; cancelled?: boolean }): StaffingEntry {
  const seen = { startIso: ev.startIso, endIso: ev.endIso, title: ev.title, ...(ev.cancelled ? { cancelled: true } : {}) }
  const flipped = !!e.seen && !!e.seen.cancelled !== !!ev.cancelled
  return { ...e, seen, sequence: e.seen && (movedSince(e, ev) || flipped) ? e.sequence + 1 : e.sequence }
}
