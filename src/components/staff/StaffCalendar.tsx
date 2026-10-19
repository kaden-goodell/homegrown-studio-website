import { useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { card, btn, Badge } from '@components/staff/ui'
import { addDays } from '@lib/kit-dates'
import { formatCalendarDay, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'

const KIND: Record<CalendarItem['kind'], { icon: string; colour: string; word: string }> = {
  class: { icon: '🧵', colour: 'var(--color-primary)', word: 'Class' },
  'legacy-class': { icon: '🧵', colour: 'var(--color-primary)', word: 'Class' },
  party: { icon: '🎉', colour: '#b45309', word: 'Party' },
  cafe: { icon: '☕', colour: '#15803d', word: 'Craft Café' },
  blocked: { icon: '⛔', colour: '#6b7280', word: 'Blocked' },
  closed: { icon: '🚪', colour: '#6b7280', word: 'Closed' },
}

/** Monday of the week holding `ymd` (studio-local calendar math). */
function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7))
}

/**
 * The crew's calendar (spec decision: crew see the owners' calendar,
 * read-only): a week at a time, everything holding the room, colour by kind.
 * A class or party opens its roster; nothing here edits anything.
 */
export default function StaffCalendar({
  staff,
  onOpenRoster,
}: {
  staff: StaffMember
  onOpenRoster: (e: { kind: EventKind; id: string; title: string; day?: string }) => void
}) {
  const today = studioDate(new Date().toISOString())
  const [start, setStart] = useState(() => weekStart(today))
  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(from: string) {
    setError(null)
    setItems(null)
    try {
      const q = `from=${encodeURIComponent(studioDayUtcRange(from).startIso)}&to=${encodeURIComponent(studioDayUtcRange(addDays(from, 6)).endIso)}`
      const res = await fetch(`/api/staff/calendar.json?${q}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t load the calendar.'); return }
      setItems(json.data.items as CalendarItem[])
    } catch {
      setError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }
  useEffect(() => { load(start) }, [start])

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const onDay = (d: string) => (items ?? []).filter((it) => studioDate(it.startIso) === d).sort((a, b) => a.startIso.localeCompare(b.startIso))
  const opens = (it: CalendarItem): { kind: EventKind; id: string } | null =>
    it.kind === 'class' || it.kind === 'legacy-class' ? { kind: 'workshop', id: it.id } : it.kind === 'party' ? { kind: 'party', id: it.id } : null

  return (
    <div>
      <StaffHeader title="Calendar" staff={staff} />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setStart(addDays(start, -7))} style={{ ...btn(), minHeight: '2.75rem' }} aria-label="Previous week">‹ Prev</button>
        <strong style={{ color: 'var(--color-dark)' }}>{`${formatCalendarDay(days[0])} – ${formatCalendarDay(days[6])}`}</strong>
        <span style={{ display: 'inline-flex', gap: '0.4rem' }}>
          {start !== weekStart(today) && <button type="button" onClick={() => setStart(weekStart(today))} style={{ ...btn(), minHeight: '2.75rem' }}>This week</button>}
          <button type="button" onClick={() => setStart(addDays(start, 7))} style={{ ...btn(), minHeight: '2.75rem' }} aria-label="Next week">Next ›</button>
        </span>
      </div>

      {error && (
        <div role="alert" style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-error)' }}>{error}</p>
          <button type="button" onClick={() => load(start)} style={btn()}>Retry</button>
        </div>
      )}
      {!items && !error && <p style={{ color: 'var(--color-muted)', textAlign: 'center' }}>Loading…</p>}

      {items && days.map((d) => {
        const list = onDay(d)
        return (
          <section key={d} aria-label={d === today ? 'Today' : formatCalendarDay(d)} style={{ marginBottom: '1rem' }}>
            <h2 style={{ margin: '0 0 0.4rem', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>
              {d === today ? `Today · ${formatCalendarDay(d)}` : formatCalendarDay(d)}
            </h2>
            {list.length === 0 && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-muted)' }}>Nothing on</p>}
            {list.map((it) => {
              const k = KIND[it.kind]
              const target = opens(it)
              const body = (
                <>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span aria-hidden="true">{k.icon}</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{it.label}</span>
                      {it.status === 'cancelled' && <Badge tone="alert">Cancelled</Badge>}
                      {it.status === 'closed' && <Badge tone="muted">Sign-ups closed</Badge>}
                    </span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{formatTimeSpan(it.startIso, it.endIso)}</span>
                  </span>
                  <span style={{ display: 'block', marginTop: '0.2rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{k.word}</span>
                </>
              )
              const style = { ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left' as const, display: 'block', marginBottom: '0.5rem', borderLeft: `4px solid ${k.colour}` }
              return target ? (
                <button key={`${it.kind}:${it.id}:${it.startIso}`} type="button" data-testid="calendar-item" onClick={() => onOpenRoster({ ...target, title: it.label, day: d })} style={{ ...style, cursor: 'pointer' }}>{body}</button>
              ) : (
                <div key={`${it.kind}:${it.id}:${it.startIso}`} data-testid="calendar-item" style={style}>{body}</div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
