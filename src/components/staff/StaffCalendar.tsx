import { useEffect, useRef, useState } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import { card, btn, Badge } from '@components/staff/ui'
import { addDays } from '@lib/kit-dates'
import { formatCalendarDay, formatTimeSpan, studioDate, studioDayUtcRange } from '@lib/studio-time'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { eventKeyOf } from '@lib/staffing/rules'
import type { OpenEvent, StaffingRow } from '@lib/staffing/events'
import { ownersAnd } from '@lib/owner-names-client'

/** What My shifts knows about this week: what I'm on (key → already ended), and what I could ask for (with whether I asked). */
interface WeekShifts { mine: Map<string, boolean>; open: Map<string, OpenEvent> }

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
 * A class or party opens its roster; nothing here edits anything, except
 * saying "I'd like to work this" (stage 3), which only tells the owners.
 * Each class and party says "You're on" / "You asked" when it's so.
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
  const [shifts, setShifts] = useState<WeekShifts | null>(null)
  const [askBusy, setAskBusy] = useState<string | null>(null)
  const [askMsg, setAskMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null)

  // Only the newest reply counts (a slow one for last week, or for the last person on the shared
  // iPad, must never paint over this one), and a shifts reply only if it's this person's.
  const itemsSeq = useRef(0)
  const shiftsSeq = useRef(0)
  const staffIdRef = useRef(staff.id)
  staffIdRef.current = staff.id

  /** My shifts for the week (an extra: without it the calendar still works, just without the tags). */
  async function loadShifts(from: string) {
    const seq = ++shiftsSeq.current
    const forId = staff.id
    setShifts(null)
    try {
      const q = `from=${encodeURIComponent(studioDayUtcRange(from).startIso)}&to=${encodeURIComponent(studioDayUtcRange(addDays(from, 6)).endIso)}`
      const res = await fetch(`/api/staff/shifts.json?${q}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json().catch(() => null)
      if (seq !== shiftsSeq.current || staffIdRef.current !== forId || json?.data?.me?.id !== forId) return
      const mine = (json?.data?.mine ?? []) as StaffingRow[]
      const open = (json?.data?.open ?? []) as OpenEvent[]
      if (!Array.isArray(mine) || !Array.isArray(open)) return
      const now = Date.now()
      setShifts({
        mine: new Map(mine.filter((r) => r.event.status === 'on').map((r) => [r.event.key, Date.parse(r.event.endIso) <= now])),
        open: new Map(open.map((e) => [e.key, e])),
      })
    } catch {
      // the tags are an extra
    }
  }

  async function askToWork(ev: OpenEvent) {
    setAskBusy(ev.key)
    setAskMsg(null)
    try {
      const res = await fetch('/api/staff/shifts.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ask', key: ev.key, note: '', startIso: ev.startIso }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setAskMsg({ key: ev.key, text: json?.error ?? 'That didn’t go through. Try again.', ok: false }); return }
      setShifts((s) => s && { ...s, open: new Map(s.open).set(ev.key, { ...ev, asked: true }) })
      setAskMsg({ key: ev.key, text: `Asked. ${ownersAnd()} can see it. Add a note in My shifts.`, ok: true })
    } catch {
      setAskMsg({ key: ev.key, text: 'Couldn’t reach the studio server. Check wifi and try again.', ok: false })
    } finally {
      setAskBusy(null)
    }
  }

  async function load(from: string) {
    const seq = ++itemsSeq.current
    setError(null)
    setItems(null)
    try {
      const q = `from=${encodeURIComponent(studioDayUtcRange(from).startIso)}&to=${encodeURIComponent(studioDayUtcRange(addDays(from, 6)).endIso)}`
      const res = await fetch(`/api/staff/calendar.json?${q}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (seq !== itemsSeq.current) return
      if (!res.ok) { setError(json?.error ?? 'Couldn’t load the calendar.'); return }
      setItems(json.data.items as CalendarItem[])
    } catch {
      if (seq === itemsSeq.current) setError('Couldn’t reach the studio server — check wifi and tap Retry.')
    }
  }
  // The person is part of what's shown: a new person (even without a remount) clears the tags and reloads.
  useEffect(() => { setAskMsg(null); load(start); loadShifts(start) }, [start, staff.id])

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
              const key = eventKeyOf({ kind: it.kind, id: it.id, sessionId: (it as { sessionId?: string }).sessionId })
              const onIt = !!key && !!shifts?.mine.has(key)
              const worked = onIt && !!shifts?.mine.get(key!)
              const openEv = key ? shifts?.open.get(key) : undefined
              const canAsk = !!openEv && openEv.status === 'on' && !openEv.asked
              const body = (
                <>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span aria-hidden="true">{k.icon}</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-dark)' }}>{it.label}</span>
                      {it.status === 'cancelled' && <Badge tone="alert">Cancelled</Badge>}
                      {it.status === 'closed' && <Badge tone="muted">Sign-ups closed</Badge>}
                      {(it.pay === 'waiting' || it.pay === 'partly') && <Badge tone="warn">Waiting on payment</Badge>}
                      {onIt && <Badge tone="muted">{worked ? 'Worked' : '✓ You’re on'}</Badge>}
                      {!onIt && openEv?.asked && <Badge tone="muted">★ You asked</Badge>}
                    </span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{it.kind === 'closed' ? 'All day' : formatTimeSpan(it.startIso, it.endIso)}</span>
                  </span>
                  <span style={{ display: 'block', marginTop: '0.2rem', fontSize: '0.8125rem', color: 'var(--color-muted)' }}>{k.word}</span>
                </>
              )
              const style = { ...card, background: 'rgba(255,255,255,0.85)', width: '100%', textAlign: 'left' as const, display: 'block', marginBottom: '0.5rem', borderLeft: `4px solid ${k.colour}` }
              const rowKey = `${it.kind}:${it.id}:${it.startIso}`
              if (!target) return <div key={rowKey} data-testid="calendar-item" style={style}>{body}</div>
              const item = <button type="button" data-testid="calendar-item" onClick={() => onOpenRoster({ ...target, title: it.label, day: d })} style={{ ...style, cursor: 'pointer' }}>{body}</button>
              if (!canAsk && askMsg?.key !== key) return <div key={rowKey}>{item}</div>
              return (
                <div key={rowKey} style={{ marginBottom: '0.6rem' }}>
                  {item}
                  {canAsk && openEv && (
                    <button
                      type="button"
                      disabled={askBusy === key}
                      onClick={() => askToWork(openEv)}
                      aria-label={`I'd like to work ${it.label}, ${formatCalendarDay(d)}`}
                      style={{ ...btn(), width: '100%', marginTop: '-0.2rem' }}
                    >
                      {askBusy === key ? 'Asking…' : `I’d like to work this${openEv.needsSomeone ? ' · Needed' : ''}`}
                    </button>
                  )}
                  {askMsg?.key === key && <p role={askMsg.ok ? 'status' : 'alert'} style={{ margin: '0.3rem 0 0', fontSize: '0.9rem', fontWeight: 600, color: askMsg.ok ? '#15803d' : 'var(--color-error)' }}>{askMsg.text}</p>}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
