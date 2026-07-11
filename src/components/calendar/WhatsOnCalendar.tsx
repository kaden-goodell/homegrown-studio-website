import { useState, useMemo, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { groupEventsByDay } from './calendar-view-model'
import type { CalendarEvent } from './calendar-view-model'

interface WhatsOnCalendarProps {
  /**
   * Optional initial events (e.g. SSR-rendered first month). After mount the
   * component fetches per-month from /api/calendar.json and state takes over.
   */
  events?: CalendarEvent[]
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Color-coding by event kind. Reuses the studio palette (primary/accent),
// plus an inviting green for bookable parties and a muted grey for reserved ones.
const KIND_COLORS: Record<CalendarEvent['kind'], string> = {
  workshop: 'var(--color-primary)',
  'open-studio': 'var(--color-accent)',
  event: '#7c9a6b',
  'party-available': '#5a8a4a',
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
 * the month grid ("🎉 4 party times open" → /book with the date preselected).
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
    title: `🎉 ${partySlots.length} party times open`,
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

/** "9:00" from "09:00"; "16:00" stays "16:00". */
function trimTime(t?: string) {
  if (!t) return ''
  return t.replace(/^0(\d:)/, '$1')
}

function timeRange(e: CalendarEvent) {
  if (!e.startTime) return ''
  if (!e.endTime) return trimTime(e.startTime)
  return `${trimTime(e.startTime)}–${trimTime(e.endTime)}`
}

/** Label shown in a selected-day row, e.g. "Open Studio · 9:00–18:00 (walk-in)". */
function eventLine(e: CalendarEvent) {
  // Party events carry their own descriptive titles already (time / "Reserved").
  if (e.kind === 'party-available' || e.kind === 'party-booked') return e.title
  const range = timeRange(e)
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
 * Where a list-view row links. CalendarEvent.href is already correct per kind
 * (workshop → /workshops?w=<realId>, collapsed party summary → /book?date=<date>
 * from groupEventsByDay). Do NOT build /workshops?w=${e.id} — event ids are
 * prefixed ("workshop-<id>") and would break the deeplink matcher.
 */
function eventHref(e: CalendarEvent): string | null {
  if (e.kind === 'party-booked') return null // sold out — informational only
  if (e.kind === 'open-studio') return '/open-studio'
  return e.href ?? null
}

/** List|Month toggle pill (inlined; WorkshopExplorer's original is being removed). */
function pillStyle(active: boolean): CSSProperties {
  return active
    ? {
        background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))',
        color: 'white',
        boxShadow: '0 4px 15px rgba(150, 112, 91, 0.2)',
      }
    : {
        background: 'rgba(255, 255, 255, 0.75)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(150, 112, 91, 0.06)',
        color: 'var(--color-text)',
      }
}

export default function WhatsOnCalendar({ events: initialEvents = [] }: WhatsOnCalendarProps) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [view, setView] = useState<'list' | 'month'>('list')
  const [compact, setCompact] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents)
  const [loading, setLoading] = useState(false)

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
    let cancelled = false
    const monthParam = `${year}-${String(month + 1).padStart(2, '0')}`
    setLoading(true)
    fetch(`/api/calendar.json?month=${monthParam}`)
      .then((res) => {
        if (!res.ok) throw new Error(`calendar fetch failed: ${res.status}`)
        return res.json()
      })
      .then((data: { events?: CalendarEvent[] }) => {
        if (cancelled) return
        setEvents(Array.isArray(data?.events) ? data.events : [])
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
  }, [year, month])

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

  // List view: upcoming days for the fetched month, party slots collapsed.
  const dayGroups = useMemo(() => groupEventsByDay(events, todayISO()), [events])

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
      {/* Month nav — controls both list and month views */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1.25rem',
      }}>
        <button
          onClick={prevMonth}
          aria-label="Previous month"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.25rem',
            height: '2.25rem',
            fontSize: '1.25rem',
            color: 'var(--color-muted)',
            background: 'none',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
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
          {formatMonthYear(year, month)}
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
            width: '2.25rem',
            height: '2.25rem',
            fontSize: '1.25rem',
            color: 'var(--color-muted)',
            background: 'none',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            transition: 'color 0.2s ease',
          }}
        >
          &rsaquo;
        </button>
      </div>

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
        background: 'linear-gradient(135deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.85) 100%)',
        backdropFilter: 'blur(20px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
        border: '1px solid rgba(255, 255, 255, 0.5)',
        borderRadius: '1rem',
        padding: '1.5rem',
        boxShadow: '0 4px 16px rgba(150, 112, 91, 0.08), 0 10px 40px rgba(150, 112, 91, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -1px 0 rgba(150, 112, 91, 0.04)',
      }}>
      {/* Day headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? 'repeat(7, 1fr)' : 'repeat(7, minmax(4.5rem, 1fr))',
        gap: '2px',
        marginBottom: '0.5rem',
      }}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={{
            textAlign: 'center',
            fontSize: '0.6875rem',
            fontWeight: 500,
            letterSpacing: '0.05em',
            color: 'var(--color-muted)',
            padding: '0.25rem 0',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? 'repeat(7, 1fr)' : 'repeat(7, minmax(4.5rem, 1fr))',
        gap: compact ? '2px' : '4px',
        opacity: loading ? 0.5 : 1,
        transition: 'opacity 0.2s ease',
      }}>
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />
          const dayEvents = eventsByDay.get(day) ?? []
          const hasEvents = dayEvents.length > 0
          const isSelected = selectedDay === day
          return (
            <div
              key={day}
              role="button"
              tabIndex={hasEvents ? 0 : -1}
              onClick={() => handleDayClick(day)}
              onKeyDown={(ev) => {
                if (hasEvents && (ev.key === 'Enter' || ev.key === ' ')) {
                  ev.preventDefault()
                  handleDayClick(day)
                }
              }}
              style={{
                width: '100%',
                minHeight: compact ? '2.5rem' : '5.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: compact ? 'center' : 'stretch',
                justifyContent: compact ? 'center' : 'flex-start',
                padding: compact ? '0.25rem' : '0.25rem 0.3rem',
                fontSize: '0.8125rem',
                fontWeight: isSelected ? 600 : 400,
                color: isSelected
                  ? '#fff'
                  : hasEvents
                    ? 'var(--color-dark)'
                    : 'rgba(150, 112, 91, 0.3)',
                background: isSelected
                  ? 'linear-gradient(135deg, var(--color-primary), var(--color-accent))'
                  : 'transparent',
                border: 'none',
                borderRadius: '0.5rem',
                cursor: hasEvents ? 'pointer' : 'default',
                transition: 'background 0.2s ease',
                textAlign: compact ? 'center' : 'left',
              }}
              onMouseEnter={(e) => {
                if (hasEvents && !isSelected) {
                  e.currentTarget.style.background = 'rgba(150, 112, 91, 0.08)'
                }
              }}
              onMouseLeave={(e) => {
                if (hasEvents && !isSelected) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 500,
                marginBottom: '0.125rem',
              }}>
                {day}
              </span>
              {compact ? (
                hasEvents && (
                  <span style={{ display: 'flex', gap: '2px', justifyContent: 'center' }}>
                    {Array.from(new Set(dayEvents.map((e) => e.kind))).slice(0, 5).map((kind) => (
                      <span
                        key={kind}
                        style={{
                          display: 'block',
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          background: isSelected ? 'rgba(255,255,255,0.85)' : KIND_COLORS[kind],
                        }}
                      />
                    ))}
                  </span>
                )
              ) : (
                <>
                  {aggregatePartySlots(dayEvents).slice(0, 5).map((e) => {
                    const clickable = e.bookable && !!e.href
                    const chipStyle = {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontSize: '0.625rem',
                      lineHeight: 1.3,
                      fontWeight: 500,
                      color: isSelected ? 'rgba(255,255,255,0.85)' : 'var(--color-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginBottom: '2px',
                      textDecoration: clickable ? 'underline' : 'none',
                      textDecorationColor: clickable ? `${KIND_COLORS[e.kind]}66` : undefined,
                      textUnderlineOffset: '2px',
                      cursor: clickable ? 'pointer' : 'default',
                    } as const
                    const chipInner = (
                      <>
                        <span
                          style={{
                            flexShrink: 0,
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background: isSelected ? 'rgba(255,255,255,0.85)' : KIND_COLORS[e.kind],
                          }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.title}
                        </span>
                      </>
                    )
                    return clickable ? (
                      <a
                        key={e.id}
                        href={e.href}
                        title={e.title}
                        onClick={(ev) => ev.stopPropagation()}
                        style={chipStyle}
                      >
                        {chipInner}
                      </a>
                    ) : (
                      <span key={e.id} title={e.title} style={chipStyle}>
                        {chipInner}
                      </span>
                    )
                  })}
                  {aggregatePartySlots(dayEvents).length > 5 && (
                    <span style={{
                      fontSize: '0.5625rem',
                      color: isSelected ? 'rgba(255,255,255,0.6)' : 'var(--color-muted)',
                    }}>
                      +{aggregatePartySlots(dayEvents).length - 5} more
                    </span>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      {monthKinds.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          marginTop: '1.25rem',
          paddingTop: '1rem',
          borderTop: '1px solid rgba(150, 112, 91, 0.08)',
        }}>
          {monthKinds.map((kind) => (
            <span key={kind} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: '0.6875rem',
              fontWeight: 500,
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
              color: 'var(--color-muted)',
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: KIND_COLORS[kind],
              }} />
              {KIND_LABELS[kind]}
            </span>
          ))}
        </div>
      )}
      </div>
      )}

      {/* List view: upcoming day cards, party slots collapsed */}
      {view === 'list' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '44rem', margin: '0 auto' }}>
          {dayGroups.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--color-muted)', padding: '3rem 0' }}>
              Nothing else on this month —{' '}
              <button
                onClick={nextMonth}
                style={{ color: 'var(--color-primary)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
              >
                peek at next month
              </button>
            </p>
          )}
          {dayGroups.map((day) => (
            <div key={day.date} className="glass" style={{ borderRadius: '1rem', padding: '1.25rem 1.5rem' }}>
              <p className="font-heading" style={{ fontWeight: 700, color: 'var(--color-dark)', marginBottom: '0.75rem' }}>
                {formatDayHeading(day.date)}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {day.events.map((e) => {
                  const href = eventHref(e)
                  const rowStyle: CSSProperties = {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    textDecoration: 'none',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.625rem',
                    transition: 'background 0.2s ease',
                  }
                  const inner = (
                    <>
                      <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', background: KIND_COLORS[e.kind], flexShrink: 0 }} />
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-muted)', width: '5.5rem', flexShrink: 0 }}>
                        {trimTime(e.startTime)}
                      </span>
                      <span style={{ fontSize: '0.9375rem', color: 'var(--color-dark)', flex: 1 }}>{e.title}</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: KIND_COLORS[e.kind], flexShrink: 0 }}>{KIND_LABELS[e.kind]}</span>
                    </>
                  )
                  return href ? (
                    <a
                      key={e.id}
                      href={href}
                      style={rowStyle}
                      onMouseEnter={(ev) => (ev.currentTarget.style.background = 'rgba(150,112,91,0.06)')}
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

          {/* Always offer a way forward — the list is month-scoped by the fetch. */}
          <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
            <button
              onClick={nextMonth}
              style={{ color: 'var(--color-primary)', fontWeight: 600, fontSize: '0.9375rem', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }}
            >
              Peek at next month →
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
              const clickable = e.bookable && !!e.href
              const rowStyle = {
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'rgba(255, 255, 255, 0.75)',
                backdropFilter: 'blur(12px)',
                border: clickable
                  ? `1px solid ${KIND_COLORS[e.kind]}33`
                  : '1px solid rgba(150, 112, 91, 0.06)',
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
                      color: KIND_COLORS[e.kind],
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
