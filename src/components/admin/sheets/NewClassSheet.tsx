/**
 * New class, on one screen (direction D): Start fresh or From a past class,
 * photo, name, dates, price, More options; Add class or Save as draft.
 * Every class lands in the library on its own (the server does it). Started
 * from the library with the details changed, Add asks "Only this class" or
 * "This class and the library". Also opens filled in from the library
 * (Schedule it) or from a class (Run it again).
 */
import { useEffect, useRef, useState } from 'react'
import type { LibraryRun, RepeatResult } from '@lib/classes/admin-actions'
import { sameDetails } from '@lib/classes/content-diff'
import type { ClassContent, LibraryClass, ScheduledClass } from '@lib/classes/types'
import { api, BOOKINGS, CLASSES } from '../classes/api'
import { blankContent, build, fieldOf, fixLine, toForm, type Errors, type Form } from '../classes/class-form'
import { DetailsFields, focusFirstError, PreviewButton } from '../classes/ClassDetails'
import DateRows, { checkRows, endAfter, lengthOf, newDateRow, onOrAfter, weekLater, type DateRow } from '../classes/DateRows'
import { addDays, dayLabel, nextOpenDay, partsOf, today } from '../classes/dates'
import { closureOn, closures as configClosures, type Closure } from '@config/closures'
import { useStudio } from '../shell/studio'
import RepeatSection, { NO_REPEAT, patternOf, tickedDates, useRepeatPreview, type Repeat } from '../classes/RepeatSection'
import { openWeekdaysOf } from '@config/studio-days'
import { latestOf, priceOf, ranText } from '../classes/labels'
import { useLibraryList } from '../classes/library-data'
import { useRefresh } from '../shell/data'
import { NoPhoto } from '../ClassesTab'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { earlyBirdLabel, earlyBirdRunning } from '@lib/classes/early-bird'

export const ADDED = 'Added. It’s on the calendar and in your library.'
export const addedMany = (n: number) => `Added ${n} classes. They’re on the calendar and in your library.`
export const draftsMany = (n: number) => `Saved ${n} drafts. They’re in your library and go on the website when you open them.`

/** What a repeat that didn't add every ticked date says, with a way to finish. */
interface RepeatOutcome { total: number; created: RepeatResult['created']; skipped: RepeatResult['skipped']; left: string[]; warning?: string; status: 'open' | 'draft' }
const days = (list: string[]) => list.map(dayLabel).join(', ')

type From = { kind: 'lib'; id: string } | { kind: 'class'; id: string }
/** The library class it links to (and its details), and the details the form was filled with. */
interface Picked { libraryId: string | null; content: ClassContent | null; name: string; startedFrom: ClassContent }

export { nextOpenDay }

/** A week out, then on to the next day the studio opens. `closed`: the owners' closed days (useStudio). */
export function defaultDay(now = today(), closed: Closure[] = configClosures, open?: ReadonlySet<number>): string {
  return nextOpenDay(addDays(now, 7), closed, open)
}

function freshRows(day: string | undefined, closed: Closure[], open?: ReadonlySet<number>): DateRow[] {
  return [newDateRow({ day: day ?? defaultDay(today(), closed, open), start: '18:00', end: '20:00', capacity: 12 })]
}

function newKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  return c?.randomUUID ? c.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** A library class's details, at its usual time and seats, on `day` (or a week from today). */
function fromLibrary(lib: LibraryClass, run: LibraryRun | undefined, day: string | undefined, closed: Closure[], open?: ReadonlySet<number>): { form: Form; rows: DateRow[]; picked: Picked } {
  const c = latestOf(lib).content
  const start = run ? partsOf(run.startIso).time : '18:00'
  const d = day ?? defaultDay(today(), closed, open)
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
  /** N4: the library entry an earlier Add from scratch made (all dates refused): Change the dates reuses it. */
  const madeLib = useRef<string | null>(null)
  const [replacing, setReplacing] = useState<LibraryClass | null>(null)
  /** The form as last filled in (opened, or a past class picked): typing past this is "what you typed". */
  const lastFill = useRef('')
  const body = useRef<HTMLDivElement>(null)

  const snapshot = (form: Form, r: DateRow[]) => JSON.stringify([form, r.map(({ key: _k, ...x }) => x)])
  const studioDays = useStudio().days
  const closed = studioDays.closures
  const openDays = openWeekdaysOf(studioDays.studio)
  const [first] = useState(() => ({ form: toForm(blankContent()), rows: freshRows(day, closed, openDays) }))
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
  const [repeat, setRepeat] = useState<Repeat>(NO_REPEAT)
  const [repeatError, setRepeatError] = useState('')
  const [progress, setProgress] = useState('')
  const [outcome, setOutcome] = useState<RepeatOutcome | null>(null)
  /** The repeat as last sent: "Try the rest again" sends exactly this again (same key, so what was made is never made twice). */
  const sentRepeat = useRef<Record<string, unknown> | null>(null)

  const dirty = ready && (snapshot(f, rows) !== start || repeat.kind !== 'none')
  useSheetDirty(dirty)

  function begin(form: Form, r: DateRow[], p: Picked | null) {
    setF(form)
    setRows(r)
    setPicked(p)
    madeLib.current = null
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
      const x = fromLibrary(lib, runs[lib.id], day, closed, openDays)
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
      // R37 (RM1): a week on from its dates, but never before the next day the studio opens from today.
      begin(toForm(cls.content), onOrAfter(weekLater(cls.sessions), nextOpenDay(today(), closed, openDays), (d) => !!closureOn(d, closed)), { libraryId: lib?.id ?? null, content: lib ? latestOf(lib).content : null, name: cls.content.name, startedFrom: cls.content })
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
    const x = fromLibrary(lib, runs[lib.id], day ?? rows[0]?.day, closed, openDays)
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
        setRows(freshRows(day ?? rows[0]?.day, closed, openDays))
      }
      setPicked(null)
    }
  }

  const checkedRows = checkRows(rows)
  const previewSessions = checkedRows.ok ? checkedRows.sessions : []
  const built = build(f)
  // The choice only when she changed the details here and they differ from the library's (Q9).
  const differs = !!picked?.content && built.ok && !sameDetails(built.content, picked.content) && !sameDetails(built.content, picked.startedFrom)
  const repeating = repeat.kind !== 'none'
  const libIdNow = (): string | null => picked?.libraryId ?? madeLib.current
  const preview = useRepeatPreview(repeat, checkedRows.ok ? checkedRows.sessions : null, { content: built.ok ? built.content : undefined, libraryId: picked?.libraryId ?? null })
  const ticked = repeating ? tickedDates(repeat, preview.dates).length : 1

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
    if (repeating) return addRepeat(status, alsoLibrary, content, checked.sessions)
    setBusy(status === 'draft' ? 'draft' : alsoLibrary ? 'both' : 'add')
    const r = await api<{ class: ScheduledClass; replay?: boolean }>(CLASSES, {
      action: 'create', content, sessions: checked.sessions, status, createKey: createKey.current,
      ...(libIdNow() ? { libraryId: libIdNow() } : {}),
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
    madeLib.current = null
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

  async function addRepeat(status: 'open' | 'draft', alsoLibrary: boolean, content: ClassContent, sessions: unknown[]) {
    setRepeatError('')
    const pattern = patternOf(repeat)
    if (!pattern) { setRepeatError('Pick an until date.'); return }
    if (!preview.dates) { setRepeatError(preview.error || 'One moment, the dates are still being checked.'); return }
    const chosen = tickedDates(repeat, preview.dates)
    if (!chosen.length) { setRepeatError('Tick at least one date.'); return }
    const req = {
      action: 'repeat', content, sessions, status, createKey: createKey.current, pattern,
      skip: preview.dates.filter((d) => !chosen.some((c) => c.ymd === d.ymd)).map((d) => d.ymd),
      ...(libIdNow() ? { libraryId: libIdNow() } : {}),
      ...(alsoLibrary ? { alsoUpdateLibrary: true } : {}),
    }
    sentRepeat.current = req
    setBusy(status === 'draft' ? 'draft' : alsoLibrary ? 'both' : 'add')
    await sendRepeat(req, chosen.length, status)
  }

  /** Sends the repeat, carrying on while the server says it ran out of time (each send replays what's made). */
  async function sendRepeat(req: Record<string, unknown>, total: number, status: 'open' | 'draft') {
    // I2: a dropped connection or a server error (the function ran out of time) is sent again once by itself.
    // Safe: every date has its own key, so what was made is answered, never made twice.
    let resent = false
    const send = async () => {
      let res = await api<RepeatResult>(CLASSES, req)
      if (!res.ok && (res.status === 0 || res.status >= 500) && !resent) {
        resent = true
        res = await api<RepeatResult>(CLASSES, req)
      }
      return res
    }
    let r = await send()
    for (let i = 0; i < 12 && r.ok && r.data?.leftBecause === 'time'; i++) {
      setProgress(`Added ${r.data.created.length} of ${total}…`)
      r = await send()
    }
    setBusy('')
    setProgress('')
    if (!r.ok || !r.data) {
      if (r.extra.field === 'repeat') { setRepeatError(r.error ?? DIDNT_SAVE); return }
      const k = r.extra.field ? fieldOf(r.extra.field, f) : r.status === 409 ? 'dates' : 'form'
      if (k === 'dates') setDatesError(r.error ?? DIDNT_SAVE)
      const next = { [k]: r.error ?? DIDNT_SAVE } as Errors
      setErrors(next)
      if (k !== 'form') requestAnimationFrame(() => focusFirstError(body.current, next))
      return
    }
    const d = r.data
    if (!picked?.libraryId && d.libraryId) madeLib.current = d.libraryId
    if (d.created.length) bump()
    if (!d.skipped.length && !d.left.length) return finishRepeat(d.created, status, r.warning)
    setOutcome({ total, created: d.created, skipped: d.skipped, left: d.left, status, ...(r.warning ? { warning: r.warning } : {}) })
  }

  /** I1: back to the form after nothing was added. A new key, so the next Add is a new request. */
  function changeDates() {
    setOutcome(null)
    sentRepeat.current = null
    createKey.current = newKey()
    requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('[data-field="dates"] input, [data-field="repeat"] input')?.focus())
  }

  function finishRepeat(created: RepeatResult['created'], status: 'open' | 'draft', warning?: string) {
    setOutcome(null)
    madeLib.current = null
    setStart(snapshot(f, rows))
    setRepeat(NO_REPEAT)
    createKey.current = newKey()
    setDirty(false)
    if (!created.length) return
    const n = created.length
    toast(warning ?? (n === 1 ? (status === 'draft' ? 'Saved as a draft. It’s in your library; it goes on the website when you open it.' : ADDED) : status === 'draft' ? draftsMany(n) : addedMany(n)))
    open({ kind: 'class', id: created[0].class.id })
  }

  const line = errors.form || fixLine(errors, 'above')
  const many = repeating && (ticked !== 1 || !preview.dates)
  const addLabel = repeating ? (!preview.dates ? 'Add classes' : ticked === 1 ? 'Add 1 class' : `Add ${ticked} classes`) : 'Add class'
  const outcomePanel = outcome && (
    <div className="adm-panel" role="alert" aria-label="What was added">
      <b>{outcome.created.length ? `Added ${outcome.created.length} of ${outcome.total}.` : outcome.left.length ? 'Nothing was added yet.' : 'None of these dates could be added.'}</b>
      {outcome.created.length > 0 && <span className="adm-small">{`Added ${days(outcome.created.map((c) => c.ymd))}.`}</span>}
      {outcome.skipped.map((x) => <span key={x.ymd} className="adm-small">{`Not added ${dayLabel(x.ymd)}. ${x.reason}`}</span>)}
      {outcome.left.length > 0 && <span className="adm-small">{`Not added yet ${days(outcome.left)}.`}</span>}
      {outcome.warning && <span className="adm-small">{outcome.warning}</span>}
      {outcome.created.length > 0 && outcome.left.length > 0 && <span className="adm-small">To change anything, press Stop here and add the rest as a new class.</span>}
      <div className="adm-two">
        {outcome.left.length > 0 && (
          <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => { setBusy('add'); sendRepeat(sentRepeat.current!, outcome.total, outcome.status) }}>
            {busy ? 'Adding…' : 'Try the rest again'}
          </button>
        )}
        {outcome.created.length > 0 && (
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => finishRepeat(outcome.created, outcome.status, outcome.warning)}>
            {outcome.left.length ? 'Stop here' : 'Done'}
          </button>
        )}
        {outcome.created.length === 0 && (
          // I1: nothing was made, so nothing is lost by starting again: the form stays, with a fresh key.
          <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={changeDates}>Change the dates</button>
        )}
      </div>
    </div>
  )
  const footer = (
    <div className="adm-stack">
      {line && <p className="adm-footline" role="alert">{line}</p>}
      {progress && <p className="adm-small adm-muted adm-center" aria-live="polite">{progress}</p>}
      {outcomePanel}
      {!outcome && (differs
        ? (
          <>
            <p className="adm-small adm-muted adm-center">You changed the details. Keep the changes for:</p>
            <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => add('open')}>{busy === 'add' ? 'Adding…' : many ? 'Only these classes' : 'Only this class'}</button>
            <button type="button" className="adm-btn is-ghost" disabled={!!busy} onClick={() => add('open', true)}>{busy === 'both' ? 'Adding…' : many ? 'These classes and the library' : 'This class and the library'}</button>
          </>
        )
        : <button type="button" className="adm-btn is-pri" disabled={!!busy || !ready} onClick={() => add('open')}>{busy === 'add' ? 'Adding…' : addLabel}</button>)}
      {!outcome && <button type="button" className="adm-quiet" disabled={!!busy || !ready} onClick={() => add('draft')}>{busy === 'draft' ? 'Saving…' : many ? (preview.dates ? `Save ${ticked} as drafts` : 'Save as drafts') : 'Save as draft'}</button>}
    </div>
  )

  // M-f: a copied class whose early-bird still runs brings it along; say so, so it's never a surprise.
  const copiedEarlyBird = picked && f.ebOn && picked.startedFrom.earlyBird && earlyBirdRunning(picked.startedFrom, new Date())
    ? earlyBirdLabel(picked.startedFrom)
    : ''
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
            {copiedEarlyBird && (
              <p className="adm-note" role="status" data-testid="copied-early-bird">{`This copies its early-bird too: ${copiedEarlyBird}. Turn it off under the price if these dates shouldn’t have it.`}</p>
            )}
            <PreviewButton f={f} sessions={previewSessions} />
            {/* Stale edits: while the "Added 4 of 6" panel is up, the form is locked, so no change silently does nothing. */}
            <fieldset disabled={!!outcome} aria-disabled={!!outcome} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <DetailsFields f={f} set={(fn) => setF((cur) => fn(cur))} errors={errors} sessions={rows.map((r, i) => ({ id: r.id, label: `Date ${i + 1}` }))}>
              <DateRows rows={rows} onChange={(r) => { setRows(r); setDatesError('') }} error={datesError} />
              <RepeatSection
                value={repeat}
                onChange={(r) => {
                  // M6: a new Repeat choice with no repeat sent yet gets its own key, so an earlier lost single Add
                  // can't make the first date read "Clashes with" itself.
                  if (r.kind !== repeat.kind && !sentRepeat.current) createKey.current = newKey()
                  setRepeat(r); setRepeatError('')
                }}
                firstDay={checkedRows.ok ? [...rows].map((r) => r.day).sort()[0] ?? '' : ''}
                multi={rows.length > 1}
                preview={preview}
                error={repeatError}
              />
            </DetailsFields>
            </fieldset>
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
