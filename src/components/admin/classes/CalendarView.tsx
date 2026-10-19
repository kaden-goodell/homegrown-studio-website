import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { formatTimeSpan } from '@lib/studio-time'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED, CALENDAR } from './api'
import { addDays, addMonths, dayLabel, dayStartIso, monthLabel, monthStart, today, weekStart } from './dates'
import { box, errorText, muted, quiet, row } from './ui'

/** One colour per kind, the same in the legend and on every item (rgb so tests read it back as written). */
export const KIND_STYLE = {
  class: { label: 'Our class', colour: 'rgb(37, 99, 235)' },
  'legacy-class': { label: 'Square class', colour: 'rgb(124, 58, 237)' },
  party: { label: 'Party', colour: 'rgb(219, 39, 119)' },
  cafe: { label: 'Craft Café', colour: 'rgb(5, 150, 105)' },
  blocked: { label: 'Blocked', colour: 'rgb(75, 85, 99)' },
  closed: { label: 'Closed', colour: 'rgb(185, 28, 28)' },
} as const

const STATUS_WORD: Record<string, string> = { draft: 'Draft', closed: 'Sign-ups closed', open: '' }

type View = 'week' | 'month'

/** The days an item touches (a closed day runs midnight to midnight). */
function daysOf(i: CalendarItem): string[] {
  const first = localDate(i.startIso)
  const last = localDate(new Date(Math.max(Date.parse(i.startIso), Date.parse(i.endIso) - 1)).toISOString())
  const out = [first]
  while (out[out.length - 1] < last && out.length < 40) out.push(addDays(out[out.length - 1], 1))
  return out
}

function rangeOf(view: View, day: string): { from: string; days: string[] } {
  if (view === 'week') {
    const from = weekStart(day)
    return { from, days: Array.from({ length: 7 }, (_, n) => addDays(from, n)) }
  }
  const first = monthStart(day)
  const from = weekStart(first)
  const end = addDays(weekStart(addDays(addMonths(first, 1), -1)), 7)
  const days: string[] = []
  for (let d = from; d < end; d = addDays(d, 1)) days.push(d)
  return { from, days }
}

/**
 * /admin Calendar: everything that holds the room, week by week (the default)
 * or a month at a time. On a phone the week is a list of days; wider, seven
 * columns. Tap our class to open it, blocked time to remove it, anything
 * else to see what it is.
 */
export default function CalendarView({ initialDay, onOpenClass, onPrintDay }: {
  initialDay?: string
  onOpenClass: (id: string) => void
  onPrintDay: (day: string) => void
}) {
  const [view, setView] = useState<View>('week')
  const [day, setDay] = useState(initialDay ?? today())
  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [error, setError] = useState('')
  /** The item tapped and the day list it was tapped in; its detail opens right under it. */
  const [picked, setPicked] = useState<{ item: CalendarItem; day: string } | null>(null)
  const [reload, setReload] = useState(0)
  const { days } = rangeOf(view, day)

  useEffect(() => {
    let live = true
    setError('')
    setItems(null)
    const q = new URLSearchParams({ from: dayStartIso(days[0]), to: dayStartIso(addDays(days[days.length - 1], 1)) })
    api<{ items: CalendarItem[] }>(`${CALENDAR}?${q}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setItems(r.data.items)
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [view, days[0], reload])

  const byDay = new Map<string, CalendarItem[]>()
  for (const i of items ?? []) for (const d of daysOf(i)) byDay.set(d, [...(byDay.get(d) ?? []), i])

  function tap(i: CalendarItem, d: string) {
    if (i.kind === 'class') return onOpenClass(i.id)
    setPicked({ item: i, day: d })
  }
  const detail = picked && (
    <Detail
      key={`${picked.item.id}-${picked.item.startIso}`}
      item={picked.item}
      onClose={() => setPicked(null)}
      onRemoved={() => { setPicked(null); setReload((n) => n + 1) }}
    />
  )
  const dayList = (d: string, key?: string) => (
    <DayList key={key} day={d} items={byDay.get(d) ?? []} onTap={tap} onPrint={onPrintDay} picked={picked?.day === d ? picked.item : null} detail={detail} />
  )

  const step = (n: number) => { setPicked(null); setDay(view === 'week' ? addDays(day, 7 * n) : addMonths(monthStart(day), n)) }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <style>{`
        .cal-week { display: grid; gap: 0.75rem; grid-template-columns: 1fr; }
        @media (min-width: 900px) { .cal-week { grid-template-columns: repeat(7, minmax(0, 1fr)); } }
        .cal-month { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 0.25rem; }
      `}</style>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <h1 className="font-heading" style={{ margin: 0, fontSize: '1.75rem', color: 'var(--color-dark)' }}>
          {view === 'week' ? `Week of ${dayLabel(days[0])}` : monthLabel(monthStart(day))}
        </h1>
        <div role="group" aria-label="View" style={row}>
          {(['week', 'month'] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => { setPicked(null); setView(v) }}>
              {v === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </div>
      <div style={row}>
        <button type="button" className="btn btn-secondary" onClick={() => step(-1)}>{view === 'week' ? 'Last week' : 'Last month'}</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setPicked(null); setDay(today()) }}>Today</button>
        <button type="button" className="btn btn-secondary" onClick={() => step(1)}>{view === 'week' ? 'Next week' : 'Next month'}</button>
      </div>
      <Legend />
      {error && (
        <p role="alert" style={errorText}>{error} <button type="button" className="btn btn-secondary" onClick={() => setReload((n) => n + 1)}>Try again</button></p>
      )}
      {!error && !items && <p style={muted}>Loading…</p>}
      {items && view === 'week' && (
        <div className="cal-week">
          {days.map((d) => dayList(d, d))}
        </div>
      )}
      {items && view === 'month' && (
        <>
          <div className="cal-month">
            {days.map((d) => {
              const list = byDay.get(d) ?? []
              const inMonth = d.slice(0, 7) === day.slice(0, 7)
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={d === day}
                  aria-label={`${dayLabel(d)}, ${list.length === 1 ? '1 thing' : `${list.length} things`}`}
                  onClick={() => { setPicked(null); setDay(d) }}
                  style={{
                    minHeight: '3.5rem', padding: '0.3rem', borderRadius: '0.5rem', textAlign: 'left', cursor: 'pointer',
                    border: d === day ? '2px solid var(--color-primary)' : '1px solid var(--color-line)',
                    background: 'var(--color-surface)', opacity: inMonth ? 1 : 0.5, color: 'var(--color-dark)',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{Number(d.slice(8))}</span>
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '0.2rem' }}>
                    {list.slice(0, 6).map((i) => (
                      <span key={`${i.id}-${i.sessionId ?? i.startIso}`} style={{ width: 8, height: 8, borderRadius: 4, background: KIND_STYLE[i.kind].colour }} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
          {dayList(day)}
        </>
      )}
    </div>
  )
}

function Legend() {
  return (
    <ul aria-label="Colours" style={{ ...row, listStyle: 'none', margin: 0, padding: 0, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
      {Object.entries(KIND_STYLE).map(([k, s]) => (
        <li key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: s.colour }} />{s.label}
        </li>
      ))}
    </ul>
  )
}

const sameItem = (a: CalendarItem, b: CalendarItem | null) => !!b && a.id === b.id && a.startIso === b.startIso

/** One day's items; the tapped item's detail sits right under it, so on a phone it opens where the finger is. */
function DayList({ day, items, onTap, onPrint, picked, detail }: {
  day: string
  items: CalendarItem[]
  onTap: (i: CalendarItem, day: string) => void
  onPrint: (day: string) => void
  picked: CalendarItem | null
  detail: ReactNode
}) {
  return (
    <section aria-label={dayLabel(day)} style={{ display: 'grid', gap: '0.4rem', alignContent: 'start', minWidth: 0 }}>
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-dark)' }}>{dayLabel(day)}</h2>
        <button type="button" className="btn btn-quiet" aria-label={`Print ${dayLabel(day)}`} style={{ minHeight: '2.75rem' }} onClick={() => onPrint(day)}>Print</button>
      </div>
      {items.length === 0 && <p style={{ ...muted, margin: 0, fontSize: '0.85rem' }}>Nothing on.</p>}
      {items.map((i) => {
        const s = KIND_STYLE[i.kind]
        const word = i.kind === 'class' ? STATUS_WORD[i.status ?? 'open'] : ''
        return (
          <Fragment key={`${i.id}-${i.sessionId ?? i.startIso}`}>
          <button
            type="button"
            data-kind={i.kind}
            aria-expanded={i.kind === 'class' ? undefined : sameItem(i, picked)}
            onClick={() => onTap(i, day)}
            style={{
              display: 'grid', gap: '0.1rem', textAlign: 'left', minHeight: '2.75rem', padding: '0.45rem 0.6rem', cursor: 'pointer',
              borderRadius: '0.5rem', border: '1px solid var(--color-line)', borderLeft: `5px solid ${s.colour}`,
              background: i.kind === 'class' && i.status === 'draft' ? 'repeating-linear-gradient(45deg, transparent 0 6px, rgba(0,0,0,0.04) 6px 12px)' : 'var(--color-surface)',
              color: 'var(--color-dark)', overflowWrap: 'anywhere',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{i.kind === 'closed' ? 'All day' : formatTimeSpan(i.startIso, i.endIso)}</span>
            <span style={{ fontWeight: 600 }}>{i.label}</span>
            <span style={{ fontSize: '0.75rem', color: s.colour, fontWeight: 700 }}>{s.label}{word ? ` · ${word}` : ''}</span>
          </button>
          {sameItem(i, picked) && detail}
          </Fragment>
        )
      })}
    </section>
  )
}

/** Read-only detail for anything that isn't our class; blocked time can be removed after a second tap. */
function Detail({ item, onClose, onRemoved }: { item: CalendarItem; onClose: () => void; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [])
  async function remove() {
    setBusy(true)
    setError('')
    const r = await api(BLOCKED, { action: 'remove', id: item.id })
    setBusy(false)
    if (r.ok) onRemoved()
    else setError(r.error ?? '')
  }
  return (
    <section ref={ref} role="region" aria-label={item.label} style={box}>
      <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: KIND_STYLE[item.kind].colour }}>{KIND_STYLE[item.kind].label}</p>
      <h2 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--color-dark)' }}>{item.label}</h2>
      <p style={{ margin: 0 }}>{item.kind === 'closed' ? dayLabel(localDate(item.startIso)) : `${dayLabel(localDate(item.startIso))} · ${formatTimeSpan(item.startIso, item.endIso)}`}</p>
      {item.kind === 'legacy-class' && <p style={muted}>This class lives in Square. Change it there.</p>}
      {item.kind === 'party' && <p style={muted}>Parties are managed in Square and on the staff page.</p>}
      {error && <p role="alert" style={errorText}>{error}</p>}
      <div style={row}>
        {item.kind === 'blocked' && !asking && (
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>Remove this blocked time</button>
        )}
        {item.kind === 'blocked' && asking && (
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={remove}>Yes, remove it</button>
            <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>Keep it</button>
          </>
        )}
        <button type="button" className="btn btn-secondary" style={quiet} onClick={onClose}>Close</button>
      </div>
    </section>
  )
}
