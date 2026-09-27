import { useState, useMemo, useEffect } from 'react'
import type { CSSProperties } from 'react'
import {
  formatClock,
  formatTimeRange,
  groupEventsByDay,
  listRowAction,
  listRowMeta,
} from './calendar-view-model'
import type { CalendarEvent } from './calendar-view-model'
import { OPENING_DATE } from '@config/opening'

/** Months the flat list view loads at once; "Show more" adds one at a time. */
const LIST_MONTHS_INITIAL = 3

function monthKey(y: number, m: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

async function fetchMonth(key: string): Promise<CalendarEvent[]> {
  const res = await fetch(`/api/calendar.json?month=${key}`)
  if (!res.ok) throw new Error(`calendar fetch failed: ${res.status}`)
  const data: { events?: CalendarEvent[] } = await res.json()
  return Array.isArray(data?.events) ? data.events : []
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

// Studio is open Thu–Sun; Mon–Wed cells read as "closed" so empty days don't
// look like missing data. (0 = Sunday.)
const OPEN_WEEKDAYS = new Set([0, 4, 5, 6])

/** Label shown in a selected-day row, e.g. "Open Studio · 9 AM–6 PM (walk-in)". */
function eventLine(e: CalendarEvent) {
  // Party events carry their own descriptive titles already (time / "Reserved").
  if (e.kind === 'party-available' || e.kind === 'party-booked') return e.title
  const range = formatTimeRange(e.startTime, e.endTime)
  const base = range ? `${e.title} · ${range}` : e.title
  if (e.kind === 'open-studio') return `${base} (walk-in)`
  return base
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
  // Flat list view: everything upcoming across the next N months, not month-scoped.
  const [listMonths, setListMonths] = useState(LIST_MONTHS_INITIAL)
  const [listEvents, setListEvents] = useState<CalendarEvent[]>(initialEvents)
  const [listLoading, setListLoading] = useState(false)

  useEffect(() => {
    if (view !== 'list') return
    let cancelled = false
    const keys: string[] = []
    for (let i = 0; i < listMonths; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
      keys.push(monthKey(d.getFullYear(), d.getMonth()))
    }
    setListLoading(true)
    Promise.all(keys.map((k) => fetchMonth(k).catch(() => [] as CalendarEvent[])))
      .then((chunks) => {
        if (cancelled) return
        const seen = new Set<string>()
        const merged = chunks.flat().filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
        setListEvents(merged)
      })
      .finally(() => {
        if (!cancelled) setListLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, listMonths])

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
    setLoading(true)
    fetchMonth(monthKey(year, month))
      .then((evs) => {
        if (cancelled) return
        setEvents(evs)
      })
      .catch(() => {
        // Keep showing whatever we have; don't crash.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, year, month])

  const eventsByDay = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>()
    for (const e of events) {
      const d = new Date(e.date + 'T00:00:00')
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate()
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(e)
      }
    }
    return map
  }, [events, year, month])

  // List view: every upcoming day across the loaded months, party slots collapsed.
  const dayGroups = useMemo(() => groupEventsByDay(listEvents, todayISO()), [listEvents])

  const { firstDay, daysInMonth } = getMonthData(year, month)

  function prevMonth() {
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

  const selectedEvents = selectedDay ? eventsByDay.get(selectedDay) ?? [] : []

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
      {/* Month nav — month view only (the list is a flat upcoming feed) */}
      {view === 'month' && (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.25rem',
        marginBottom: '1.25rem',
      }}>
        <button
          onClick={prevMonth}
          aria-label="Previous month"
          style={{
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
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          &lsaquo;
        </button>
        <span style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.5rem',
          fontSize: '1rem',
          fontWeight: 600,
          fontFamily: 'var(--font-heading)',
          color: 'var(--color-dark)',
        }}>
          <span style={{ minWidth: '9rem', textAlign: 'center' }}>{formatMonthYear(year, month)}</span>
          {loading && (
            <span style={{
              fontSize: '0.6875rem',
              fontWeight: 500,
              fontFamily: 'var(--font-body)',
              letterSpacing: '0.04em',
              color: 'var(--color-muted)',
            }}>
              Loading…
            </span>
          )}
        </span>
        <button
          onClick={nextMonth}
          aria-label="Next month"
          style={{
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
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        >
          &rsaquo;
        </button>
      </div>
      )}

      {/* View toggle */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => { setView('list'); setSelectedDay(null) }}
          className="px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
          style={pillStyle(view === 'list')}
          aria-pressed={view === 'list'}
        >
          List
        </button>
        <button
          onClick={() => { setView('month'); setSelectedDay(null) }}
          className="px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
          style={pillStyle(view === 'month')}
          aria-pressed={view === 'month'}
        >
          Month
        </button>
      </div>

      {view === 'month' && (
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-line)',
        borderRadius: '1rem',
        padding: '1.5rem',
        boxShadow: '0 4px 16px rgba(var(--color-primary-rgb), 0.08), 0 10px 40px rgba(var(--color-primary-rgb), 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(var(--color-primary-rgb), 0.04)',
      }}>
      {/* Day headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
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
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        background: 'rgba(var(--color-primary-rgb), 0.14)',
        border: '1px solid rgba(var(--color-primary-rgb), 0.14)',
        borderRadius: '0.75rem',
        overflow: 'hidden',
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}>
        {padded.map((day, i) => {
          const weekday = i % 7
          const isOpenDay = OPEN_WEEKDAYS.has(weekday)
          if (day === null) {
            return <div key={`empty-${i}`} style={{ background: 'rgba(255,255,255,0.35)', minHeight: compact ? '2.75rem' : '6rem' }} />
          }
          const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
          const isPast = dateStr < todayStr
          const isToday = dateStr === todayStr
          const dayEvents = eventsByDay.get(day) ?? []
          const hasEvents = dayEvents.length > 0
          const isSelected = selectedDay === day
          const chips = aggregatePartySlots(dayEvents)
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
                background: cellBg,
                // Closed weekdays get a faint diagonal hatch so "nothing here" reads as "closed".
                backgroundImage: !isOpenDay && !isPast
                  ? 'repeating-linear-gradient(135deg, rgba(var(--color-primary-rgb),0.045) 0 2px, transparent 2px 9px)'
                  : undefined,
                boxShadow: isSelected ? 'inset 0 0 0 2px var(--color-primary)' : isToday ? 'inset 0 0 0 2px rgba(var(--color-primary-rgb),0.45)' : 'none',
                opacity: isPast ? 0.55 : 1,
                cursor: hasEvents ? 'pointer' : 'default',
                transition: 'background 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (hasEvents && !isSelected) e.currentTarget.style.background = 'rgba(var(--color-primary-rgb), 0.07)'
              }}
              onMouseLeave={(e) => {
                if (hasEvents && !isSelected) e.currentTarget.style.background = cellBg
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
                  <span style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                    {Array.from(new Set(dayEvents.map((e) => e.kind))).slice(0, 4).map((kind) => (
                      <span key={kind} style={{ display: 'block', width: '6px', height: '6px', borderRadius: '50%', background: KIND_COLORS[kind] }} />
                    ))}
                  </span>
                )
              ) : (
                <>
                  {chips.slice(0, 4).map((e) => {
                    const clickable = !!e.href
                    const color = KIND_COLORS[e.kind]
                    const time = e.kind === 'event' ? '' : chipTime(e.startTime)
                    const chipStyle: CSSProperties = {
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.3rem',
                      fontSize: '0.6875rem',
                      lineHeight: 1.25,
                      fontWeight: 500,
                      color: 'var(--color-dark)',
                      background: KIND_SOFT[e.kind],
                      borderLeft: `3px solid ${color}`,
                      borderRadius: '4px',
                      padding: '3px 6px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textDecoration: 'none',
                      cursor: clickable ? 'pointer' : 'default',
                      transition: 'filter 0.15s ease',
                    }
                    const inner = (
                      <>
                        {time && <span style={{ flexShrink: 0, fontSize: '0.625rem', fontWeight: 700, color: KIND_INK[e.kind], letterSpacing: '0.02em' }}>{time}</span>}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
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

      {/* Legend — pills that match the chips, plus the closed-day key */}
      {monthKinds.length > 0 && (
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
            Closed Mon–Wed
          </span>
        </div>
      )}
      </div>
      )}

      {/* List view: upcoming day cards, party slots collapsed */}
      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '44rem', margin: '0 auto' }}>
          {dayGroups.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '3rem 0' }}>
              {listLoading ? 'Loading…' : 'Nothing scheduled yet — check back soon.'}
            </p>
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
                  }
                  const inner = (
                    <>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <span style={{ display: 'block', fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3, color: 'var(--color-dark)' }}>
                          {e.title}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', marginTop: '0.125rem', fontSize: '0.8125rem', lineHeight: 1.4, color: 'var(--color-text)' }}>
                          <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', marginTop: '0.35em', borderRadius: '9999px', background: KIND_COLORS[e.kind], flexShrink: 0 }} />
                          <span style={{ minWidth: 0 }}>{rowMetaText(e)}</span>
                        </span>
                      </div>
                      {action && (
                        <span style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: '0.875rem', fontWeight: 600, color: KIND_INK[e.kind] }}>
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

          {/* Extend the window one month at a time. */}
          <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
            <button
              onClick={() => setListMonths((n) => n + 1)}
              disabled={listLoading}
              style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.9375rem', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', opacity: listLoading ? 0.6 : 1 }}
            >
              {listLoading ? 'Loading…' : 'Show more →'}
            </button>
          </div>
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
                  ? `1px solid color-mix(in srgb, ${KIND_COLORS[e.kind]} 35%, transparent)`
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
                    background: KIND_COLORS[e.kind],
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
                      {KIND_LABELS[e.kind]}
                    </span>
                  </div>
                  {clickable && (
                    <span style={{
                      flexShrink: 0,
                      fontSize: e.kind === 'party-available' ? '0.8125rem' : '1.1rem',
                      fontWeight: e.kind === 'party-available' ? 600 : 400,
                      color: KIND_INK[e.kind],
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
