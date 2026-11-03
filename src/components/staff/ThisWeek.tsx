import { useEffect, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { type HouseholdMatch } from '@components/staff/DoorSearch'
import { card, btn, Badge } from '@components/staff/ui'
import WarningsPanel from '@components/staff/WarningsPanel'
import { CafeRow, CraftCafeSheet, readCafeParam } from '@components/staff/CraftCafe'
import { cafeOn } from '@lib/cafe-days'
import { addDays } from '@lib/kit-dates'
import { formatTime, formatTimeSpan, formatCalendarDay, studioDate, studioDayUtcRange } from '@lib/studio-time'
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
  /** Seats the class holds (when known). */
  capacity?: number
  /** Guests booked (parties). */
  guests?: number
  /** Parties: when it ends, extra time included. */
  endIso?: string
  /** Parties of ours with something still to pay. */
  waitingOnPayment?: boolean
  /** A party booked in Square before our own party book (read only). */
  squareBooked?: boolean
  prep?: PrepOption[]
  /** Our own classes: each day of theirs this week, with that day's start, seats and prep. */
  byDay?: Record<string, { startIso: string; sold: number; capacity: number; prep?: PrepOption[] }>
}

const WEEK_DAYS = 7
/** At a class start the landing page must be current: it reloads itself this often (crew review M10). */
export const WEEK_REFRESH_MS = 60_000
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
  onOpenRoster: (e: { kind: EventKind; id: string; title: string; day?: string; addFamily?: { household?: HouseholdMatch } }) => void
}) {
  const today = studioDate(new Date().toISOString())
  const [rows, setRows] = useState<WeekRow[] | null>(null)
  /** Craft Café hours by day, from the server (it knows the owners' hours and closed days). */
  const [cafeDays, setCafeDays] = useState<Record<string, { opens: string; closes: string; here?: number }> | null>(null)
  /** The Craft Café sheet open for a day (also `?cafe=` when the iPad comes back from a café waiver). */
  const [cafeOpen, setCafeOpen] = useState<string | null>(null)
  useEffect(() => {
    const d = readCafeParam() // StrictMode's second run finds it already stripped and leaves the sheet alone
    if (d) setCafeOpen(d)
  }, [])
  const [error, setError] = useState<string | null>(null)
  /** "kind:id:day" of everything the signed-in person is on this week (the Calendar tab's ✓ You're on). */
  const [mine, setMine] = useState<Set<string>>(new Set())

  /** `quiet`: the minute refresh — a miss keeps what's on screen instead of flashing an error. */
  async function load(quiet = false) {
    if (!quiet) setError(null)
    try {
      const res = await fetch('/api/staff/week.json', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { if (!quiet) setError(json?.error ?? 'Couldn’t load this week.'); return }
      setRows(json.data.events as WeekRow[])
      setCafeDays(json.data.cafe && typeof json.data.cafe === 'object' ? json.data.cafe : null)
      setError(null)
    } catch {
      if (!quiet) setError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }
  /** My shifts this week: an extra (no tags without it). Keyed per person by StaffConsole. */
  async function loadMine() {
    try {
      const from = studioDayUtcRange(today).startIso
      const to = studioDayUtcRange(addDays(today, WEEK_DAYS - 1)).endIso
      const res = await fetch(`/api/staff/shifts.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      if (json?.data?.me?.id !== staff.id || !Array.isArray(json?.data?.mine)) return
      setMine(new Set((json.data.mine as { event: { status: string; roster?: { kind: string; id: string; day: string } } }[])
        .filter((r) => r.event.status === 'on' && r.event.roster)
        .map((r) => `${r.event.roster!.kind}:${r.event.roster!.id}:${r.event.roster!.day}`)))
    } catch {
      // the tags are an extra
    }
  }
  useEffect(() => {
    load()
    loadMine()
    const t = setInterval(() => { load(true); loadMine() }, WEEK_REFRESH_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const days = Array.from({ length: WEEK_DAYS }, (_, i) => addDays(today, i))
  // A class of ours shows each day as that day is: its own start, seats and prep.
  const asOn = (r: WeekRow, d: string): WeekRow => {
    const day = r.byDay?.[d]
    return day ? { ...r, startIso: day.startIso, sold: day.sold, capacity: day.capacity, prep: day.prep } : r
  }
  const onDay = (d: string) => (rows ?? []).filter((r) => r.days.includes(d)).map((r) => asOn(r, d)).sort((a, b) => a.startIso.localeCompare(b.startIso))
  const prepCount = (rows ?? []).filter((r) => (r.byDay ? Object.values(r.byDay).some((x) => x.prep?.some((o) => o.counts.length > 0)) : r.prep?.some((o) => o.counts.length > 0))).length

  return (
    <div>
      <StaffHeader title="This week" staff={staff} onOpenRoster={onOpenRoster} />

      {/* The door's own warnings, today and tomorrow (crew review I5): the landing page shows them too. */}
      <WarningsPanel onOpenEvent={(e) => onOpenRoster(e)} />

      {error && (
        <div role="alert" style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
          <p style={{ margin: '0 0 0.5rem', color: 'var(--color-error)' }}>{error}</p>
          <button type="button" onClick={() => load()} style={btn()}>Retry</button>
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
            const cafe: { opens: string; closes: string; here?: number } | null = cafeDays ? cafeDays[d] ?? null : cafeOn(d)
            if (list.length === 0 && !cafe && d !== today) return null
            return (
              <section key={d} aria-label={d === today ? 'Today' : formatCalendarDay(d)} style={{ marginBottom: '1.25rem' }}>
                <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-primary)' }}>
                  {d === today ? `Today · ${formatCalendarDay(d)}` : formatCalendarDay(d)}
                </h2>
                {cafe && <CafeRow date={d} hours={cafe} here={d === today ? cafe.here ?? null : null} onOpen={() => setCafeOpen(d)} />}
                {list.length === 0 && !cafe && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-muted)' }}>Nothing scheduled</p>}
                {list.map((e) => (
                  <button
                    key={`${e.kind}:${e.id}`}
                    type="button"
                    onClick={() => onOpenRoster({ kind: e.kind, id: e.id, title: e.title, ...(e.byDay ? { day: d } : {}) })}
                    style={{ ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'block', marginBottom: '0.5rem' }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                      <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span aria-hidden="true">{ICON[e.kind]}</span>
                        <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{e.title}</span>
                        {e.dropOff && <Badge tone="alert">DROP-OFF</Badge>}
                        {mine.has(`${e.kind}:${e.id}:${d}`) && <Badge tone="muted">✓ You’re on</Badge>}
                        {e.waitingOnPayment && <Badge tone="warn">Waiting on payment</Badge>}
                        {e.squareBooked && <Badge tone="muted">Booked in Square</Badge>}
                      </span>
                      <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{e.kind === 'party' && e.endIso ? formatTimeSpan(e.startIso, e.endIso) : formatTime(e.startIso)}</span>
                    </span>
                    <span style={{ display: 'block', margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                      {e.kind === 'party'
                        ? typeof e.guests === 'number' ? `${e.guests} guest${e.guests === 1 ? '' : 's'}` : 'Party'
                        : e.byDay && typeof e.sold === 'number' && typeof e.capacity === 'number'
                          ? <span style={e.sold > e.capacity ? { color: 'var(--color-error)', fontWeight: 700 } : undefined}>{`${e.sold} of ${e.capacity} booked`}</span>
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
      {cafeOpen && <CraftCafeSheet date={cafeOpen} onClose={() => { setCafeOpen(null); load(true) }} />}
    </div>
  )
}
