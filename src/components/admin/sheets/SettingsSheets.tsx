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
import type { NotOnRegisterRow, RegisterChoices, RegisterSetupView } from '@lib/classes/register-setup'
import { REGISTER_DOWN_PAY, REGISTER_TAX_PERCENT } from '@lib/classes/register-words'
import { closureOn, type Holiday } from '@config/closures'
import { cafeHoursEntries, STUDIO_HOURS, type CafeSpecialDay, type CafeWeekly, type Weekday } from '@config/hours'
import { api, READER_SETTING, REGISTER, SETTINGS } from '../classes/api'
import type { ReaderStatus } from '@lib/classes/reader-setting'
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
              if (d) { setWeekly([...weekly, { weekday: d, opens: '09:00', closes: '13:00' }].sort(byWeek)); setWeeklyError('') }
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


// ---------------------------------------------------------------- Register setup

interface RegisterLoad {
  setup: RegisterSetupView
  choices: RegisterChoices | null
  choicesError?: string
  connection?: boolean
  notOnRegister: NotOnRegisterRow[]
  /** Fix round 4: classes on the register with an older tax or category. */
  oldSetup?: NotOnRegisterRow[]
}

const pct = (p: string) => `${Number(p) || p}%`

/**
 * More › Register setup (fix round 3): which Square tax is the 9% class tax
 * and which category is Classes. Lists what's in Square, lets an owner pick,
 * and makes the 9% tax or the Classes category when there isn't one. Saved
 * compare-and-set and audited; the site's built-in values are used until the
 * first save. After saving, the classes not on the register yet are listed,
 * each with a way to open it and tap Put it on the register, and (fix round 4)
 * the classes still on the old tax or category, with Update them all.
 */
export function RegisterSetupSheet() {
  const { open } = useSheet()
  const toast = useToast()
  const { bump } = useRefresh()
  const [d, setD] = useState<RegisterLoad | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const [tax, setTax] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState<'' | 'save' | 'tax' | 'category'>('')
  const [fieldError, setFieldError] = useState<{ tax?: string; category?: string; form?: string }>({})
  const [saved, setSaved] = useState(false)
  const [updating, setUpdating] = useState<{ done: number } | null>(null)
  const [updateError, setUpdateError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    api<RegisterLoad>(REGISTER).then((r) => {
      if (!live) return
      if (!r.ok || !r.data) { setError(r.error ?? ''); return }
      take(r.data)
    })
    return () => { live = false }
  }, [tries])

  function take(next: RegisterLoad) {
    setD(next)
    // What's in force now; one usable 9% tax and nothing picked → it, preselected.
    const usable = next.choices?.taxes.filter((t) => t.usable) ?? []
    const inForce = next.choices?.taxes.find((t) => t.id === next.setup.classTaxId && t.usable)
    setTax(inForce?.id ?? (usable.length === 1 ? usable[0].id : ''))
    const cats = next.choices?.categories ?? []
    const catInForce = cats.find((c) => c.id === next.setup.classesCategoryId)
    const named = cats.filter((c) => c.name.trim().toLowerCase() === 'classes')
    setCategory(catInForce?.id ?? (named.length === 1 ? named[0].id : ''))
  }

  const changed = !!d && (tax !== d.setup.classTaxId || category !== d.setup.classesCategoryId || d.setup.source.tax !== 'saved' || d.setup.source.category !== 'saved')
  useSheetDirty(!!d && !saved && (tax !== d.setup.classTaxId || category !== d.setup.classesCategoryId))

  async function save(over: { tax?: string; category?: string } = {}) {
    if (!d) return
    const body = { action: 'save', classTaxId: over.tax ?? tax, classesCategoryId: over.category ?? category, expectedUpdatedAt: d.setup.updatedAt }
    if (!body.classTaxId) { setFieldError({ tax: `Pick the ${REGISTER_TAX_PERCENT}% class tax.` }); return }
    if (!body.classesCategoryId) { setFieldError({ category: 'Pick the Classes category.' }); return }
    setBusy('save')
    setFieldError({})
    const r = await api<{ setup: RegisterSetupView; changed: string[]; notOnRegister: NotOnRegisterRow[]; oldSetup?: NotOnRegisterRow[] }>(REGISTER, body)
    setBusy('')
    if (r.ok && r.data) {
      const data = r.data
      // N1: merge into the latest state (a make() just before may have added the new tax to the choices).
      setD((cur) => cur && ({ ...cur, setup: data.setup, notOnRegister: data.notOnRegister, oldSetup: data.oldSetup ?? [] }))
      setTax(data.setup.classTaxId)
      setCategory(data.setup.classesCategoryId)
      setSaved(true)
      bump()
      const old = data.oldSetup?.length ?? 0
      toast(old ? 'Saved. Now tap Update them all below.' : data.notOnRegister.length ? 'Saved. Now put each class below on the register.' : 'Saved. Classes go on the register with this tax and category.')
      return
    }
    if (r.status === 409 && r.extra.current) {
      const current = r.extra.current as RegisterSetupView
      setD((cur) => cur && ({ ...cur, setup: current }))
      setFieldError({ form: 'Someone else changed the register setup just now. Check it and save again.' })
      return
    }
    const field = r.extra.field as 'tax' | 'category' | undefined
    setFieldError({ [field ?? 'form']: r.error ?? DIDNT_SAVE })
  }

  /** Make the 9% tax (or the Classes category) in Square, then pick and save it in one go. */
  async function make(kind: 'tax' | 'category') {
    if (!d) return
    setBusy(kind)
    setFieldError({})
    // N9: what this sheet listed, so a retry after a lost reply still records who made it.
    const seen = kind === 'tax' ? (d.choices?.taxes ?? []).map((t) => t.id) : (d.choices?.categories ?? []).map((c) => c.id)
    const r = await api<{ id: string; made: boolean; choices: RegisterChoices | null }>(REGISTER, { action: kind === 'tax' ? 'create-tax' : 'create-category', seen })
    setBusy('')
    if (!r.ok || !r.data) { setFieldError({ [kind]: r.error ?? DIDNT_SAVE }); return }
    const fresh = r.data.choices
    if (fresh) setD((cur) => cur && ({ ...cur, choices: fresh }))
    if (kind === 'tax') setTax(r.data.id)
    else setCategory(r.data.id)
    const nextTax = kind === 'tax' ? r.data.id : tax
    const nextCat = kind === 'category' ? r.data.id : category
    if (nextTax && nextCat) await save({ tax: nextTax, category: nextCat })
    else toast(kind === 'tax' ? `The ${REGISTER_TAX_PERCENT}% class tax is ready. Now pick the Classes category.` : 'The Classes category is ready. Now pick the class tax.')
  }

  /**
   * Fix round 4: "Update them all". The server works through the classes for a
   * few seconds per call; this keeps calling while it makes progress, so one
   * tap does them all. Safe to tap again: a class already updated isn't sent.
   */
  async function updateAll() {
    setUpdateError('')
    let done = 0
    setUpdating({ done })
    for (let round = 0; round < 50; round++) {
      const r = await api<{ updated: number; failed: NotOnRegisterRow[]; left: number; oldSetup: NotOnRegisterRow[] }>(REGISTER, { action: 'update-classes' })
      if (!r.ok || !r.data) { setUpdateError(r.error ?? DIDNT_SAVE); break }
      const data = r.data
      done += data.updated
      setUpdating({ done })
      setD((cur) => cur && ({ ...cur, oldSetup: data.oldSetup }))
      if (data.failed.length && !data.left) {
        setUpdateError(`${data.failed.length === 1 ? `${data.failed[0].name} didn’t` : `${data.failed.length} classes didn’t`} update. Square didn’t take it just now. Tap Update them all again in a few minutes.`)
        break
      }
      if (!data.left || (!data.updated && !data.failed.length)) {
        if (!data.oldSetup.length) toast(done === 1 ? 'Updated 1 class. The register is up to date.' : `Updated ${done} classes. The register is up to date.`)
        break
      }
    }
    setUpdating(null)
    bump()
  }

  const usableTaxes = d?.choices?.taxes.filter((t) => t.usable) ?? []
  // N3: the tax classes use now, when it isn't one that can be picked (wrong, or gone from Square).
  const inUse = d?.choices && d.setup.classTaxId ? d.choices.taxes.find((t) => t.id === d.setup.classTaxId) ?? null : null
  const inUseBad = !!d?.choices && !!d.setup.classTaxId && (!inUse || !inUse.usable)
  const hasClassesCat = !!d?.choices?.categories.some((c) => c.name.trim().toLowerCase() === 'classes')
  const last = d?.setup.history[0]
  const footer = d?.choices
    ? <button type="button" className="adm-btn is-pri" disabled={!!busy || !changed} onClick={() => save()}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
    : undefined

  return (
    <SheetFrame tall title="Register setup" subtitle="The tax and category classes use on the register" footer={footer}>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !d && <Skeleton rows={4} label="Loading the register setup" />}
      {d && (
        <>
          <p className="adm-note">{`Every class you open goes on the register with this tax and category. The tax has to be ${REGISTER_TAX_PERCENT}%, the same as the website adds when people pay.`}</p>
          {!d.choices && (
            <div className="adm-panel is-warn" role="alert">
              <b>{d.choicesError}</b>
              {d.connection && <span className="adm-small">{REGISTER_DOWN_PAY}</span>}
              <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setTries((n) => n + 1)}>Try again</button>
            </div>
          )}
          {d.choices && (
            <>
              <fieldset className="adm-date adm-gap-top" data-field="tax">
                <legend>{`Class tax (${REGISTER_TAX_PERCENT}%)`}</legend>
                {inUseBad && (
                  <p className="adm-warntext" role="note">{inUse
                    ? `The tax classes use now (${inUse.name}, ${pct(inUse.percent)}) isn’t right: ${inUse.why} Pick the ${REGISTER_TAX_PERCENT}% tax below.`
                    : `The tax classes use now isn’t on the register any more. Pick the ${REGISTER_TAX_PERCENT}% tax below.`}</p>
                )}
                {!inUseBad && inUse && <p className="adm-small adm-muted">{`In use now: ${inUse.name}, ${pct(inUse.percent)}.`}</p>}
                {d.choices.taxes.length === 0 && <p className="adm-empty">There are no taxes on the register yet.</p>}
                {d.choices.taxes.map((t) => (
                  <label key={t.id} className="adm-check">
                    <input type="radio" name="register-tax" disabled={!t.usable || !!busy} checked={tax === t.id} onChange={() => { setTax(t.id); setSaved(false) }} />
                    <span>
                      {`${t.name} · ${pct(t.percent)} · ${t.enabled ? 'on' : 'off'}`}
                      {!t.usable && <small className="adm-small adm-muted" style={{ display: 'block' }}>{t.why}</small>}
                    </span>
                  </label>
                ))}
                {usableTaxes.length === 0 && (
                  <div className="adm-panel" role="group" aria-label={`No ${REGISTER_TAX_PERCENT}% tax yet`}>
                    <b>{`There’s no ${REGISTER_TAX_PERCENT}% tax on the register yet.`}</b>
                    <span className="adm-small">{`This makes one called Sales tax, ${REGISTER_TAX_PERCENT}%, added on top of prices, and picks it.`}</span>
                    <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => make('tax')}>{busy === 'tax' ? 'Making it…' : `Make the ${REGISTER_TAX_PERCENT}% class tax`}</button>
                  </div>
                )}
                {fieldError.tax && <p className="adm-error" role="alert">{fieldError.tax}</p>}
              </fieldset>

              <fieldset className="adm-date adm-gap-top" data-field="category">
                <legend>Classes category</legend>
                {d.choices.categories.length === 0 && <p className="adm-empty">There are no categories on the register yet.</p>}
                {d.choices.categories.map((c) => (
                  <label key={c.id} className="adm-check">
                    <input type="radio" name="register-category" disabled={!!busy} checked={category === c.id} onChange={() => { setCategory(c.id); setSaved(false) }} />
                    <span>{c.name}</span>
                  </label>
                ))}
                {!hasClassesCat && (
                  <div className="adm-panel" role="group" aria-label="No Classes category yet">
                    <b>There’s no Classes category on the register yet.</b>
                    <span className="adm-small">This makes one called Classes and picks it.</span>
                    <button type="button" className="adm-btn is-pri" disabled={!!busy} onClick={() => make('category')}>{busy === 'category' ? 'Making it…' : 'Make the Classes category'}</button>
                  </div>
                )}
                {fieldError.category && <p className="adm-error" role="alert">{fieldError.category}</p>}
              </fieldset>
            </>
          )}
          {fieldError.form && <p className="adm-error" role="alert">{fieldError.form}</p>}

          {(d.oldSetup?.length ?? 0) > 0 && (
            <section aria-label="Still on the old tax" className="adm-gap-top">
              <p className="adm-lbl">{d.oldSetup!.length === 1 ? '1 class still uses the old tax or category' : `${d.oldSetup!.length} classes still use the old tax or category`}</p>
              <p className="adm-small adm-muted">The register rings them with the old one until they’re updated. Nothing about anyone’s booking changes.</p>
              <button type="button" className="adm-btn is-pri" disabled={!!updating || !!busy} onClick={updateAll}>
                {updating ? `Updating… ${updating.done} done` : 'Update them all'}
              </button>
              {updateError && <p className="adm-error" role="alert">{updateError}</p>}
              <ul className="adm-plain">
                {d.oldSetup!.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="adm-mrow" onClick={() => open({ kind: 'class', id: c.id }, { back: { kind: 'more', page: 'register' }, label: 'Register setup' })}>
                      <span className="adm-rm"><b>{c.name}</b><small>{c.startIso ? dayLabel(localDate(c.startIso)) : ''}</small></span>
                      <span className="adm-chev" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.notOnRegister.length > 0 && (
            <section aria-label="Not on the register yet" className="adm-gap-top">
              <p className="adm-lbl">{`Not on the register yet (${d.notOnRegister.length})`}</p>
              <p className="adm-small adm-muted">These can’t be booked online until they are. Open each one and tap Put it on the register.</p>
              <ul className="adm-plain">
                {d.notOnRegister.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="adm-mrow" onClick={() => open({ kind: 'class', id: c.id }, { back: { kind: 'more', page: 'register' }, label: 'Register setup' })}>
                      <span className="adm-rm"><b>{c.name}</b><small>{c.startIso ? dayLabel(localDate(c.startIso)) : ''}</small></span>
                      <span className="adm-chev" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {last && <p className="adm-small adm-muted adm-gap-top">{`Last changed by ${last.by.name}, ${dayLabel(localDate(last.at))}.`}</p>}
          {!last && d.setup.source.tax === 'site' && <p className="adm-small adm-muted adm-gap-top">Using the studio’s starting setup. Save here to make it yours.</p>}
        </>
      )}
      <ReaderSetting />
    </SheetFrame>
  )
}

/**
 * Stage 4: Charge on the reader, on or off (Catherine flips it here, not in
 * Netlify). Saved at once, compare-and-set; the other ways to pay at the door
 * stay whatever this says.
 */
function ReaderSetting() {
  const toast = useToast()
  const [s, setS] = useState<ReaderStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    api<ReaderStatus>(READER_SETTING).then((r) => {
      if (!live) return
      if (r.ok && r.data) { setS(r.data); setError('') } else setError(r.error ?? DIDNT_SAVE)
    })
    return () => { live = false }
  }, [tries])
  async function flip() {
    if (!s) return
    setBusy(true)
    const r = await api<ReaderStatus>(READER_SETTING, { enabled: !s.on, expectedUpdatedAt: s.updatedAt })
    setBusy(false)
    if (r.ok && r.data) {
      setS(r.data)
      toast(r.data.on ? 'Charge on the reader is on. It shows in Sell a seat on /staff.' : 'Charge on the reader is off.')
      return
    }
    if (r.status === 409) setTries((n) => n + 1)
    setError(r.error ?? DIDNT_SAVE)
  }
  return (
    <section aria-label="Charge on the reader" className="adm-gap-top">
      <p className="adm-lbl">Charge on the reader</p>
      <p className="adm-small adm-muted">Adds Charge on the reader to Sell a seat on /staff. It opens the Square app on the iPad with the amount, then comes back here once the card is paid. Card and gift card only. Cash stays Pay at the counter.</p>
      {!s && !error && <Skeleton rows={1} label="Loading" />}
      {s && (
        <>
          <p className="adm-small"><b>{s.on ? 'On' : 'Off'}</b>{s.by && s.updatedAt ? ` · changed by ${s.by.name}, ${dayLabel(localDate(s.updatedAt))}` : ''}</p>
          {s.on && !s.linked && <p className="adm-warntext" role="note">{s.message}</p>}
          <button type="button" className={`adm-btn ${s.on ? 'is-ghost' : 'is-pri'} is-sm`} disabled={busy} onClick={flip}>
            {busy ? 'Saving…' : s.on ? 'Turn it off' : 'Turn it on'}
          </button>
        </>
      )}
      {error && <p className="adm-error" role="alert">{error}</p>}
      {error && !s && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => { setError(''); setTries((n) => n + 1) }}>Try again</button>}
    </section>
  )
}
