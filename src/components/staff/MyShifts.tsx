import { useEffect, useId, useState, type CSSProperties } from 'react'
import StaffHeader from '@components/staff/StaffHeader'
import AvailabilityEditor from '@components/staff/AvailabilityEditor'
import CalendarLinkSheet from '@components/staff/CalendarLinkSheet'
import { useStaffNav } from '@components/staff/nav'
import { card, btn, field, Badge } from '@components/staff/ui'
import { formatDay, formatTimeSpan } from '@lib/studio-time'
import { verdict, MAX_NOTE } from '@lib/staffing/rules'
import { PARTY_ARRIVAL } from '@lib/staffing/crew-copy'
import type { StaffMember } from '@lib/staff-auth'
import type { EventKind } from '@lib/events'
import type { Availability, StaffableEvent } from '@lib/staffing/types'
import type { OpenEvent, StaffingRow } from '@lib/staffing/events'

/**
 * /staff › My shifts (stage 3), for crew on a phone or the shared iPad:
 *   1. What I'm on (next 8 weeks), with who else is on; tap for the roster.
 *   2. Ask to work: classes and parties still to come, each saying plainly
 *      whether someone is still needed; one tap to ask, an optional note.
 *   3. When I can work: usual week + different dates (AvailabilityEditor).
 *   4. Calendar on my phone (CalendarLinkSheet).
 * The name is big at the top because the iPad is shared. Crew never assign:
 * only Catherine or Kaden put people on, in /admin.
 */

interface ShiftsData {
  me: { id: string; name: string }
  availability: Availability
  mine: StaffingRow[]
  open: OpenEvent[]
  feed: { has: boolean }
}

type OpenRoster = (e: { kind: EventKind; id: string; title: string; day?: string }) => void

const h2: CSSProperties = { margin: '1.6rem 0 0.6rem', fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-dark)' }
const when = (ev: Pick<StaffableEvent, 'startIso' | 'endIso'>) => `${formatDay(ev.startIso)} · ${formatTimeSpan(ev.startIso, ev.endIso)}`
const icon = (ev: Pick<StaffableEvent, 'kind'>) => (ev.kind === 'party' ? '🎉' : '🧵')

/** "Catherine", "Catherine and Sam", "Catherine, Sam and Jo". */
function names(list: string[]): string {
  if (list.length <= 1) return list[0] ?? ''
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

export function withLine(row: StaffingRow, myId: string): string {
  const others = (row.entry?.assigned ?? []).filter((a) => a.staffId !== myId).map((a) => a.name)
  return others.length ? `With ${names(others)}` : 'Just you on this one'
}

/** One "You're on" card: the whole card opens the roster, like every other /staff list. */
function ShiftCard({ row, myId, onOpenRoster }: { row: StaffingRow; myId: string; onOpenRoster: OpenRoster }) {
  const ev = row.event
  const cancelled = ev.status !== 'on'
  return (
    <button
      type="button"
      data-testid="my-shift"
      onClick={() => onOpenRoster({ kind: ev.roster.kind, id: ev.roster.id, title: ev.title, day: ev.roster.day })}
      aria-label={`${ev.title}, ${when(ev)}. ${cancelled ? 'Cancelled.' : `You're on. ${withLine(row, myId)}.`} Open the roster.`}
      style={{ ...card, background: 'rgba(255,255,255,0.9)', width: '100%', textAlign: 'left', cursor: 'pointer', display: 'grid', gap: '0.3rem', marginBottom: '0.6rem', borderLeft: `5px solid ${cancelled ? '#b91c1c' : '#15803d'}` }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-dark)' }}>{when(ev)}</span>
        {cancelled ? <Badge tone="alert">✕ Cancelled</Badge> : <Badge tone="muted">✓ You’re on</Badge>}
      </span>
      <span style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-dark)' }}><span aria-hidden="true">{icon(ev)} </span>{ev.title}</span>
      {cancelled
        ? <span style={{ fontSize: '0.95rem', color: '#991b1b' }}>This was cancelled. Catherine or Kaden will take you off it.</span>
        : <span style={{ fontSize: '0.95rem', color: 'var(--color-muted)' }}>{withLine(row, myId)}</span>}
      {!cancelled && ev.kind === 'party' && PARTY_ARRIVAL && <span style={{ fontSize: '0.95rem', color: 'var(--color-dark)' }}>{PARTY_ARRIVAL}</span>}
    </button>
  )
}

/** One "Ask to work" card: Needed / Has enough, Can't (from my own times), Asked, and the one-tap ask. */
function AskCard({ ev, cant, onAsk, onUnask }: {
  ev: OpenEvent
  cant: boolean
  onAsk: (ev: OpenEvent, note: string) => Promise<string | null>
  onUnask: (ev: OpenEvent) => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(ev.askNote)
  const [justSaved, setJustSaved] = useState<string | null>(null)
  const noteId = useId()
  const cancelled = ev.status !== 'on'

  async function run(fn: () => Promise<string | null>, saved: string | null) {
    setBusy(true)
    setError(null)
    setJustSaved(null)
    const err = await fn()
    setBusy(false)
    if (err) setError(err)
    else setJustSaved(saved)
    return !err
  }

  return (
    <li data-testid="open-event" style={{ ...card, background: 'rgba(255,255,255,0.9)', margin: '0 0 0.6rem', display: 'grid', gap: '0.45rem', borderLeft: `5px solid ${cancelled ? '#b91c1c' : ev.asked ? 'var(--color-primary)' : ev.needsSomeone ? '#d97706' : 'rgba(90,90,90,0.3)'}` }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-dark)' }}>{when(ev)}</span>
        <span style={{ display: 'inline-flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {cancelled && <Badge tone="alert">✕ Cancelled</Badge>}
          {!cancelled && ev.asked && <Badge tone="muted">★ You asked</Badge>}
          {!cancelled && (ev.needsSomeone ? <Badge tone="warn">Needed</Badge> : <Badge tone="muted">Has enough people</Badge>)}
          {!cancelled && cant && <Badge tone="muted">You said you can’t</Badge>}
        </span>
      </span>
      <span style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-dark)' }}><span aria-hidden="true">{icon(ev)} </span>{ev.title}</span>

      {cancelled ? (
        <>
          <span style={{ fontSize: '0.95rem', color: '#991b1b' }}>This was cancelled, so there’s nothing to work.</span>
          <button type="button" disabled={busy} onClick={() => run(() => onUnask(ev), null)} style={{ ...btn(), minHeight: '2.75rem' }}>{busy ? 'One moment…' : 'Clear my ask'}</button>
        </>
      ) : !ev.asked ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => onAsk(ev, ''), 'Asked. Catherine and Kaden can see it.')}
          aria-label={`I'd like to work ${ev.title}, ${when(ev)}`}
          style={{ ...btn(true), minHeight: '3rem', fontSize: '1rem' }}
        >
          {busy ? 'Asking…' : 'I’d like to work this'}
        </button>
      ) : (
        <>
          {ev.askNote && !noteOpen && <span style={{ fontSize: '0.95rem', color: 'var(--color-muted)' }}>{`You wrote “${ev.askNote}”`}</span>}
          {noteOpen ? (
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <label htmlFor={noteId} style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }}>Note for Catherine and Kaden (optional)</label>
              <textarea id={noteId} value={note} maxLength={MAX_NOTE} rows={2} onChange={(e) => setNote(e.target.value)} style={{ ...field, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
              <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button type="button" disabled={busy} onClick={async () => { if (await run(() => onAsk(ev, note.trim()), 'Note saved.')) setNoteOpen(false) }} style={{ ...btn(true), flex: '1 1 8rem' }}>{busy ? 'Saving…' : 'Save note'}</button>
                <button type="button" onClick={() => { setNote(ev.askNote); setNoteOpen(false) }} style={{ ...btn(), flex: '1 1 6rem' }}>Cancel</button>
              </span>
            </div>
          ) : (
            <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { setNote(ev.askNote); setNoteOpen(true) }} style={{ ...btn(), flex: '1 1 8rem' }}>{ev.askNote ? 'Change my note' : 'Add a note'}</button>
              <button type="button" disabled={busy} onClick={() => run(() => onUnask(ev), 'Ask taken back.')} aria-label={`Take back my ask for ${ev.title}, ${when(ev)}`} style={{ ...btn(), flex: '1 1 8rem' }}>{busy ? 'One moment…' : 'Take it back'}</button>
            </span>
          )}
        </>
      )}
      <span role="status" aria-live="polite" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#15803d' }}>{justSaved ? `✓ ${justSaved}` : ''}</span>
      {error && <span role="alert" style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-error)' }}>{error}</span>}
    </li>
  )
}

export default function MyShifts({ staff, onOpenRoster }: { staff: StaffMember; onOpenRoster: OpenRoster }) {
  const nav = useStaffNav()
  const [data, setData] = useState<ShiftsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [onlyNeeded, setOnlyNeeded] = useState(true)
  const [linkOpen, setLinkOpen] = useState(false)

  async function load() {
    setError(null)
    try {
      const res = await fetch('/api/staff/shifts.json', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Couldn’t load your shifts.'); return }
      setData(json.data as ShiftsData)
    } catch {
      setError('Couldn’t reach the studio server. Check wifi and tap Try again.')
    }
  }
  useEffect(() => { setData(null); load() }, [staff.id])

  /** Ask or unask; null when it worked, else the sentence to show. */
  async function ask(ev: OpenEvent, action: 'ask' | 'unask', note = ''): Promise<string | null> {
    try {
      const res = await fetch('/api/staff/shifts.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, key: ev.key, note, startIso: ev.startIso }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) return json?.error ?? 'That didn’t go through. Try again.'
      setData((d) => d && {
        ...d,
        open: d.open
          .map((x) => (x.key === ev.key ? { ...x, asked: action === 'ask', askNote: action === 'ask' ? note : '' } : x))
          // A cancelled one leaves the list once the ask is cleared.
          .filter((x) => x.status === 'on' || x.asked),
      })
      return null
    } catch {
      return 'Couldn’t reach the studio server. Check wifi and try again.'
    }
  }

  const firstName = staff.name.split(' ')[0]
  const title = `${firstName}’s shifts`

  if (error && !data) {
    return (
      <div style={{ width: '100%', maxWidth: '40rem', margin: '0 auto' }}>
        <StaffHeader title="My shifts" staff={staff} onOpenRoster={onOpenRoster} />
        <h1 style={{ margin: '0 0 0.6rem', fontFamily: 'var(--font-heading)', fontSize: '1.6rem', color: 'var(--color-dark)' }}>{title}</h1>
        <div role="alert" style={{ ...card, background: 'rgba(255,255,255,0.85)' }}>
          <p style={{ margin: '0 0 0.6rem', color: 'var(--color-error)', fontWeight: 600 }}>{error}</p>
          <button type="button" onClick={load} style={btn()}>Try again</button>
        </div>
      </div>
    )
  }

  const open = data?.open ?? []
  const shown = onlyNeeded ? open.filter((e) => e.needsSomeone || e.asked || e.status !== 'on') : open
  const neededCount = open.filter((e) => e.needsSomeone).length

  return (
    <div style={{ width: '100%', maxWidth: '40rem', margin: '0 auto' }}>
      <StaffHeader title="My shifts" staff={staff} onOpenRoster={onOpenRoster} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-heading)', fontSize: '1.6rem', color: 'var(--color-dark)' }}>{title}</h1>
        {nav && <button type="button" onClick={nav.switchStaff} style={btn()}>Not {firstName}? Switch</button>}
      </div>

      {!data && <p style={{ color: 'var(--color-muted)', textAlign: 'center' }}>Loading…</p>}

      {data && (
        <>
          <section aria-labelledby="ms-on">
            <h2 id="ms-on" style={h2}>You’re on</h2>
            {data.mine.length === 0
              ? <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-dark)' }}>Nothing yet in the next 8 weeks. Catherine or Kaden will text you when they put you on something.</p>
              : data.mine.map((row) => <ShiftCard key={row.event.key} row={row} myId={data.me.id} onOpenRoster={onOpenRoster} />)}
          </section>

          <section aria-labelledby="ms-ask">
            <h2 id="ms-ask" style={h2}>Ask to work</h2>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: 'var(--color-muted)', lineHeight: 1.45 }}>
              Tap “I’d like to work this” and Catherine and Kaden will see it. Asking doesn’t put you on. They’ll text you if they do.
            </p>
            <div role="group" aria-label="Which ones to show" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
              <button type="button" aria-pressed={onlyNeeded} onClick={() => setOnlyNeeded(true)} style={{ ...btn(onlyNeeded), flex: '1 1 9rem' }}>{`Need someone (${neededCount})`}</button>
              <button type="button" aria-pressed={!onlyNeeded} onClick={() => setOnlyNeeded(false)} style={{ ...btn(!onlyNeeded), flex: '1 1 9rem' }}>{`Everything (${open.length})`}</button>
            </div>
            {shown.length === 0 && (
              <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-dark)' }}>
                {onlyNeeded && open.length > 0 ? 'Everything coming up has enough people right now.' : 'Nothing coming up in the next 8 weeks.'}
              </p>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {shown.map((ev) => (
                <AskCard
                  key={ev.key}
                  ev={ev}
                  cant={verdict(data.availability, ev) === 'cant'}
                  onAsk={(e, note) => ask(e, 'ask', note)}
                  onUnask={(e) => ask(e, 'unask')}
                />
              ))}
            </ul>
          </section>

          <section aria-labelledby="ms-times">
            <h2 id="ms-times" style={h2}>When I can work</h2>
            <AvailabilityEditor initial={data.availability} onSaved={(a) => setData((d) => d && { ...d, availability: a })} />
          </section>

          <section aria-labelledby="ms-cal" style={{ marginBottom: '5rem' }}>
            <h2 id="ms-cal" style={h2}>My shifts on my phone</h2>
            <p style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: 'var(--color-dark)', lineHeight: 1.45 }}>
              {data.feed.has
                ? 'Your calendar link is on. Your shifts update on your phone by themselves.'
                : 'Put your shifts in your phone’s calendar (iPhone or Android). They update by themselves.'}
            </p>
            <button type="button" onClick={() => setLinkOpen(true)} style={{ ...btn(!data.feed.has), minHeight: '3rem', fontSize: '1rem', width: '100%' }}>
              {data.feed.has ? 'Calendar link settings' : 'Add my shifts to my phone'}
            </button>
          </section>

          {linkOpen && (
            <CalendarLinkSheet
              has={data.feed.has}
              onClose={() => setLinkOpen(false)}
              onChanged={(has) => setData((d) => d && { ...d, feed: { has } })}
            />
          )}
        </>
      )}
    </div>
  )
}
