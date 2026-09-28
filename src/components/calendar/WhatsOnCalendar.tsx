import { useState, useMemo, useEffect } from 'react'
import type { CSSProperties } from 'react'
import {
  CALENDAR_FILTERS,
  collapseBookedParties,
  formatClock,
  formatTimeRange,
  groupEventsByDay,
  listRowAction,
  listRowMeta,
  matchesFilter,
} from './calendar-view-model'
import type { CalendarEvent, CalendarFilter } from './calendar-view-model'
import { OPENING_DATE } from '@config/opening'
import { OPEN_WEEKDAYS, closureOn, studioOpenOn, type Holiday } from '@config/closures'

/** Months the flat list view loads at once; "Show more" adds one at a time. */
const LIST_MONTHS_INITIAL = 3

function monthKey(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

/**
 * Months already fetched during this visit. Switching between the list and the
 * month grid, or paging back to a month already seen, shows at once instead of
 * asking the server again. Entries go stale after a minute.
 *
 * A month the server marked `incomplete` (one of its lookups failed) is kept
 * so what did arrive can be shown, but it never counts as held: the next look
 * at that month asks again.
 */
const FRESH_MS = 60_000
const fetched = new Map<string, { at: number; events: CalendarEvent[]; incomplete: boolean }>()

function held(key: string): CalendarEvent[] | null {
  const hit = fetched.get(key)
  return hit && !hit.incomplete && Date.now() - hit.at < FRESH_MS ? hit.events : null
}

/** What came back for a month, whole or not. */
function arrived(key: string): CalendarEvent[] {
  return fetched.get(key)?.events ?? []
}

function cameBackIncomplete(key: string): boolean {
  return fetched.get(key)?.incomplete === true
}

/** "2026-10", 3 → ["2026-10", "2026-11", "2026-12"] */
function keysFrom(first: string, count: number): string[] {
  const [y, m] = first.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1)
    return monthKey(d.getFullYear(), d.getMonth())
  })
}

/** One request for `count` months in a row, remembered month by month. */
async function fetchMonths(first: string, count: number): Promise<void> {
  const res = await fetch(`/api/calendar.json?month=${first}${count > 1 ? `&months=${count}` : ''}`)
  if (!res.ok) throw new Error(`calendar fetch failed: ${res.status}`)
  const data: { events?: CalendarEvent[]; incomplete?: boolean } = await res.json()
  const events = Array.isArray(data?.events) ? data.events : []
  const incomplete = data?.incomplete === true
  const at = Date.now()
  for (const key of keysFrom(first, count)) {
    fetched.set(key, { at, incomplete, events: events.filter((e) => e.date.startsWith(key)) })
  }
}

async function fetchMonth(key: string): Promise<CalendarEvent[]> {
  const already = held(key)
  if (already) return already
  await fetchMonths(key, 1)
  return arrived(key)
}

/** Forget what was fetched. For tests. */
export function forgetFetchedMonths(): void {
  fetched.clear()
}

interface WhatsOnCalendarProps {
  /**
   * Optional initial events (e.g. SSR-rendered first month). After mount the
   * component fetches per-month from /api/calendar.json and state takes over.
   */
  events?: CalendarEvent[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Colour-coding by event kind. Each offering carries its craft colour from
// global.css (the same one its page label uses), so pink always means party
// and denim always means workshop. Three roles per kind:
//   KIND_COLORS = dots and edges (never text; the base colours are too light)
//   KIND_SOFT   = chip backgrounds
//   KIND_INK    = text
const KIND_COLORS: Record<CalendarEvent['kind'], string> = {
  workshop: 'var(--tone-workshop)',
  'open-studio': 'var(--tone-studio)',
  event: 'var(--tone-event)',
  'party-available': 'var(--tone-party)',
  'party-booked': 'var(--color-muted)',
}

const KIND_SOFT: Record<CalendarEvent['kind'], string> = {
  workshop: 'var(--tone-workshop-soft)',
  'open-studio': 'var(--tone-studio-soft)',
  event: 'var(--tone-event-soft)',
  'party-available': 'var(--tone-party-soft)',
  'party-booked': 'var(--color-sand)',
}

const KIND_INK: Record<CalendarEvent['kind'], string> = {
  workshop: 'var(--tone-workshop-ink)',
  'open-studio': 'var(--tone-studio-ink)',
  event: 'var(--tone-event-ink)',
  'party-available': 'var(--tone-party-ink)',
  'party-booked': 'var(--color-muted)',
}

/** A holiday closure wears the holiday's colours; everything else, its kind's. */
const colorOf = (e: CalendarEvent) => (e.holiday ? `var(--holiday-${e.holiday})` : KIND_COLORS[e.kind])
const softOf = (e: CalendarEvent) => (e.holiday ? `var(--holiday-${e.holiday}-soft)` : KIND_SOFT[e.kind])
const inkOf = (e: CalendarEvent) => (e.holiday ? `var(--holiday-${e.holiday}-ink)` : KIND_INK[e.kind])

/** Stripes for a day closed for a holiday: pumpkin orange, or a candy cane. */
const HOLIDAY_STRIPES: Record<Holiday, string> = {
  halloween:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--holiday-halloween) 30%, white) 0 7px, color-mix(in srgb, var(--holiday-halloween) 12%, white) 7px 14px)',
  christmas:
    'repeating-linear-gradient(135deg, color-mix(in srgb, var(--holiday-christmas) 38%, white) 0 7px, white 7px 14px)',
}
const CLOSED_HATCH = 'repeating-linear-gradient(135deg, rgba(var(--color-primary-rgb),0.045) 0 2px, transparent 2px 9px)'

const KIND_LABELS: Record<CalendarEvent['kind'], string> = {
  workshop: 'Workshop',
  'open-studio': 'Open Studio',
  event: 'Event',
  'party-available': 'Party Available',
  'party-booked': 'Booked',
}

/**
 * Collapse a day's individual party-available slots into ONE inviting chip for
 * the month grid ("4 party times open" → /book with the date preselected).
 * The selected-day detail below the grid still lists each time individually.
 */
function aggregatePartySlots(dayEvents: CalendarEvent[]): CalendarEvent[] {
  const partySlots = dayEvents.filter((e) => e.kind === 'party-available')
  if (partySlots.length <= 1) return dayEvents
  const rest = dayEvents.filter((e) => e.kind !== 'party-available')
  const date = partySlots[0].date
  const aggregate: CalendarEvent = {
    id: `party-available-agg-${date}`,
    kind: 'party-available',
    title: `${partySlots.length} party times open`,
    date,
    startTime: partySlots[0].startTime,
    bookable: true,
    href: `/book?date=${encodeURIComponent(date)}`,
  }
  const out = [...rest, aggregate]
  out.sort((a, b) => {
    const at = a.startTime ?? ''
    const bt = b.startTime ?? ''
    return at < bt ? -1 : at > bt ? 1 : 0
  })
  return out
}

function getMonthData(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return { firstDay, daysInMonth }
}

function formatMonthYear(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

/** "7:00 PM" → "7pm", "4:30 PM" → "4:30pm" — compact prefix for grid chips. */
function chipTime(t?: string) {
  const full = formatClock(t)
  const m = full.match(/^(\d{1,2}):(\d{2}) (AM|PM)$/)
  if (!m) return ''
  return `${m[1]}${m[2] === '00' ? '' : ':' + m[2]}${m[3].toLowerCase()}`
}


/** Label shown in a selected-day row, e.g. "Open Studio · 9 AM–6 PM (walk-in)". */
function eventLine(e: CalendarEvent) {
  // Party events carry their own descriptive titles already (time / "Reserved").
  if (e.kind === 'party-available' || e.kind === 'party-booked') return e.title
  const range = formatTimeRange(e.startTime, e.endTime)
  const base = range ? `${e.title} · ${range}` : e.title
  if (e.kind === 'open-studio') return `${base} (walk-in)`
  return base
}

/** The small label under a selected-day row: its kind, and why it can't be booked if it can't. */
function detailLabel(e: CalendarEvent) {
  if (e.comingSoon) return `${KIND_LABELS[e.kind]} · Coming soon`
  if (e.soldOut) return `${KIND_LABELS[e.kind]} · Sold out`
  return KIND_LABELS[e.kind]
}

/** Studio-local "today" as YYYY-MM-DD (en-CA yields that format). */
function todayISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

/** A YYYY-MM-DD → "Saturday, July 18" heading for a list day card. */
function formatDayHeading(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Line two of a list row, set so it only ever wraps between items: spaces
 * inside an item don't break, and the "·" stays at the end of a line.
 */
function rowMetaText(e: CalendarEvent): string {
  // An event's own line is a sentence: let it wrap between words.
  if (e.kind === 'event' && e.detail) return listRowMeta(e)
  return listRowMeta(e)
    .split(' · ')
    .map((part) => part.replace(/ /g, ' '))
    .join(' · ')
}

/** List|Month toggle pill (inlined; WorkshopExplorer's original is being removed). */
function pillStyle(active: boolean): CSSProperties {
  return active
    ? {
        background: 'var(--color-dark)',
        color: 'white',
      }
    : {
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        color: 'var(--color-text)',
      }
}

/** The filter is remembered for the visit. Storage can throw (private windows): then it is just not remembered. */
const FILTER_KEY = 'calendar-filter'

function rememberedFilter(): CalendarFilter | null {
  try {
    const saved = window.sessionStorage.getItem(FILTER_KEY)
    return CALENDAR_FILTERS.find((f) => f.id === saved)?.id ?? null
  } catch {
    return null
  }
}

function rememberFilter(filter: CalendarFilter): void {
  try {
    window.sessionStorage.setItem(FILTER_KEY, filter)
  } catch {
    // Not remembered; the filter still works for this page.
  }
}

const FILTER_EMPTY: Record<CalendarFilter, string> = {
  all: 'Nothing scheduled yet — check back soon.',
  workshops: 'No workshops on the calendar yet.',
  parties: 'No party dates on the calendar yet.',
}

/** A filter is a plain word with a line under the one that is on, like the site's menu. */
function filterTabStyle(active: boolean): CSSProperties {
  return {
    minHeight: '2.75rem', // 44px tap target
    padding: '0 0.125rem',
    marginBottom: '-1px', // its line sits on the toolbar's own
    background: 'none',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--color-dark)' : 'transparent'}`,
    borderRadius: 0,
    fontFamily: 'inherit',
    fontSize: '0.9375rem',
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--color-dark)' : 'var(--color-text)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

/** List | Month: one small switch, two halves. */
const viewSwitchStyle: CSSProperties = {
  display: 'inline-flex',
  padding: '0.1875rem',
  marginBottom: '0.5rem',
  borderRadius: '0.625rem',
  background: 'var(--color-sand)',
  border: '1px solid var(--color-line)',
}

function viewButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: '2.375rem',
    minWidth: '4.25rem',
    padding: '0 0.875rem',
    border: 'none',
    borderRadius: '0.4375rem',
    background: active ? 'var(--color-surface)' : 'transparent',
    boxShadow: active ? '0 1px 3px rgba(0, 0, 0, 0.12)' : 'none',
    fontFamily: 'inherit',
    fontSize: '0.875rem',
    fontWeight: active ? 600 : 500,
    color: active ? 'var(--color-dark)' : 'var(--color-text)',
    cursor: 'pointer',
  }
}

/** The round ‹ › buttons beside the month name. */
function monthNavStyle(disabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2.5rem',
    height: '2.5rem',
    fontSize: '1.5rem',
    lineHeight: 1,
    color: 'var(--color-dark)',
    background: 'rgba(255,255,255,0.85)',
    border: '1px solid rgba(var(--color-primary-rgb),0.35)',
    borderRadius: '9999px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: disabled ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
    opacity: disabled ? 0.35 : 1,
  }
}

/** Shown when the calendar, or part of it, did not load. */
function LoadNotice({ failed, busy, onRetry }: { failed: boolean; busy: boolean; onRetry: () => void }) {
  const retry = (
    <button type="button" className="btn btn-secondary" onClick={onRetry} disabled={busy}>
      Try again
    </button>
  )
  if (!failed) {
    return (
      <div
        role="status"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem 1.25rem',
          padding: '1rem 1.25rem',
          borderRadius: '1rem',
          background: 'var(--color-sand)',
          border: '1px solid var(--color-line)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, color: 'var(--color-dark)', fontWeight: 500 }}>
          Some of the calendar didn&rsquo;t load. Try again in a minute.
        </p>
        {retry}
      </div>
    )
  }
  return (
    <div role="alert" className="notice-panel" style={{ width: '100%' }}>
      <p style={{ margin: '0 0 1.25rem', color: 'var(--color-dark)', fontWeight: 600, fontSize: '1.0625rem' }}>
        We couldn&rsquo;t load the calendar just now.
      </p>
      {retry}
      <p style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.25rem 1.5rem', margin: '1rem 0 0' }}>
        <a className="btn btn-quiet" href="/workshops" style={{ minHeight: '2.75rem' }}>See workshops</a>
        <a className="btn btn-quiet" href="/book" style={{ minHeight: '2.75rem' }}>Book a party</a>
      </p>
    </div>
  )
}

export default function WhatsOnCalendar({ events: initialEvents = [] }: WhatsOnCalendarProps) {
  const now = new Date()
  // Pre-opening, there's nothing before opening month — start the month grid there.
  const opening = new Date(OPENING_DATE + 'T12:00:00')
  const start = now < opening ? opening : now
  const [year, setYear] = useState(start.getFullYear())
  const [month, setMonth] = useState(start.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [view, setView] = useState<'list' | 'month'>('list')
  const [compact, setCompact] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents)
  const [loading, setLoading] = useState(false)
  // The month on screen: did its request fail, or come back with parts missing?
  const [monthFailed, setMonthFailed] = useState(false)
  const [monthIncomplete, setMonthIncomplete] = useState(false)
  // Flat list view: everything upcoming across the next N months, not month-scoped.
  const [listMonths, setListMonths] = useState(LIST_MONTHS_INITIAL)
  const [listEvents, setListEvents] = useState<CalendarEvent[]>(initialEvents)
  // Starts true: the first thing on screen is "loading", never "nothing scheduled".
  const [listLoading, setListLoading] = useState(true)
  const [listFailed, setListFailed] = useState(false)
  const [listIncomplete, setListIncomplete] = useState(false)
  // How many months the list on screen covers; trails `listMonths` while one loads.
  const [listMonthsShown, setListMonthsShown] = useState(0)
  // "Try again" bumps this to run the request again.
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState<CalendarFilter>('all')

  // Read after mount, so the first paint matches what the server rendered.
  useEffect(() => {
    const saved = rememberedFilter()
    if (saved) setFilter(saved)
  }, [])

  function chooseFilter(next: CalendarFilter) {
    setFilter(next)
    setSelectedDay(null)
    rememberFilter(next)
  }

  // Nothing happens before opening month, so the list starts there too.
  const listStart = monthKey(start.getFullYear(), start.getMonth())

  useEffect(() => {
    if (view !== 'list') return
    let cancelled = false
    const keys = keysFrom(listStart, listMonths)
    const show = (failed: boolean) => {
      const seen = new Set<string>()
      setListEvents(
        keys
          .flatMap((k) => arrived(k))
          .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))),
      )
      setListIncomplete(keys.some(cameBackIncomplete))
      setListFailed(failed)
      setListMonthsShown(keys.length)
      setListLoading(false)
    }
    // Ask only for the months not already held, in ONE request.
    const firstMissing = keys.findIndex((k) => held(k) === null)
    if (firstMissing === -1) {
      show(false)
      return
    }
    setListLoading(true)
    fetchMonths(keys[firstMissing], keys.length - firstMissing).then(
      () => {
        if (!cancelled) show(false)
      },
      () => {
        // Keep showing whatever we have, and say the rest didn't load.
        if (!cancelled) show(true)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, listMonths, attempt])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 549px)')
    setCompact(mq.matches)
    const handler = (ev: MediaQueryListEvent) => setCompact(ev.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Fetch the displayed month's events on mount and whenever the visible month
  // changes. `month` is 0-indexed, so the API param is built as YYYY-MM with a
  // 1-based, zero-padded month. Errors keep whatever events we already have.
  useEffect(() => {
    if (view !== 'month') return
    let cancelled = false
    const key = monthKey(year, month)
    const show = (evs: CalendarEvent[], failed: boolean) => {
      setEvents(evs)
      setMonthIncomplete(cameBackIncomplete(key))
      setMonthFailed(failed)
      setLoading(false)
    }
    const already = held(key)
    if (already) {
      // Seen a moment ago (the list loads the first months): show it at once.
      show(already, false)
      return
    }
    setLoading(true)
    fetchMonth(key).then(
      (evs) => {
        if (!cancelled) show(evs, false)
      },
      () => {
        // Keep showing whatever we have for this month, and say it didn't load.
        if (!cancelled) show(arrived(key), true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [view, year, month, attempt])

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>()
    for (const e of events) {
      if (!matchesFilter(e, filter)) continue
      const d = new Date(e.date + 'T00:00:00')
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(e)
      }
    }
    return map
  }, [events, year, month, filter])

  // List view: every upcoming day across the loaded months, parties collapsed.
  const dayGroups = useMemo(
    () => groupEventsByDay(listEvents.filter((e) => matchesFilter(e, filter)), todayISO()),
    [listEvents, filter],
  )

  // "Show more" stops after a month that adds nothing to what's on screen.
  // Judged by what the filter shows, and never while something failed to load.
  const lastListMonth = keysFrom(listStart, Math.max(listMonthsShown, 1)).pop()!
  const nothingFurther =
    listMonthsShown > LIST_MONTHS_INITIAL &&
    listMonthsShown === listMonths &&
    !listLoading &&
    !listFailed &&
    !listIncomplete &&
    !dayGroups.some((day) => day.date.startsWith(lastListMonth))

  const { firstDay, daysInMonth } = getMonthData(year, month)

  // Nothing happens before opening month, so there is nothing to page back to.
  const atFirstMonth = monthKey(year, month) <= OPENING_DATE.slice(0, 7)

  function prevMonth() {
    if (atFirstMonth) return
    setSelectedDay(null)
    if (month === 0) {
      setMonth(11)
      setYear(year - 1)
    } else {
      setMonth(month - 1)
    }
  }

  function nextMonth() {
    setSelectedDay(null)
    if (month === 11) {
      setMonth(0)
      setYear(year + 1)
    } else {
      setMonth(month + 1)
    }
  }

  function handleDayClick(day: number) {
    if (eventsByDay.has(day)) {
      setSelectedDay(selectedDay === day ? null : day)
    }
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const selectedEvents = selectedDay ? collapseBookedParties(eventsByDay.get(selectedDay) ?? []) : []

  // Which kinds appear this month — drives the legend.
  const monthKinds = useMemo(() => {
    const set = new Set<CalendarEvent['kind']>()
    for (const list of eventsByDay.values()) {
      for (const e of list) set.add(e.kind)
    }
    return Array.from(set)
  }, [eventsByDay])

  return (
    <div>
      {/* One row of controls: what to show on the left, how to show it on the
          right. The month's name and arrows live on the month grid itself. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '0.5rem 1.5rem',
          maxWidth: view === 'list' ? '44rem' : undefined,
          margin: '0 auto 1.5rem',
          borderBottom: '1px solid var(--color-line)',
        }}
      >
        <div role="group" aria-label="Show" style={{ display: 'flex', gap: compact ? '1.125rem' : '1.75rem' }}>
          {CALENDAR_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => chooseFilter(f.id)}
              style={filterTabStyle(filter === f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="View" style={viewSwitchStyle}>
          <button
            type="button"
            onClick={() => { setView('list'); setSelectedDay(null) }}
            style={viewButtonStyle(view === 'list')}
            aria-pressed={view === 'list'}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => { setView('month'); setSelectedDay(null) }}
            style={viewButtonStyle(view === 'month')}
            aria-pressed={view === 'month'}
          >
            Month
          </button>
        </div>
      </div>

      {view === 'month' && (monthFailed || monthIncomplete) && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <LoadNotice failed={monthFailed} busy={loading} onRetry={() => setAttempt((n) => n + 1)} />
        </div>
      )}

      {view === 'month' && (
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        borderRadius: '1rem',
        padding: '1.5rem',
        boxShadow: '0 4px 16px rgba(var(--color-primary-rgb), 0.08), 0 10px 40px rgba(var(--color-primary-rgb), 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(var(--color-primary-rgb), 0.04)',
      }}>
      {/* The month, and the way to the next and the last */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          disabled={atFirstMonth}
          aria-disabled={atFirstMonth}
          style={monthNavStyle(atFirstMonth)}
        >
          <span aria-hidden="true">&lsaquo;</span>
        </button>
        <p
          aria-live="polite"
          style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, fontFamily: 'var(--font-heading)', color: 'var(--color-dark)', textAlign: 'center' }}
        >
          {formatMonthYear(year, month)}
          {loading && (
            <span style={{ marginLeft: '0.5rem', fontSize: '0.8125rem', fontWeight: 500, fontFamily: 'var(--font-body)', color: 'var(--color-muted)' }}>
              Loading…
            </span>
          )}
        </p>
        <button type="button" onClick={nextMonth} aria-label="Next month" style={monthNavStyle(false)}>
          <span aria-hidden="true">&rsaquo;</span>
        </button>
      </div>

      {/* Day headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        marginBottom: '0.5rem',
      }}>
        {DAY_NAMES.map((d, i) => (
          <div key={d} style={{
            textAlign: 'center',
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: OPEN_WEEKDAYS.has(i) ? 'var(--color-dark)' : 'rgba(var(--color-primary-rgb), 0.45)',
            padding: '0.25rem 0 0.5rem',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid — 1px gaps over a hairline background = ruled cells */}
      {(() => {
        const todayStr = todayISO()
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
        // Pad the tail so the last row is full and the rule lines close cleanly.
        const padded = [...cells]
        while (padded.length % 7 !== 0) padded.push(null)
        return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: '1px',
        background: 'rgba(var(--color-primary-rgb), 0.14)',
        border: '1px solid rgba(var(--color-primary-rgb), 0.14)',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}>
        {padded.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} style={{ background: 'rgba(255,255,255,0.35)', minHeight: compact ? '2.75rem' : '6rem' }} />
          }
          const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
          // Closed: the usual Mon–Wed, and any day the studio has closed (see closures.ts).
          const isOpenDay = studioOpenOn(dateStr)
          const holiday = closureOn(dateStr)?.holiday
          const isPast = dateStr < todayStr
          const isToday = dateStr === todayStr
          const dayEvents = eventsByDay.get(day) ?? []
          const hasEvents = dayEvents.length > 0
          const isSelected = selectedDay === day
          const chips = collapseBookedParties(aggregatePartySlots(dayEvents))
          const cellBg = isSelected
            ? 'rgba(var(--color-primary-rgb), 0.10)'
            : isPast
              ? 'rgba(255,255,255,0.45)'
              : isOpenDay
                ? 'rgba(255,255,255,0.92)'
                : 'rgba(255,255,255,0.6)'
          return (
            <div
              key={day}
              role={hasEvents ? 'button' : undefined}
              tabIndex={hasEvents ? 0 : -1}
              aria-label={hasEvents ? `${dateStr}, ${chips.length} item${chips.length === 1 ? '' : 's'}` : undefined}
              onClick={() => handleDayClick(day)}
              onKeyDown={(ev) => {
                if (hasEvents && (ev.key === 'Enter' || ev.key === ' ')) {
                  ev.preventDefault()
                  handleDayClick(day)
                }
              }}
              style={{
                position: 'relative',
                minHeight: compact ? '2.75rem' : '6rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: compact ? 'center' : 'stretch',
                gap: '2px',
                padding: compact ? '0.3rem 0.15rem' : '0.4rem 0.35rem',
                // Colour only: the shorthand would wipe the stripes below.
                backgroundColor: cellBg,
                // Closed weekdays get a faint diagonal hatch so "nothing here" reads as "closed".
                // A day closed for a holiday wears its stripes instead.
                backgroundImage: holiday ? HOLIDAY_STRIPES[holiday] : !isOpenDay && !isPast ? CLOSED_HATCH : undefined,
                boxShadow: isSelected ? 'inset 0 0 0 2px var(--color-primary)' : isToday ? 'inset 0 0 0 2px rgba(var(--color-primary-rgb),0.45)' : 'none',
                opacity: isPast ? 0.55 : 1,
                cursor: hasEvents ? 'pointer' : 'default',
                transition: 'background 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (hasEvents && !isSelected) e.currentTarget.style.backgroundColor = 'rgba(var(--color-primary-rgb), 0.07)'
              }}
              onMouseLeave={(e) => {
                if (hasEvents && !isSelected) e.currentTarget.style.backgroundColor = cellBg
              }}
            >
              <span style={{
                alignSelf: compact ? 'center' : 'flex-start',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '1.5rem',
                height: '1.5rem',
                padding: '0 0.3rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: isToday || hasEvents ? 700 : 500,
                color: isToday ? '#fff' : hasEvents ? 'var(--color-dark)' : 'rgba(var(--color-primary-rgb), 0.5)',
                background: isToday ? 'var(--color-primary)' : 'transparent',
              }}>
                {day}
              </span>
              {compact ? (
                hasEvents && (
                  <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
                    {Array.from(new Set(dayEvents.map((e) => e.kind))).slice(0, 4).map((kind) => (
                      <span key={kind} style={{ display: 'block', width: '6px', height: '6px', borderRadius: '50%', background: KIND_COLORS[kind] }} />
                    ))}
                    {/* A number as well, so colour is not the only signal. Read out by the cell's label. */}
                    {chips.length > 1 && (
                      <span aria-hidden="true" style={{ fontSize: '0.625rem', fontWeight: 700, lineHeight: 1, color: 'var(--color-dark)' }}>
                        {chips.length}
                      </span>
                    )}
                  </span>
                )
              ) : (
                <>
                  {chips.slice(0, 4).map((e) => {
                    const clickable = !!e.href
                    const color = colorOf(e)
                    const time = e.kind === 'event' ? '' : chipTime(e.startTime)
                    const chipStyle: CSSProperties = {
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.3rem',
                      fontSize: '0.6875rem',
                      lineHeight: 1.25,
                      fontWeight: 500,
                      color: 'var(--color-dark)',
                      background: softOf(e),
                      borderLeft: `3px solid ${color}`,
                      borderRadius: '4px',
                      padding: '3px 6px',
                      overflow: 'hidden',
                      // A closure is the only thing on its day: let its name run to a second line.
                      whiteSpace: e.holiday ? 'normal' : 'nowrap',
                      textDecoration: 'none',
                      cursor: clickable ? 'pointer' : 'default',
                      transition: 'filter 0.15s ease',
                    }
                    const inner = (
                      <>
                        {time && <span style={{ flexShrink: 0, fontSize: '0.625rem', fontWeight: 700, color: inkOf(e), letterSpacing: '0.02em' }}>{time}</span>}
                        <span style={e.holiday ? undefined : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                      </>
                    )
                    return clickable ? (
                      <a
                        key={e.id}
                        href={e.href}
                        title={e.title}
                        onClick={(ev) => ev.stopPropagation()}
                        style={chipStyle}
                        onMouseEnter={(ev) => (ev.currentTarget.style.filter = 'brightness(0.95)')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.filter = 'none')}
                      >
                        {inner}
                      </a>
                    ) : (
                      <span key={e.id} title={e.title} style={chipStyle}>{inner}</span>
                    )
                  })}
                  {chips.length > 4 && (
                    <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-muted)', paddingLeft: '6px' }}>
                      +{chips.length - 4} more
                    </span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
        )
      })()}

      {/* Legend — pills that match the chips. The closed-day key shows even for an empty month. */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
        marginTop: '1rem',
      }}>
        {monthKinds.map((kind) => (
          <span key={kind} style={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'var(--color-dark)',
            background: KIND_SOFT[kind],
            borderLeft: `3px solid ${KIND_COLORS[kind]}`,
            borderRadius: '4px',
            padding: '3px 8px',
          }}>
            {KIND_LABELS[kind]}
          </span>
        ))}
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          fontSize: '0.6875rem',
          color: 'var(--color-muted)',
          marginLeft: 'auto',
        }}>
          <span style={{
            width: '14px', height: '14px', borderRadius: '3px',
            border: '1px solid rgba(var(--color-primary-rgb),0.2)',
            backgroundImage: 'repeating-linear-gradient(135deg, rgba(var(--color-primary-rgb),0.12) 0 2px, transparent 2px 5px)',
          }} />
          Closed
        </span>
      </div>
      </div>
      )}

      {/* List view: upcoming day cards, party slots collapsed */}
      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '44rem', margin: '0 auto' }}>
          {dayGroups.length === 0 && listLoading && (
            <div role="status" aria-label="Loading the calendar">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="glass"
                  style={{ borderRadius: '1rem', padding: compact ? '1rem' : '1.25rem 1.5rem', marginBottom: '1rem', opacity: 1 - i * 0.25 }}
                >
                  <div style={{ height: '1rem', width: '9rem', borderRadius: '0.25rem', background: 'var(--color-line)', marginBottom: '1rem' }} />
                  <div style={{ height: '0.875rem', width: '60%', borderRadius: '0.25rem', background: 'var(--color-line)', marginBottom: '0.5rem' }} />
                  <div style={{ height: '0.75rem', width: '40%', borderRadius: '0.25rem', background: 'var(--color-line)' }} />
                </div>
              ))}
            </div>
          )}
          {listIncomplete && !listFailed && (
            <LoadNotice failed={false} busy={listLoading} onRetry={() => setAttempt((n) => n + 1)} />
          )}
          {dayGroups.length === 0 && !listLoading && !listFailed && !listIncomplete && (
            <div style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '3rem 0' }}>
              <p style={{ margin: 0 }}>{FILTER_EMPTY[filter]}</p>
              {filter !== 'all' && (
                <button type="button" className="btn btn-quiet" onClick={() => chooseFilter('all')} style={{ minHeight: '2.75rem', marginTop: '0.5rem' }}>
                  Show everything
                </button>
              )}
            </div>
          )}
          {dayGroups.map((day) => (
            <div key={day.date} className="glass" style={{ borderRadius: '1rem', padding: compact ? '1rem' : '1.25rem 1.5rem' }}>
              <p className="font-heading" style={{ fontWeight: 700, color: 'var(--color-dark)', marginBottom: '0.75rem' }}>
                {formatDayHeading(day.date)}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {day.events.map((e) => {
                  // CalendarEvent.href is already correct per kind (workshop →
                  // /workshops?w=<realId>, party → /book?date=… or ?start=…). Do NOT
                  // build /workshops?w=${e.id} — event ids are prefixed
                  // ("workshop-<id>") and would break the deeplink matcher.
                  const href = e.href
                  const action = listRowAction(e)
                  const rowStyle: CSSProperties = {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    minHeight: '2.75rem', // 44px tap target
                    textDecoration: 'none',
                    padding: compact ? '0.5rem' : '0.5rem 0.75rem',
                    borderRadius: '0.625rem',
                    transition: 'background 0.2s ease',
                    // A holiday closure: a band of its stripes down the left, its soft colour behind the words.
                    ...(e.holiday
                      ? {
                          paddingLeft: '1.25rem',
                          backgroundImage: `linear-gradient(90deg, transparent 0.5rem, ${softOf(e)} 0.5rem), ${HOLIDAY_STRIPES[e.holiday]}`,
                        }
                      : {}),
                  }
                  const inner = (
                    <>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3, color: 'var(--color-dark)' }}>
                          {e.title}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.125rem', fontSize: '0.8125rem', lineHeight: 1.4, color: 'var(--color-text)' }}>
                          <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', marginTop: '0.35em', borderRadius: '9999px', background: colorOf(e), flexShrink: 0 }} />
                          <span style={{ minWidth: 0 }}>{rowMetaText(e)}</span>
                        </span>
                      </div>
                      {action && (
                        <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: '0.875rem', fontWeight: 600, color: inkOf(e) }}>
                          {action}
                        </span>
                      )}
                    </>
                  )
                  return href ? (
                    <a
                      key={e.id}
                      href={href}
                      style={rowStyle}
                      onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(var(--color-primary-rgb),0.06)')}
                      onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                    >
                      {inner}
                    </a>
                  ) : (
                    <div key={e.id} style={rowStyle}>
                      {inner}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* A failed request never reads as an empty calendar. */}
          {listFailed && !(listLoading && dayGroups.length === 0) && (
            <LoadNotice failed busy={listLoading} onRetry={() => setAttempt((n) => n + 1)} />
          )}

          {/* Extend the window one month at a time, until a month adds nothing. */}
          {!listFailed && nothingFurther && dayGroups.length > 0 && (
            <p style={{ textAlign: 'center', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
              Nothing further scheduled yet.
            </p>
          )}
          {!listFailed && !nothingFurther && (
            <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
              <button
                onClick={() => setListMonths((n) => n + 1)}
                disabled={listLoading || listMonthsShown !== listMonths}
                style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.9375rem', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', opacity: listLoading ? 0.6 : 1 }}
              >
                {listLoading ? 'Loading…' : 'Show more →'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Selected day events — read-only overview, no book button (month view only) */}
      {view === 'month' && selectedDay !== null && selectedEvents.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <p style={{
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
            color: 'var(--color-muted)',
            marginBottom: '1rem',
          }}>
            {formatMonthYear(year, month).split(' ')[0]} {selectedDay}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {selectedEvents.map((e) => {
              const clickable = !!e.href
              const rowStyle = {
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'var(--color-surface)',
                border: clickable
                  ? `1px solid color-mix(in srgb, ${colorOf(e)} 35%, transparent)`
                  : '1px solid var(--color-line)',
                borderRadius: '0.75rem',
                padding: '0.9rem 1.1rem',
                textDecoration: 'none',
                cursor: clickable ? 'pointer' : 'default',
                transition: 'border-color 0.2s ease, background 0.2s ease',
              } as const

              const inner = (
                <>
                  <span style={{
                    flexShrink: 0,
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: colorOf(e),
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{
                      display: 'block',
                      fontSize: '0.9375rem',
                      fontWeight: 600,
                      color: 'var(--color-dark)',
                    }}>
                      {eventLine(e)}
                    </span>
                    <span style={{
                      display: 'block',
                      fontSize: '0.6875rem',
                      fontWeight: 500,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase' as const,
                      color: 'var(--color-muted)',
                      marginTop: '0.15rem',
                    }}>
                      {detailLabel(e)}
                    </span>
                  </div>
                  {clickable && (
                    <span style={{
                      flexShrink: 0,
                      fontSize: e.kind === 'party-available' ? '0.8125rem' : '1.1rem',
                      fontWeight: e.kind === 'party-available' ? 600 : 400,
                      color: inkOf(e),
                    }} aria-hidden="true">
                      {e.kind === 'party-available' ? 'Book ›' : '›'}
                    </span>
                  )}
                </>
              )

              return clickable ? (
                <a key={e.id} href={e.href} style={rowStyle}>
                  {inner}
                </a>
              ) : (
                <div key={e.id} style={rowStyle}>
                  {inner}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
