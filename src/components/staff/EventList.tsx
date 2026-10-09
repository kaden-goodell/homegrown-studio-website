import { useEffect, useState } from 'react'
import { card, btn, Badge } from '@components/staff/ui'
import { formatTime, formatCalendarDay } from '@lib/studio-time'
import { addDays } from '@lib/kit-dates'
import type { EventKind, EventSources, StudioEvent } from '@lib/events'

export interface EventRow extends StudioEvent {
  rsvpCount: number
  hereNow: number
  rsvpWaiverIds?: string[]
}

const SOURCE_LABEL: Record<keyof EventSources, string> = { parties: 'Parties', workshops: 'Workshops' }

const ICON: Record<EventKind, string> = { party: '🎉', workshop: '🧵', program: '🌙' }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export function readDayParam(): string | null {
  try {
    const d = new URLSearchParams(window.location.search).get('day')
    return d && DAY_RE.test(d) && !Number.isNaN(Date.parse(d)) ? d : null
  } catch {
    return null
  }
}

export function writeDayParam(day: string | null): void {
  try {
    const params = new URLSearchParams(window.location.search)
    if (day) params.set('day', day)
    else params.delete('day')
    const qs = params.toString()
    const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash
    if (next !== window.location.pathname + window.location.search + window.location.hash) history.replaceState(history.state, '', next)
  } catch { /* address bar is a convenience */ }
}

/**
 * Today's (or any day's) scheduled events — parties, workshops, programs —
 * with a date stepper so staff can peek at tomorrow's roster ahead of time
 * (HOM-208 §6). Tapping a row opens its roster.
 */
export default function EventList({
  date,
  onOpenRoster,
  onLoaded,
  stepper = true,
  start,
}: {
  /** The actual studio-local "today". */
  date: string
  /** false = today only (the Today tab): no day stepper, no ?day in the address. */
  stepper?: boolean
  /** Where the stepper starts when the address has no ?day (Upcoming: tomorrow). */
  start?: string
  onOpenRoster: (e: { kind: EventKind; id: string; title: string }) => void
  /** Reports the events for `date` (the real today) — Today's door chips use it. */
  onLoaded?: (events: EventRow[]) => void
}) {
  // The day being viewed lives in the address (?day=YYYY-MM-DD) so a refresh,
  // or coming back from a roster, stays on it. Today itself drops the param.
  const [cursor, setCursor] = useState(() => (stepper ? readDayParam() ?? start ?? date : date))
  const [events, setEvents] = useState<EventRow[]>([])
  const [error, setError] = useState<string | null>(null)
  // Which source systems failed on the last successful load (F2) — one of
  // them being down is a one-line note, not a red wall.
  const [downSources, setDownSources] = useState<(keyof EventSources)[]>([])
  const [loading, setLoading] = useState(false)

  async function load(d: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/staff/events.json?date=${d}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t load events.'); setDownSources([]); return }
      setEvents(json.data.events)
      if (d === date) onLoaded?.(json.data.events)
      const sources: Partial<EventSources> = json.data.sources ?? {}
      setDownSources((Object.keys(SOURCE_LABEL) as (keyof EventSources)[]).filter((s) => sources[s] === 'error'))
    } catch {
      setError('Couldn’t reach storage — check wifi and try again.')
      setDownSources([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(cursor) }, [cursor])
  useEffect(() => { if (stepper) writeDayParam(cursor === date ? null : cursor) }, [cursor, date, stepper])

  // The door's event chips always need TODAY's events, even when a refresh
  // lands the stepper on another day.
  useEffect(() => {
    if (cursor === date || !onLoaded) return
    fetch(`/api/staff/events.json?date=${date}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => { if (json?.data?.events) onLoaded(json.data.events) })
      .catch(() => {})
  }, [date])

  const isToday = cursor === date
  const label = isToday ? `Today · ${formatCalendarDay(cursor)}` : cursor === addDays(date, 1) ? `Tomorrow · ${formatCalendarDay(cursor)}` : formatCalendarDay(cursor)

  return (
    <div>
      {!stepper && (
        <h3 style={{ margin: '0 0 0.6rem', fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', fontSize: '1.15rem' }}>{label}</h3>
      )}
      {stepper && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
        <button type="button" onClick={() => setCursor((c) => addDays(c, -1))} aria-label="Previous day" style={{ ...btn(), minWidth: '2.75rem', minHeight: '2.75rem' }}>‹</button>
        <h3 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontWeight: 600, color: 'var(--color-dark)', fontSize: '1.15rem' }}>{label}</h3>
        <button type="button" onClick={() => setCursor((c) => addDays(c, 1))} aria-label="Next day" style={{ ...btn(), minWidth: '2.75rem', minHeight: '2.75rem' }}>›</button>
      </div>}

      {error && (
        <div style={{ background: 'rgba(185,28,28,0.08)', border: '1px solid rgba(185,28,28,0.3)', borderRadius: '0.6rem', padding: '0.7rem 0.9rem', marginBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, fontSize: '0.875rem', color: '#b91c1c', fontWeight: 600 }}>{error}</span>
          <button type="button" onClick={() => load(cursor)} style={btn()}>Retry</button>
        </div>
      )}

      {/* One source down — the rest of the list is real, so say what's missing
          in one quiet line instead of blanking the day (F2). */}
      {!error && downSources.length > 0 && (
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0 0 0.6rem', fontWeight: 600 }}>
          {downSources.map((s) => SOURCE_LABEL[s]).join(' and ')} unavailable right now —{' '}
          <button
            type="button"
            onClick={() => load(cursor)}
            style={{ ...btn(), padding: '0.15rem 0.45rem', fontSize: '0.78125rem' }}
          >
            Retry
          </button>
        </p>
      )}

      {!loading && !error && events.length === 0 && downSources.length === 0 && (
        <p style={{ color: 'var(--color-muted)' }}>
          {isToday ? 'Nothing scheduled today — walk-ins only.' : 'Nothing scheduled — walk-ins only.'}
        </p>
      )}

      {events.map((e) => {
        const dayIndex = e.days.indexOf(cursor)
        const multiDay = e.days.length > 1
        return (
          <button
            key={`${e.kind}:${e.id}`}
            type="button"
            onClick={() => onOpenRoster({ kind: e.kind, id: e.id, title: e.title })}
            style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block', minHeight: '2.75rem' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.35rem' }}>
              <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span aria-hidden="true">{ICON[e.kind]}</span>
                <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{e.title}</span>
                {e.dropOff && <Badge tone="alert">DROP-OFF</Badge>}
                {multiDay && <Badge tone="muted">Day {dayIndex + 1} of {e.days.length}</Badge>}
              </span>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{formatTime(e.startIso)}</span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0.3rem 0 0' }}>
              <strong style={{ color: 'var(--color-dark)' }}>{e.rsvpCount}</strong> RSVP’d · <strong style={{ color: 'var(--color-dark)' }}>{e.hereNow}</strong> here
            </p>
          </button>
        )
      })}
    </div>
  )
}
