/**
 * New class, on one screen (direction D): Start fresh or From a past class,
 * photo, name, dates, price, More options; Add class or Save as draft.
 * Every class lands in the library on its own (the server does it). Started
 * from the library with the details changed, Add asks "Only this class" or
 * "This class and the library". Also opens filled in from the library
 * (Schedule it) or from a class (Run it again).
 */
import { useEffect, useRef, useState } from 'react'
import type { LibraryRun } from '@lib/classes/admin-actions'
import { sameDetails } from '@lib/classes/content-diff'
import type { ClassContent, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { api, BOOKINGS, CLASSES } from '../classes/api'
import { blankContent, build, fieldOf, fixLine, toForm, type Errors, type Form } from '../classes/class-form'
import { DetailsFields, focusFirstError, PreviewButton } from '../classes/ClassDetails'
import DateRows, { checkRows, endAfter, lengthOf, newDateRow, onOrAfter, weekLater, type DateRow } from '../classes/DateRows'
import { addDays, dayLabel, partsOf, today, weekday } from '../classes/dates'
import { closureOn, OPEN_WEEKDAYS } from '@config/closures'
import { latestOf, priceOf, ranText } from '../classes/labels'
import { useLibraryList } from '../classes/library-data'
import { useRefresh } from '../shell/data'
import { NoPhoto } from '../ClassesTab'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

export const ADDED = 'Added. It’s on the calendar and in your library.'

type From = { kind: 'lib'; id: string } | { kind: 'class'; id: string }
/** The library class it links to (and its details), and the details the form was filled with. */
interface Picked { libraryId: string | null; content: ClassContent | null; name: string; startedFrom: ClassContent }

/** A week out, then on to the next day the studio opens (not a usual closed weekday, not a closure). */
export function defaultDay(now = today()): string {
  let d = addDays(now, 7)
  for (let i = 0; i < 21 && (!OPEN_WEEKDAYS.has(weekday(d)) || closureOn(d)); i++) d = addDays(d, 1)
  return d
}

function freshRows(day?: string): DateRow[] {
  return [newDateRow({ day: day ?? defaultDay(), start: '18:00', end: '20:00', capacity: 12 })]
}

function newKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** A library class's details, at its usual time and seats, on `day` (or a week from today). */
function fromLibrary(lib: LibraryClass, run: LibraryRun | undefined, day?: string): { form: Form; rows: DateRow[]; picked: Picked } {
  const c = latestOf(lib).content
  const start = run ? partsOf(run.startIso).time : '18:00'
  const d = day ?? defaultDay()
  const end = run ? partsOf(run.endIso).time : endAfter(d, start, c.defaultMinutes)
  return {
    form: toForm(c),
    rows: [newDateRow({ day: d, start, end, capacity: c.defaultCapacity })],
    picked: { libraryId: lib.id, content: c, name: c.name, startedFrom: c },
  }
}

export function NewClassSheet({ day, from }: { day?: string; from?: From }) {
  const { open, setDirty } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  // Archived ones too, so Run it again still finds its class's library entry (M3); the picker leaves them out.
  const { list: all, runs, error: libError, retry: libRetry } = useLibraryList(true)
  const list = all
  const pickable = all?.filter((l) => !l.archived) ?? null
  /** One key for this Add, kept across retries, so a lost reply never makes a second class (R35). */
  const createKey = useRef(newKey())
  const [replacing, setReplacing] = useState<LibraryClass | null>(null)
  /** The form as last filled in (opened, or a past class picked): typing past this is "what you typed". */
  const lastFill = useRef('')
  const body = useRef<HTMLDivElement>(null)

  const snapshot = (form: Form, r: DateRow[]) => JSON.stringify([form, r.map(({ key: _k, ...x }) => x)])
  const [first] = useState(() => ({ form: toForm(blankContent()), rows: freshRows(day) }))
  const [src, setSrc] = useState<'fresh' | 'past'>(from ? 'past' : 'fresh')
  const [f, setF] = useState<Form>(first.form)
  const [rows, setRows] = useState<DateRow[]>(first.rows)
  const [picked, setPicked] = useState<Picked | null>(null)
  /** What the sheet opened with: anything typed since then asks before leaving. */
  const [start, setStart] = useState<string>(() => snapshot(first.form, first.rows))
  const [ready, setReady] = useState(!from)
  const [loadError, setLoadError] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [datesError, setDatesError] = useState('')
  const [busy, setBusy] = useState('')

  const dirty = ready && snapshot(f, rows) !== start
  useSheetDirty(dirty)

  function begin(form: Form, r: DateRow[], p: Picked | null) {
    setF(form)
    setRows(r)
    setPicked(p)
    setStart(snapshot(form, r))
    setReady(true)
  }

  // Schedule it (a library class) or Run it again (a class): fill in once the library (and the class) are here.
  useEffect(() => {
    if (!from || ready) return
    if (from.kind === 'lib') {
      if (!list) return
      const lib = list.find((l) => l.id === from.id)
      if (!lib) { setLoadError('That class isn’t in the library any more.'); return }
      const x = fromLibrary(lib, runs[lib.id], day)
      begin(x.form, x.rows, x.picked)
      return
    }
    if (!list) return
    let live = true
    api<{ class: ScheduledClass }>(`${BOOKINGS}?id=${encodeURIComponent(from.id)}`).then((r) => {
      if (!live) return
      if (!r.ok || !r.data) { setLoadError(r.error ?? ''); return }
      const cls = r.data.class
      const lib = cls.libraryId ? list.find((l) => l.id === cls.libraryId) : undefined
      begin(toForm(cls.content), onOrAfter(weekLater(cls.sessions), defaultDay(), (d) => !!closureOn(d)), { libraryId: lib?.id ?? null, content: lib ? latestOf(lib).content : null, name: cls.content.name, startedFrom: cls.content })
    })
    return () => { live = false }
  }, [from?.kind, from?.id, list, ready])

  /** Picking a past class fills the form: if something was typed, ask first (Q8). */
  function ask(lib: LibraryClass) {
    if (snapshot(f, rows) !== (lastFill.current || start) && picked?.libraryId !== lib.id) setReplacing(lib)
    else pick(lib)
  }
  function pick(lib: LibraryClass) {
    setReplacing(null)
    const x = fromLibrary(lib, runs[lib.id], day ?? rows[0]?.day)
    setF(x.form)
    setRows(x.rows)
    setPicked(x.picked)
    lastFill.current = snapshot(x.form, x.rows)
    setErrors({})
    setDatesError('')
  }

  function chooseSrc(s: 'fresh' | 'past') {
    setSrc(s)
    if (s === 'fresh' && picked) {
      // Untouched since it was picked: start over. Typed into: keep the words, as a new class.
      const now = build(f)
      if (picked.content && (!now.ok || sameDetails(now.content, picked.content))) {
        setF(toForm(blankContent()))
        setRows(freshRows(day ?? rows[0]?.day))
      }
      setPicked(null)
    }
  }

  const checkedRows = checkRows(rows)
  const previewSessions = checkedRows.ok ? checkedRows.sessions : []
  const built = build(f)
  // The choice only when she changed the details here and they differ from the library's (Q9).
  const differs = !!picked?.content && built.ok && !sameDetails(built.content, picked.content) && !sameDetails(built.content, picked.startedFrom)

  async function add(status: 'open' | 'draft', alsoLibrary = false) {
    setDatesError('')
    const b = build(f)
    const checked = checkRows(rows)
    const e: Errors = b.ok ? {} : { ...b.errors }
    if (!checked.ok) e.dates = checked.error
    if (Object.keys(e).length) {
      setErrors(e)
      if (e.dates) setDatesError(e.dates)
      requestAnimationFrame(() => focusFirstError(body.current, e))
      return
    }
    if (!b.ok || !checked.ok) return
    setErrors({})
    const first = rows[0]
    // From scratch, the library's usual length and seats come from the first date.
    const content: ClassContent = picked?.libraryId ? b.content : { ...b.content, defaultMinutes: lengthOf(first.day, first.start, first.end) || b.content.defaultMinutes, defaultCapacity: checked.sessions[0].capacity }
    setBusy(status === 'draft' ? 'draft' : alsoLibrary ? 'both' : 'add')
    const r = await api<{ class: ScheduledClass; replay?: boolean }>(CLASSES, {
      action: 'create', content, sessions: checked.sessions, status, createKey: createKey.current,
      ...(picked?.libraryId ? { libraryId: picked.libraryId } : {}),
      ...(alsoLibrary ? { alsoUpdateLibrary: true } : {}),
    })
    setBusy('')
    if (!r.ok || !r.data) {
      const k = r.extra.field ? fieldOf(r.extra.field, f) : r.status === 409 ? 'dates' : 'form'
      if (k === 'dates') setDatesError(r.error ?? DIDNT_SAVE)
      const next = { [k]: r.error ?? DIDNT_SAVE } as Errors
      setErrors(next)
      if (k !== 'form') requestAnimationFrame(() => focusFirstError(body.current, next))
      return
    }
    setStart(snapshot(f, rows))
    createKey.current = newKey()
    // Added: moving on to its sheet must not ask "Leave without saving?".
    setDirty(false)
    bump()
    const made = r.data.class
    // N2: this Add was already made on an earlier try. If what came back isn't what was sent now, say so; never claim a draft that's open.
    const sentDates = checked.sessions.map((x) => x.startIso).join()
    const differs = !!r.data.replay && (made.status !== status || made.sessions.map((x) => x.startIso).join() !== sentDates || JSON.stringify(made.content.prices) !== JSON.stringify(content.prices) || made.content.name !== content.name)
    toast(differs ? 'This class was already added. Here it is.' : r.warning ?? (made.status === 'draft' ? 'Saved as a draft. It’s in your library; it goes on the website when you open it.' : ADDED))
    open({ kind: 'class', id: made.id })
  }

  const line = errors.form || fixLine(errors, 'above')
  const footer = (
    <div className="adm-stack">
      {line && <p className="adm-footline" role="alert">{line}</p>}
      {differs
        ? (
          <>
            <p className="adm-small adm-muted adm-center">You changed the details. Keep the changes for:</p>
            <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => add('open')}>{busy === 'add' ? 'Adding…' : 'Only this class'}</button>
            <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => add('open', true)}>{busy === 'both' ? 'Adding…' : 'This class and the library'}</button>
          </>
        )
        : <button type="button" className="adm-btn is-pri" disabled={!!busy || !ready} onClick={() => add('open')}>{busy === 'add' ? 'Adding…' : 'Add class'}</button>}
      <button type="button" className="adm-quiet" disabled={!!busy || !ready} onClick={() => add('draft')}>{busy === 'draft' ? 'Saving…' : 'Save as draft'}</button>
    </div>
  )

  const title = from?.kind === 'class' ? 'Run it again' : 'New class'
  const subtitle = from && picked ? picked.name : day ? `On ${dayLabel(day)}` : undefined

  if (loadError) return <SheetFrame tall title={title}><Failed message={loadError} onRetry={() => { setLoadError(''); libRetry() }} /></SheetFrame>

  return (
    <SheetFrame tall title={title} subtitle={subtitle} footer={footer}>
      <div ref={body}>
        {!ready && <Skeleton rows={4} label="Filling in the class" />}
        {ready && (
          <>
            {!from && <Seg label="Start from" value={src} options={[['fresh', 'Start fresh'], ['past', 'From a past class']]} onChange={chooseSrc} />}
            {!from && src === 'past' && (
              <section aria-label="Your library" className="adm-libpick">
                <p className="adm-small adm-muted">Pick one. Its name, price, time, seats and details fill in below.</p>
                {libError && <Failed message={libError} onRetry={libRetry} />}
                {!libError && !pickable && <Skeleton rows={2} label="Loading the library" />}
                {pickable && !pickable.length && <p className="adm-empty">Nothing in the library yet. Every class you add lands there on its own.</p>}
                {replacing && (
                  <div className="adm-panel" role="group" aria-label="Replace what you typed?">
                    <b>Replace what you typed?</b>
                    <span className="adm-small">{`${latestOf(replacing).content.name}’s name, price, time, seats and details go in its place.`}</span>
                    <div className="adm-two">
                      <button type="button" className="adm-btn is-ghost" onClick={() => setReplacing(null)}>Keep mine</button>
                      <button type="button" className="adm-btn is-pri" onClick={() => pick(replacing)}>Replace</button>
                    </div>
                  </div>
                )}
                {pickable?.map((l) => {
                  const c = latestOf(l).content
                  return (
                    <button key={l.id} type="button" className="adm-libc" aria-pressed={picked?.libraryId === l.id} onClick={() => ask(l)}>
                      <span className="adm-thumb">{c.imageUrl ? <img src={c.imageUrl} alt="" /> : <NoPhoto />}</span>
                      <span className="adm-rm"><b>{c.name}</b><small>{[ranText(runs[l.id]), priceOf(c), `${c.defaultCapacity} seats`].filter(Boolean).join(' · ')}</small></span>
                    </button>
                  )
                })}
                {pickable && pickable.length > 0 && <p className="adm-lbl">Details</p>}
              </section>
            )}
            <PreviewButton f={f} sessions={previewSessions} />
            <DetailsFields f={f} set={(fn) => setF((cur) => fn(cur))} errors={errors} sessions={rows.map((r, i) => ({ id: r.id, label: `Date ${i + 1}` }))}>
              <DateRows rows={rows} onChange={(r) => { setRows(r); setDatesError('') }} error={datesError} />
            </DetailsFields>
            <p className="adm-note">It goes into your library on its own, so you can run it again later.</p>
          </>
        )}
      </div>
    </SheetFrame>
  )
}

/** `libsched-<id>`: Schedule it from the library. */
export function ScheduleFromLibrarySheet({ id }: { id: string }) {
  return <NewClassSheet from={{ kind: 'lib', id }} />
}

/** `again-<id>`: Run a class again, a week on. */
export function RunAgainSheet({ id }: { id: string }) {
  return <NewClassSheet from={{ kind: 'class', id }} />
}
