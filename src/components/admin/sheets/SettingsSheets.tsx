/**
 * More › Hours & Craft Café and More › Closed days (direction D). Both edit
 * the one studio settings document (GET/POST /api/admin/settings.json): every
 * save sends all of it with the updatedAt it was loaded with, so a change
 * made elsewhere in between is never written over. Saving also rewrites
 * Craft Café's dated windows in Square (the calendar reads them); if Square
 * refuses, the settings are still saved and the sheet offers Try again.
 */
import { useContext, useEffect, useRef, useState, type ReactElement } from 'react'
import { OWNERS } from '@lib/admin-who'
import { localDate } from '@lib/party-slots'
import type { CafeSquareResult } from '@lib/cafe-windows'
import type { BookedOnClosure } from '@lib/settings-effects'
import type { SettingsInput, SettingsView, StoredClosure } from '@lib/studio-settings'
import { closureOn, type Holiday } from '@config/closures'
import { cafeHoursEntries, STUDIO_HOURS, type CafeSpecialDay, type CafeWeekly, type Weekday } from '@config/hours'
import { api, SETTINGS } from '../classes/api'
import { dayLabel, today } from '../classes/dates'
import { useRefresh } from '../shell/data'
import { Failed, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { WhoContext } from './MoreSheets'
import { useStudio } from '../shell/studio'
import { clockRange, dayAndSpan } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

interface SaveReply {
  settings: SettingsView
  changed: string[]
  booked: BookedOnClosure[]
  bookedUnknown?: boolean
  square: CafeSquareResult | null
}
type Saved = { ok: true; data: SaveReply } | { ok: false; error: string; field?: string; stale?: boolean }

const input = (v: SettingsView): SettingsInput => ({ cafeWeekly: v.cafeWeekly, cafeSpecialDays: v.cafeSpecialDays, closures: v.closures })
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
export const rangeText = (c: { from: string; to: string }) => (c.from === c.to ? dayLabel(c.from) : `${dayLabel(c.from)} – ${dayLabel(c.to)}`)
const STALE = 'Someone else changed these settings. Check them and save again.'

/** "Saved." plus how Square went; a failure stays in the sheet with Try again. */
function savedText(square: CafeSquareResult | null, lead = 'Saved.'): string {
  if (!square || square.status === 'updated' || square.status === 'unchanged') return lead
  return `${lead} ${square.message}`
}

/** Saving the settings: always the latest updatedAt, the new settings everywhere at once, Square's answer kept for the sheet. */
function useSettingsSave() {
  const studio = useStudio()
  const { bump } = useRefresh()
  const toast = useToast()
  const latest = useRef<SettingsView | null>(studio.view)
  latest.current = studio.view ?? latest.current
  const [square, setSquare] = useState<CafeSquareResult | null>(null)
  const [retrying, setRetrying] = useState(false)

  async function save(change: (cur: SettingsInput) => SettingsInput): Promise<Saved> {
    const cur = latest.current
    if (!cur) return { ok: false, error: 'The settings haven’t loaded yet.' }
    const r = await api<SaveReply>(SETTINGS, { ...change(input(cur)), expectedUpdatedAt: cur.updatedAt })
    if (r.ok && r.data) {
      latest.current = r.data.settings
      studio.replace(r.data.settings)
      setSquare(r.data.square)
      bump()
      return { ok: true, data: r.data }
    }
    if (r.status === 409 && r.extra.current) {
      latest.current = r.extra.current
      studio.replace(r.extra.current)
      return { ok: false, error: STALE, stale: true }
    }
    return { ok: false, error: r.error ?? DIDNT_SAVE, field: r.extra.field }
  }

  async function retrySquare() {
    setRetrying(true)
    const r = await api<{ square: CafeSquareResult }>(SETTINGS, { action: 'square-retry' })
    setRetrying(false)
    if (r.ok && r.data) {
      setSquare(r.data.square)
      toast(r.data.square.status === 'failed' ? 'Square still didn’t take the café hours.' : r.data.square.message)
    } else toast(DIDNT_SAVE)
  }

  return { save, square, retrySquare, retrying, toast }
}

/** Square didn't take the café hours: the settings are saved; say so and offer Try again. */
function SquareFailed({ square, onRetry, busy }: { square: CafeSquareResult | null; onRetry: () => void; busy: boolean }) {
  if (square?.status !== 'failed') return null
  return (
    <div className="adm-panel is-warn adm-gap-bottom" role="alert">
      <b>Saved here. {square.message}</b>
      <span className="adm-small">The public calendar may show the old Craft Café hours until Square has them.</span>
      <button type="button" className="adm-btn is-ghost is-sm" disabled={busy} onClick={onRetry}>{busy ? 'Trying…' : 'Try again'}</button>
    </div>
  )
}

/** The sheet's load: settings come from the shell's StudioProvider. */
function useLoaded(): { view: SettingsView | null; gate: ReactElement | null } {
  const studio = useStudio()
  if (studio.view) return { view: studio.view, gate: null }
  if (studio.error) return { view: null, gate: <Failed message={studio.error} onRetry={studio.retry} /> }
  return { view: null, gate: <Skeleton rows={3} label="Loading the settings" /> }
}

// ---------------------------------------------------------------- Hours & Craft Café

const WEEK_ORDER: Weekday[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const byWeek = (a: CafeWeekly, b: CafeWeekly) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday)
const sameWeekly = (a: CafeWeekly[], b: CafeWeekly[]) => JSON.stringify([...a].sort(byWeek)) === JSON.stringify([...b].sort(byWeek))

function weeklySummary(weekly: CafeWeekly[]): string {
  const rows = cafeHoursEntries({ weekly, special: [] })
  if (!rows.length) return 'Special days only'
  return rows.map((r) => `${r.days.map((d) => `${d}s`).join(' & ')} ${clockRange(r.opens, r.closes)}`).join(' · ')
}

export function HoursSheet() {
  const { view, gate } = useLoaded()
  return (
    <SheetFrame tall title="Hours & Craft Café" subtitle={view ? weeklySummary(view.cafeWeekly) : undefined}>
      {gate ?? <HoursForm view={view!} />}
    </SheetFrame>
  )
}

function HoursForm({ view }: { view: SettingsView }) {
  const { save, square, retrySquare, retrying, toast } = useSettingsSave()
  const { who } = useContext(WhoContext)
  const otherOwner = OWNERS.find((o) => o !== who) ?? 'the other owner'
  const { days } = useStudio()
  const [weekly, setWeekly] = useState<CafeWeekly[]>(() => [...view.cafeWeekly].sort(byWeek))
  const [weeklyError, setWeeklyError] = useState('')
  const [savingWeekly, setSavingWeekly] = useState(false)
  const [adding, setAdding] = useState(false)
  const [sp, setSp] = useState({ date: '', name: '', opens: '09:00', closes: '17:00' })
  const [spError, setSpError] = useState('')
  const [savingSpecial, setSavingSpecial] = useState(false)
  const [stale, setStale] = useState('')
  const weeklyDirty = !sameWeekly(weekly, view.cafeWeekly)
  const specialDirty = adding && (sp.date !== '' || sp.name.trim() !== '')
  useSheetDirty(weeklyDirty || specialDirty)
  // Someone else's save came in and nothing here was touched: show theirs.
  useEffect(() => { if (!weeklyDirty) setWeekly([...view.cafeWeekly].sort(byWeek)) }, [view.updatedAt])

  const now = today()
  const special = view.cafeSpecialDays.filter((d) => d.date >= now)
  const unused = WEEK_ORDER.filter((d) => !weekly.some((w) => w.weekday === d))
  const setRow = (i: number, p: Partial<CafeWeekly>) => { setWeekly(weekly.map((w, n) => (n === i ? { ...w, ...p } : w))); setWeeklyError('') }

  async function saveWeekly() {
    const bad = weekly.find((w) => !w.opens || !w.closes || w.closes <= w.opens)
    if (bad) return setWeeklyError(`${bad.weekday}: it has to close after it opens.`)
    setSavingWeekly(true)
    setStale('')
    const r = await save((cur) => ({ ...cur, cafeWeekly: weekly }))
    setSavingWeekly(false)
    if (r.ok) {
      setWeekly([...r.data.settings.cafeWeekly].sort(byWeek))
      toast(savedText(r.data.square, 'Café hours saved.'))
    } else if (r.stale) setStale(r.error)
    else setWeeklyError(r.error)
  }

  async function addSpecial() {
    setSpError('')
    if (!sp.date) return setSpError('Pick the day.')
    if (!sp.opens || !sp.closes || sp.closes <= sp.opens) return setSpError('It has to close after it opens.')
    if (view.cafeSpecialDays.some((d) => d.date === sp.date)) return setSpError('That day already has special hours. Remove them first.')
    setSavingSpecial(true)
    setStale('')
    const day: CafeSpecialDay = { date: sp.date, opens: sp.opens, closes: sp.closes, name: sp.name.trim() }
    const r = await save((cur) => ({ ...cur, cafeSpecialDays: [...cur.cafeSpecialDays, day] }))
    setSavingSpecial(false)
    if (!r.ok) return r.stale ? setStale(r.error) : setSpError(r.error)
    setAdding(false)
    setSp({ date: '', name: '', opens: '09:00', closes: '17:00' })
    toast(savedText(r.data.square, `Added ${dayLabel(day.date)}. It’s on the calendar.`), {
      undo: () => { save((cur) => ({ ...cur, cafeSpecialDays: cur.cafeSpecialDays.filter((d) => d.date !== day.date) })).then((u) => { if (!u.ok) toast(DIDNT_SAVE) }) },
    })
  }

  async function removeSpecial(day: CafeSpecialDay) {
    setStale('')
    const r = await save((cur) => ({ ...cur, cafeSpecialDays: cur.cafeSpecialDays.filter((d) => d.date !== day.date) }))
    if (!r.ok) { if (r.stale) setStale(r.error); else toast(DIDNT_SAVE); return }
    toast(savedText(r.data.square, `Removed ${dayLabel(day.date)}. Usual hours that day.`), {
      undo: () => { save((cur) => ({ ...cur, cafeSpecialDays: [...cur.cafeSpecialDays, day] })).then((u) => { if (!u.ok) toast(DIDNT_SAVE) }) },
    })
  }

  const spClosed = sp.date ? closureOn(sp.date, days.closures) : null
  return (
    <>
      {stale && <p className="adm-error" role="alert">{stale}</p>}
      <SquareFailed square={square} onRetry={retrySquare} busy={retrying} />
      <p className="adm-lbl adm-lbl-first">Craft Café · every week</p>
      {weekly.length === 0 && <p className="adm-empty">No weekly hours. Craft Café runs only on special days.</p>}
      {weekly.map((w, i) => (
        <fieldset key={w.weekday} className="adm-date">
          <legend>{`${w.weekday}s`}</legend>
          <div className="adm-two">
            <label className="adm-fld"><span>Opens</span><input type="time" value={w.opens} onChange={(e) => setRow(i, { opens: e.target.value })} /></label>
            <label className="adm-fld"><span>Closes</span><input type="time" value={w.closes} onChange={(e) => setRow(i, { closes: e.target.value })} /></label>
          </div>
          <button type="button" className="adm-btn is-ghost is-sm" onClick={() => { setWeekly(weekly.filter((_, n) => n !== i)); setWeeklyError('') }}>{`No café on ${w.weekday}s`}</button>
        </fieldset>
      ))}
      {unused.length > 0 && (
        <label className="adm-fld">
          <span>Add another day</span>
          <select
            value=""
            onChange={(e) => {
              const d = e.target.value as Weekday
              if (d) { setWeekly([...weekly, { weekday: d, opens: '09:00', closes: '12:00' }].sort(byWeek)); setWeeklyError('') }
            }}
          >
            <option value="">Pick a day</option>
            {unused.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      )}
      {weeklyError && <p className="adm-error adm-fielderr" role="alert">{weeklyError}</p>}
      <button type="button" className="adm-btn is-pri" disabled={!weeklyDirty || savingWeekly} onClick={saveWeekly}>
        {savingWeekly ? 'Saving…' : 'Save café hours'}
      </button>

      <p className="adm-lbl">Special days</p>
      {special.length === 0 && <p className="adm-muted adm-small">None coming up.</p>}
      {special.map((d) => (
        <div key={d.date} className="adm-kv adm-setrow">
          <span><b>{`${dayLabel(d.date)} · ${d.name}`}</b><br /><span className="adm-small adm-muted">{clockRange(d.opens, d.closes)}{closureOn(d.date, days.closures) ? ' · closed that day, so no café' : ''}</span></span>
          <button type="button" className="adm-btn is-ghost is-sm" aria-label={`Remove ${dayLabel(d.date)}`} onClick={() => removeSpecial(d)}>Remove</button>
        </div>
      ))}
      {adding ? (
        <fieldset className="adm-date adm-gap-top">
          <legend>New special day</legend>
          <label className="adm-fld"><span>Day</span><input type="date" min={now} value={sp.date} aria-invalid={spError === 'Pick the day.' || undefined} onChange={(e) => { setSp({ ...sp, date: e.target.value }); setSpError('') }} /></label>
          <label className="adm-fld"><span>What is it?</span><input value={sp.name} maxLength={60} placeholder="Like: Holiday market" onChange={(e) => setSp({ ...sp, name: e.target.value })} /></label>
          <div className="adm-two">
            <label className="adm-fld"><span>Opens</span><input type="time" value={sp.opens} onChange={(e) => { setSp({ ...sp, opens: e.target.value }); setSpError('') }} /></label>
            <label className="adm-fld"><span>Closes</span><input type="time" value={sp.closes} onChange={(e) => { setSp({ ...sp, closes: e.target.value }); setSpError('') }} /></label>
          </div>
          {spClosed && <p className="adm-small adm-warntext">{`That day is closed for ${spClosed.name}. Closed days beat special hours.`}</p>}
          {spError && <p className="adm-error adm-fielderr" role="alert">{spError}</p>}
          <div className="adm-two">
            <button type="button" className="adm-btn is-ghost" onClick={() => { setAdding(false); setSpError('') }}>Never mind</button>
            <button type="button" className="adm-btn is-pri" disabled={savingSpecial} onClick={addSpecial}>{savingSpecial ? 'Adding…' : 'Add day'}</button>
          </div>
        </fieldset>
      ) : (
        <button type="button" className="adm-btn is-ghost adm-gap-top" onClick={() => setAdding(true)}>+ Add a special day</button>
      )}
      <p className="adm-note adm-gap-top">A special day replaces the usual hours for that day. Closed days beat both.</p>

      <p className="adm-lbl">Studio hours</p>
      {cafeHoursEntries({ weekly: STUDIO_HOURS.flatMap((h) => h.days.map((weekday) => ({ weekday, opens: h.opens, closes: h.closes }))), special: [] })
        .map((h) => <div key={h.days.join()} className="adm-kv"><span>{h.days.join(' & ')}</span><span>{clockRange(h.opens, h.closes)}</span></div>)}
      <p className="adm-small adm-muted adm-gap-top">{`Studio hours show on the website and Google. Ask ${otherOwner} to change them.`}</p>
    </>
  )
}

// ---------------------------------------------------------------- Closed days

const HOLIDAY_LOOKS: [Holiday | '', string][] = [['', 'None'], ['halloween', 'Halloween'], ['thanksgiving', 'Thanksgiving'], ['christmas', 'Christmas']]

export function ClosedDaysSheet() {
  const { view, gate } = useLoaded()
  // The add button sits in the pinned footer; the form below does the work.
  const addRef = useRef<() => void>(() => {})
  const [busy, setBusy] = useState(false)
  const coming = view ? closedComing(view.closures) : null
  return (
    <SheetFrame
      tall
      title="Closed days"
      subtitle={coming === null ? undefined : `${coming} coming up`}
      footer={gate ? undefined : <button type="button" className="adm-btn is-pri" disabled={busy} onClick={() => addRef.current()}>{busy ? 'Adding…' : 'Add closed days'}</button>}
    >
      {gate ?? <ClosedForm view={view!} addRef={addRef} busy={busy} setBusy={setBusy} />}
    </SheetFrame>
  )
}

function ClosedForm({ view, addRef, busy, setBusy }: { view: SettingsView; addRef: { current: () => void }; busy: boolean; setBusy: (b: boolean) => void }) {
  const { save, square, retrySquare, retrying, toast } = useSettingsSave()
  const { open } = useSheet()
  const fromRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState<{ from: string; to: string; name: string; holiday: Holiday | '' }>({ from: '', to: '', name: '', holiday: '' })
  const [error, setError] = useState<{ field: 'from' | 'to' | 'name' | ''; text: string } | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [booked, setBooked] = useState<{ list: BookedOnClosure[]; unknown: boolean } | null>(null)
  const [stale, setStale] = useState('')
  useSheetDirty(f.from !== '' || f.to !== '' || f.name.trim() !== '' || f.holiday !== '')
  const now = today()
  const coming = view.closures.filter((c) => c.to >= now)

  async function add() {
    if (busy) return
    setError(null)
    setStale('')
    if (!f.from) {
      // The footer button with the form out of sight: take her to it.
      fromRef.current?.scrollIntoView?.({ block: 'center' })
      fromRef.current?.focus({ preventScroll: true })
      return setError({ field: 'from', text: 'Pick the first closed day.' })
    }
    if (f.to && f.to < f.from) return setError({ field: 'to', text: 'The last closed day can’t be before the first.' })
    setBusy(true)
    const draft = { from: f.from, to: f.to || f.from, name: f.name.trim(), ...(f.holiday ? { holiday: f.holiday } : {}) }
    const before = new Set(view.closures.map((c) => c.id))
    const r = await save((cur) => ({ ...cur, closures: [...cur.closures, draft as StoredClosure] }))
    setBusy(false)
    if (!r.ok) {
      if (r.stale) return setStale(r.error)
      return setError({ field: r.field?.startsWith('closures') ? (/last/.test(r.error) ? 'to' : /60/.test(r.error) ? 'name' : 'from') : '', text: r.error })
    }
    const made = r.data.settings.closures.find((c) => !before.has(c.id))
    setF({ from: '', to: '', name: '', holiday: '' })
    setBooked(r.data.booked.length || r.data.bookedUnknown ? { list: r.data.booked, unknown: !!r.data.bookedUnknown } : null)
    const n = r.data.booked.reduce((s, b) => s + b.items.length, 0)
    // Short: the sheet's panels carry the booked list and any Square trouble.
    const heads = n ? ` ${n === 1 ? '1 booking stays' : `${n} bookings stay`} booked.` : ''
    const skipped = r.data.square?.status === 'skipped' ? ` ${r.data.square.message}` : ''
    toast(`Closed ${rangeText(draft)}.${heads}${skipped}`, made ? {
      undo: () => { save((cur) => ({ ...cur, closures: cur.closures.filter((c) => c.id !== made.id) })).then((u) => { if (u.ok) setBooked(null); else toast(DIDNT_SAVE) }) },
    } : undefined)
  }

  async function remove(c: StoredClosure) {
    setAsking(null)
    setStale('')
    const r = await save((cur) => ({ ...cur, closures: cur.closures.filter((x) => x.id !== c.id) }))
    if (!r.ok) { if (r.stale) setStale(r.error); else toast(DIDNT_SAVE); return }
    toast(savedText(r.data.square, `Opened ${rangeText(c)} again.`), {
      undo: () => { save((cur) => ({ ...cur, closures: [...cur.closures, c] })).then((u) => { if (!u.ok) toast(DIDNT_SAVE) }) },
    })
  }

  addRef.current = add

  const errFor = (field: 'from' | 'to' | 'name') => (error?.field === field ? error.text : '')
  return (
    <>
      {stale && <p className="adm-error" role="alert">{stale}</p>}
      <SquareFailed square={square} onRetry={retrySquare} busy={retrying} />
      {booked && (
        <div className="adm-panel is-warn adm-gap-bottom" role="status">
          <b>Already booked on those days</b>
          <span className="adm-small">It all stays booked; nothing was cancelled. Let them know, or move them.</span>
          {booked.list.flatMap((b) => b.items.map((i) => (
            <button
              key={`${b.closureId}-${i.kind}-${i.id}-${i.startIso}`}
              type="button"
              className="adm-bookedlink"
              onClick={() => open(i.kind === 'class' ? { kind: 'class', id: i.id } : { kind: i.kind === 'party' ? 'party' : 'legacy', day: localDate(i.startIso), id: i.id })}
            >
              {`${cap(i.label)} · ${dayAndSpan(i.startIso, i.endIso)}`}<span aria-hidden="true"> ›</span>
            </button>
          )))}
          {booked.unknown && <span className="adm-small">Some bookings couldn’t be checked. Look at those days on the calendar.</span>}
          <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setBooked(null)}>Got it</button>
        </div>
      )}
      {coming.length === 0 && <p className="adm-empty">No closed days coming up.</p>}
      {coming.map((c) => (
        <div key={c.id} className="adm-setrow-wrap">
          <div className="adm-kv adm-setrow">
            <span><b>{cap(c.name)}</b><br /><span className="adm-small adm-muted">{rangeText(c)}</span></span>
            {asking !== c.id && <button type="button" className="adm-btn is-ghost is-sm" aria-label={`Remove ${c.name}`} onClick={() => setAsking(c.id)}>Remove</button>}
          </div>
          {asking === c.id && (
            <div className="adm-panel" role="group" aria-label={`Open ${rangeText(c)} again?`}>
              <b>{`Open ${rangeText(c)} again?`}</b>
              <span className="adm-small">Customers can book these days again.</span>
              <div className="adm-two">
                <button type="button" className="adm-btn is-ghost" onClick={() => setAsking(null)}>Keep it closed</button>
                <button type="button" className="adm-btn is-danger" onClick={() => remove(c)}>Open these days</button>
              </div>
            </div>
          )}
        </div>
      ))}
      <p className="adm-lbl">Add closed days</p>
      <div className="adm-two">
        <label className="adm-fld"><span>From</span><input ref={fromRef} type="date" min={now} value={f.from} aria-invalid={!!errFor('from') || undefined} onChange={(e) => { setF({ ...f, from: e.target.value }); setError(null) }} /></label>
        <label className="adm-fld"><span>To (blank for one day)</span><input type="date" min={f.from || now} value={f.to} aria-invalid={!!errFor('to') || undefined} onChange={(e) => { setF({ ...f, to: e.target.value }); setError(null) }} /></label>
      </div>
      {(errFor('from') || errFor('to')) && <p className="adm-error adm-fielderr" role="alert">{errFor('from') || errFor('to')}</p>}
      <label className="adm-fld"><span>Why</span><input value={f.name} maxLength={60} placeholder="Like: Spring break" aria-invalid={!!errFor('name') || undefined} onChange={(e) => { setF({ ...f, name: e.target.value }); setError(null) }} /></label>
      {errFor('name') && <p className="adm-error adm-fielderr" role="alert">{errFor('name')}</p>}
      <label className="adm-fld">
        <span>Holiday look on the calendar <span className="adm-muted">(optional)</span></span>
        <select value={f.holiday} onChange={(e) => setF({ ...f, holiday: e.target.value as Holiday | '' })}>
          {HOLIDAY_LOOKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      {error?.field === '' && <p className="adm-error" role="alert">{error.text}</p>}
      <p className="adm-note">Nothing can be booked on closed days. Anything already booked stays booked, and we’ll tell you about it.</p>
      <p className="adm-small adm-muted adm-gap-top">The studio is also closed every Monday to Wednesday.</p>
    </>
  )
}

/** "N coming up" for More's row. */
export function closedComing(closures: { to: string }[]): number {
  const now = today()
  return closures.filter((c) => c.to >= now).length
}

