import { useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { type HouseholdMatch } from '@components/staff/DoorSearch'
import { card, btn, Badge } from '@components/staff/ui'
import { cafeRunsOn } from '@lib/cafe-days'
import { cafeHoursOn, formatRange } from '@config/hours'
import { addDays } from '@lib/kit-dates'
import { formatTime, formatCalendarDay, studioDate } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'
import type { PrepOption } from '@lib/seat-options'

export interface WeekRow {
  kind: EventKind
  id: string
  title: string
  startIso: string
  days: string[]
  dropOff: boolean
  /** Seats sold (classes). */
  sold?: number
  /** Guests booked (parties). */
  guests?: number
  prep?: PrepOption[]
}

const WEEK_DAYS = 7
const ICON: Record<EventKind, string> = { party: '🎉', workshop: '🧵', program: '🌙' }

/**
 * The staff landing tab (Kaden, 15 Oct 2026: "what's today and what's coming
 * up that needs prep over the next week"): today and the next six days, every
 * class and party, with what to prep for classes with picks. Tap a row for
 * its roster.
 */
export default function ThisWeek({
  staff,
  onOpenRoster,
}: {
  staff: StaffMember
  onOpenRoster: (e: { kind: EventKind; id: string; title: string; addFamily?: { household?: HouseholdMatch } }) => void
}) {
  const today = studioDate(new Date().toISOString())
  const [rows, setRows] = useState<WeekRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await fetch('/api/staff/week.json', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t load this week.'); return }
      setRows(json.data.events as WeekRow[])
    } catch {
      setError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }
  useEffect(() => { load() }, [])

  const days = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(today, i))
  const onDay = (d: string) => (rows ?? []).filter((r) => r.days.includes(d)).sort((a, b) => a.startIso.localeCompare(b.startIso))
  const prepCount = (rows ?? []).filter((r) => r.prep?.some((o) => o.counts.length > 0)).length

  return (
    <div>
      <StaffHeader title="This week" staff={staff} onOpenRoster={onOpenRoster} />

      {error && (
        <div role="alert" style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-error)' }}>{error}</p>
          <button type="button" onClick={load} style={btn()}>Retry</button>
        </div>
      )}
      {!rows && !error && <p style={{ color: 'var(--color-muted)', textAlign: 'center' }}>Loading…</p>}

      {rows && (
        <>
          <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--color-muted)' }}>
            {rows.length === 0
              ? 'Nothing booked in the next 7 days.'
              : `${rows.length} event${rows.length === 1 ? '' : 's'} in the next 7 days${prepCount ? ` · ${prepCount} with picks to prep` : ''}`}
          </p>
          {days.map((d) => {
            const list = onDay(d)
            const cafe = cafeRunsOn(d) ? cafeHoursOn(d) : null
            if (list.length === 0 && !cafe && d !== today) return null
            return (
              <section key={d} aria-label={d === today ? 'Today' : formatCalendarDay(d)} style={{ marginBottom: '1.25rem' }}>
                <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>
                  {d === today ? `Today · ${formatCalendarDay(d)}` : formatCalendarDay(d)}
                </h2>
                {cafe && (
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: 'var(--color-dark)' }}>☕ Craft Café {formatRange(cafe.opens, cafe.closes)}</p>
                )}
                {list.length === 0 && !cafe && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-muted)' }}>Nothing scheduled</p>}
                {list.map((e) => (
                  <button
                    key={`${e.kind}:${e.id}`}
                    type="button"
                    onClick={() => onOpenRoster({ kind: e.kind, id: e.id, title: e.title })}
                    style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block', marginBottom: '0.5rem' }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span aria-hidden="true">{ICON[e.kind]}</span>
                        <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{e.title}</span>
                        {e.dropOff && <Badge tone="alert">DROP-OFF</Badge>}
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{formatTime(e.startIso)}</span>
                    </span>
                    <span style={{ display: 'block', margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                      {e.kind === 'party'
                        ? typeof e.guests === 'number' ? `${e.guests} guest${e.guests === 1 ? '' : 's'}` : 'Party'
                        : typeof e.sold === 'number' ? `${e.sold} seat${e.sold === 1 ? '' : 's'} booked` : 'Class'}
                    </span>
                    {e.prep?.map((o) => (
                      <span key={o.id} data-testid="week-prep" style={{ display: 'block', margin: '0.35rem 0 0', fontSize: '0.95rem', color: 'var(--color-dark)', lineHeight: 1.45 }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--color-primary)', marginRight: '0.45rem' }}>PREP</span>
                        {e.prep!.length > 1 && <span style={{ color: 'var(--color-muted)' }}>{o.label}: </span>}
                        {o.counts.length ? o.counts.map((c) => `${c.choice} ${c.n}`).join(' · ') : <span style={{ color: 'var(--color-muted)' }}>no picks yet</span>}
                        {o.unpicked > 0 && o.counts.length > 0 && <span style={{ color: 'var(--color-error)' }}>{` · ${o.unpicked} no pick yet`}</span>}
                      </span>
                    ))}
                  </button>
                ))}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
