import { useEffect, useState } from 'react'
import type { ClassTotals } from '@lib/classes/admin-actions'
import type { ScheduledClass } from '@lib/classes/types'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import { api, CLASSES } from './classes/api'
import { addDays, dayLabel, today } from './classes/dates'
import { isPast, latestOf, nextSession, priceOf, ranText, STATUS_TAG } from './classes/labels'
import { useLibraryList } from './classes/library-data'
import { useCalendar, useRefresh, useShell } from './shell/data'
import { SafeRow } from './shell/Boundary'
import { Failed, ItemRow, itemKey, Seg, sheetOf, Skeleton } from './shell/items'
import type { Sheet } from './shell/router'
import { timeSpan } from './shell/time'

type Segment = 'up' | 'draft' | 'past' | 'lib'
interface Data { classes: ScheduledClass[]; seatsTaken: Record<string, number>; totals: Record<string, ClassTotals> }

/** Our classes, every one (they're few), with seats and money per class. Loads on its own. */
function useClasses() {
  const { version } = useRefresh()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setError('')
    api<Partial<Data>>(CLASSES).then((r) => {
      if (!live) return
      if (r.ok && r.data) setData({ classes: r.data.classes ?? [], seatsTaken: r.data.seatsTaken ?? {}, totals: r.data.totals ?? {} })
      else setError(r.error ?? '')
    })
    return () => { live = false }
  }, [version, tries])
  return { data, error, retry: () => setTries((n) => n + 1) }
}

/** One class row: time · name · what to know, with the class colour bar and its status tag. */
function ClassRow({ cls, sub, onOpen, active }: { cls: ScheduledClass; sub: string; onOpen: () => void; active: boolean }) {
  const s = nextSession(cls)
  const tag = STATUS_TAG[cls.status]
  return (
    <button
      type="button"
      className={`adm-row k-class${cls.status === 'draft' ? ' is-draft' : ''}${cls.status === 'cancelled' ? ' is-gone' : ''}${active ? ' is-active' : ''}`}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
    >
      <span className="adm-rt">{s ? timeSpan(s.startIso, s.endIso) : ''}</span>
      <span className="adm-rm">
        <b>{cls.content.name}</b>
        <small>{sub}{tag && <span className={`adm-tag${cls.status === 'cancelled' ? ' is-red' : ''}`}>{tag}</span>}</small>
      </span>
      <span className="adm-chev" aria-hidden="true">›</span>
    </button>
  )
}

/** Rows under a heading per day (the day each class next meets, or met). */
function ByDay({ list, sub, onOpen, activeId }: { list: ScheduledClass[]; sub: (c: ScheduledClass) => string; onOpen: (c: ScheduledClass) => void; activeId: string | null }) {
  const days = [...new Set(list.map((c) => localDate(nextSession(c)!.startIso)))]
  return (
    <>
      {days.map((d) => (
        <section key={d} aria-label={dayLabel(d)}>
          <p className="adm-dayname">{dayLabel(d)}</p>
          {list.filter((c) => localDate(nextSession(c)!.startIso) === d).map((c) => (
            <SafeRow key={c.id}><ClassRow cls={c} sub={sub(c)} active={activeId === c.id} onOpen={() => onOpen(c)} /></SafeRow>
          ))}
        </section>
      ))}
    </>
  )
}

/**
 * Classes (direction D): Upcoming · Drafts · Past · Library. Upcoming is
 * grouped by day with seats booked, cancelled ones folded away at the end,
 * and the classes still run from Square under them (read only). Past shows
 * who came and the money. Library shows a photo tile per class.
 */
export default function ClassesTab({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const [seg, setSeg] = useState<Segment>('up')
  const { data, error, retry } = useClasses()
  const { activeToken } = useShell()
  const activeId = activeToken?.startsWith('class-') ? activeToken.slice(6) : activeToken?.startsWith('edit-') ? activeToken.slice(5) : null
  const now = Date.now()
  const all = (data?.classes ?? []).filter((c) => c.sessions.length > 0)
  const byNext = (a: ScheduledClass, b: ScheduledClass) => nextSession(a)!.startIso.localeCompare(nextSession(b)!.startIso)
  const upcoming = all.filter((c) => !isPast(c, now) && (c.status === 'open' || c.status === 'closed')).sort(byNext)
  const drafts = all.filter((c) => !isPast(c, now) && c.status === 'draft').sort(byNext)
  const cancelledSoon = all.filter((c) => !isPast(c, now) && c.status === 'cancelled').sort(byNext)
  const past = all.filter((c) => isPast(c, now)).sort((a, b) => byNext(b, a))
  const open = (c: ScheduledClass) => onOpen({ kind: 'class', id: c.id })
  const booked = (c: ScheduledClass) => {
    const s = nextSession(c)!
    return `${data?.seatsTaken[s.id] ?? 0} of ${s.capacity} booked${c.sessions.length > 1 ? ` · ${c.sessions.length} dates` : ''}`
  }
  const totals = (c: ScheduledClass) => {
    const t = data?.totals[c.id]
    if (!t) return ''
    return `${t.bookings} ${t.bookings === 1 ? 'booking' : 'bookings'} · ${t.seats} ${t.seats === 1 ? 'seat' : 'seats'} · ${formatMoney(t.cents)}`
  }

  return (
    <>
      <div className="adm-top">
        <div className="adm-grow">
          <p className="adm-brand">Hometown Studio</p>
          <h1>Classes</h1>
        </div>
        <button type="button" className="adm-btn is-pri is-sm" onClick={() => onOpen({ kind: 'new' })}>+ New class</button>
      </div>
      <Seg tight label="Show" value={seg} onChange={setSeg} options={[['up', 'Upcoming'], ['draft', 'Drafts'], ['past', 'Past'], ['lib', 'Library']]} />

      {seg !== 'lib' && error && <Failed message={error} onRetry={retry} />}
      {seg !== 'lib' && !error && !data && <Skeleton rows={3} label="Loading the classes" />}

      {seg === 'up' && data && (
        <>
          {upcoming.length === 0 && (
            <div className="adm-empty">
              <p>No classes coming up.</p>
              <button type="button" className="adm-btn is-pri is-sm" onClick={() => onOpen({ kind: 'new' })}>+ New class</button>
            </div>
          )}
          <ByDay list={upcoming} sub={booked} onOpen={open} activeId={activeId} />
          {cancelledSoon.length > 0 && (
            <details className="adm-fold-group">
              <summary>{`Cancelled (${cancelledSoon.length})`}</summary>
              <ByDay list={cancelledSoon} sub={booked} onOpen={open} activeId={activeId} />
            </details>
          )}
          <StillInSquare onOpen={onOpen} />
        </>
      )}

      {seg === 'draft' && data && (
        <>
          <p className="adm-note">Drafts are saved but not on the website yet.</p>
          {drafts.length === 0 && <p className="adm-empty">No drafts.</p>}
          {drafts.map((c) => {
            const s = nextSession(c)!
            return <SafeRow key={c.id}><ClassRow cls={c} active={activeId === c.id} sub={[dayLabel(localDate(s.startIso)), priceOf(c.content)].filter(Boolean).join(' · ')} onOpen={() => open(c)} /></SafeRow>
          })}
        </>
      )}

      {seg === 'past' && data && (
        <>
          {past.length === 0 && <p className="adm-empty">No past classes yet.</p>}
          <ByDay list={past} sub={totals} onOpen={open} activeId={activeId} />
          {past.length > 0 && <p className="adm-small adm-muted" style={{ marginTop: '0.5rem' }}>Tap a past class to see who came or refund someone.</p>}
        </>
      )}

      {seg === 'lib' && <LibraryTiles onOpen={onOpen} />}
    </>
  )
}

/** The six weeks of classes still run from Square, read only (R-A4). */
function StillInSquare({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const day = today()
  // Six weeks is as far as the calendar route reads at once.
  const square = useCalendar(day, addDays(day, 42))
  const legacy = (square.items ?? []).filter((i) => i.kind === 'legacy-class')
  return (
    <section aria-label="Still run from Square">
      <p className="adm-lbl" style={{ marginTop: '1.25rem' }}>Still run from Square</p>
      {square.error && <Failed message={square.error} onRetry={square.retry} />}
      {!square.error && !square.items && <Skeleton rows={2} label="Loading the Square classes" />}
      {square.items && !legacy.length && <p className="adm-muted adm-small">None in the next six weeks.</p>}
      {[...new Set(legacy.map((i) => localDate(i.startIso)))].map((d) => (
        <section key={d} aria-label={dayLabel(d)}>
          <p className="adm-dayname">{dayLabel(d)}</p>
          {legacy.filter((i) => localDate(i.startIso) === d).map((i) => (
            <ItemRow key={itemKey(i)} item={i} sub="" tag="In Square" onOpen={() => onOpen(sheetOf(i, d), i)} />
          ))}
        </section>
      ))}
    </section>
  )
}

/** Photo tiles, one per library class; tap for its sheet. */
function LibraryTiles({ onOpen }: { onOpen: (s: Sheet, data?: unknown) => void }) {
  const [archived, setArchived] = useState(false)
  const { list, runs, error, retry } = useLibraryList(archived)
  return (
    <>
      <p className="adm-note">Every class you add lands here on its own. Tap one to run it again.</p>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !list && <Skeleton rows={2} label="Loading the library" />}
      {list && list.length === 0 && (
        <div className="adm-empty">
          <p>Nothing in the library yet. Add a class and it lands here.</p>
          <button type="button" className="adm-btn is-pri is-sm" onClick={() => onOpen({ kind: 'new' })}>+ New class</button>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="adm-tiles">
          {list.map((l) => {
            const c = latestOf(l).content
            return (
              <SafeRow key={l.id}>
                <button type="button" className={`adm-tile${l.archived ? ' is-gone' : ''}`} onClick={() => onOpen({ kind: 'lib', id: l.id }, l)}>
                  <span className="adm-tile-img">{c.imageUrl ? <img src={c.imageUrl} alt="" loading="lazy" /> : null}</span>
                  <b>{c.name}</b>
                  <small>{l.archived ? 'Archived' : [ranText(runs[l.id]), priceOf(c)].filter(Boolean).join(' · ')}</small>
                </button>
              </SafeRow>
            )
          })}
        </div>
      )}
      {list && (
        <button type="button" className="adm-quiet" aria-pressed={archived} onClick={() => setArchived(!archived)}>
          {archived ? 'Hide archived' : 'Show archived'}
        </button>
      )}
    </>
  )
}
