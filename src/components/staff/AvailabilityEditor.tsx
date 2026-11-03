import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { btn, card, field } from '@components/staff/ui'
import { useStaffNav } from '@components/staff/nav'
import { CONFIG_STUDIO_WEEKLY, type CafeWeekly, type Weekday } from '@config/hours'
import { addDays } from '@lib/kit-dates'
import { formatCalendarDay, studioDate } from '@lib/studio-time'
import { MAX_MARKS_PER_DAY, MAX_NOTE } from '@lib/staffing/rules'
import type { Availability, DayMark } from '@lib/staffing/types'
import { ownersAnd, oneOwner } from '@lib/owner-names-client'

/**
 * "When I can work" on My shifts (stage 3, OWNER-1): a usual week of the
 * studio's open days (Can / Can't / Not said, all day or only some hours),
 * then "Different on a date" for one-off changes. Built for a phone: big
 * buttons, words on every state (never colour alone), one Save button with
 * a plain "Saved." after. Owners see exactly this on their Staff screens.
 *
 * Unsaved work is never lost without a word: a sticky "Unsaved changes" bar
 * with Save and Discard (Discard can be undone); leaving My shifts with
 * unsaved times asks in the app first (StaffConsole's leave guard); a date
 * picked in "Different on a date" but not added yet is added by Save.
 */

const WEEKDAYS: Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PLURAL: Record<Weekday, string> = {
  Sunday: 'Sundays', Monday: 'Mondays', Tuesday: 'Tuesdays', Wednesday: 'Wednesdays', Thursday: 'Thursdays', Friday: 'Fridays', Saturday: 'Saturdays',
}

/** The studio's open days, Monday-first, with their hours: the studio hours in force (the owners' on /admin; the config's by default). */
export function openDays(studio: CafeWeekly[] = CONFIG_STUDIO_WEEKLY): { index: string; name: Weekday; opens: string; closes: string }[] {
  const out = new Map<string, { index: string; name: Weekday; opens: string; closes: string }>()
  for (const h of studio) {
    const index = String(WEEKDAYS.indexOf(h.weekday))
    if (!out.has(index)) out.set(index, { index, name: h.weekday, opens: h.opens, closes: h.closes })
  }
  return [...out.values()].sort((a, b) => ((Number(a.index) + 6) % 7) - ((Number(b.index) + 6) % 7))
}

/** "9 AM", "9:30 AM", "12 PM", "Midnight". */
export function clockLabel(hhmm: string): string {
  if (hhmm === '24:00' || hhmm === '00:00') return 'Midnight'
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`
}

const pad = (n: number) => String(n).padStart(2, '0')
/** Half hours from 7 AM; starts end at 11:30 PM, ends run to midnight. */
const FROM_TIMES = Array.from({ length: 34 }, (_, i) => `${pad(7 + Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`)
const TO_TIMES = [...FROM_TIMES.slice(1), '24:00']

/** "All day" or "9 AM to 12 PM", in words. */
export function markWhen(m: DayMark): string {
  return m.range ? `${clockLabel(m.range.from)} to ${clockLabel(m.range.to)}` : 'All day'
}
const kindWord = (k: DayMark['kind']) => (k === 'can' ? 'Can work' : 'Can’t work')

type Status = { tone: 'ok' | 'info' | 'error'; text: string } | null

const seg = (on: boolean, tone: 'can' | 'cant' | 'none'): CSSProperties => ({
  ...btn(on),
  flex: '1 1 0',
  minWidth: '5.5rem',
  minHeight: '3rem',
  fontSize: '1rem',
  ...(on && tone === 'cant' ? { background: '#92400e' } : {}),
  ...(on && tone === 'none' ? { background: '#4b5563' } : {}),
})

const label: CSSProperties = { display: 'grid', gap: '0.3rem', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-dark)' }
const select: CSSProperties = { ...field, minHeight: '2.75rem', width: '100%', background: '#fff' }

function TimeRangePicker({ from, to, onChange, idBase }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void; idBase: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.6rem' }}>
      <label style={label} htmlFor={`${idBase}-from`}>
        From
        <select id={`${idBase}-from`} value={from} onChange={(e) => onChange({ from: e.target.value, to })} style={select}>
          {FROM_TIMES.map((t) => <option key={t} value={t}>{clockLabel(t)}</option>)}
        </select>
      </label>
      <label style={label} htmlFor={`${idBase}-to`}>
        To
        <select id={`${idBase}-to`} value={to} onChange={(e) => onChange({ from, to: e.target.value })} style={select}>
          {TO_TIMES.map((t) => <option key={t} value={t}>{clockLabel(t)}</option>)}
        </select>
      </label>
    </div>
  )
}

function KindButtons({ value, onChange, name, allowNone }: { value: DayMark['kind'] | null; onChange: (k: DayMark['kind'] | null) => void; name: string; allowNone: boolean }) {
  return (
    <div role="group" aria-label={name} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      <button type="button" aria-pressed={value === 'can'} onClick={() => onChange('can')} style={seg(value === 'can', 'can')}>
        {value === 'can' ? '✓ ' : ''}Can
      </button>
      <button type="button" aria-pressed={value === 'cant'} onClick={() => onChange('cant')} style={seg(value === 'cant', 'cant')}>
        {value === 'cant' ? '✕ ' : ''}Can’t
      </button>
      {allowNone && (
        <button type="button" aria-pressed={value === null} onClick={() => onChange(null)} style={seg(value === null, 'none')}>
          Not said
        </button>
      )}
    </div>
  )
}

const sameTimes = (a: Pick<Availability, 'weekly' | 'dates'>, b: Pick<Availability, 'weekly' | 'dates'>) =>
  JSON.stringify([a.weekly, a.dates]) === JSON.stringify([b.weekly, b.dates])

export default function AvailabilityEditor({ initial, onSaved, studioHours }: { initial: Availability; onSaved?: (a: Availability) => void; studioHours?: CafeWeekly[] }) {
  const today = studioDate(new Date().toISOString())
  const days = useMemo(() => openDays(studioHours), [studioHours])
  const ids = useId()
  const nav = useStaffNav()
  const [base, setBase] = useState<Availability>(initial)
  const [weekly, setWeekly] = useState<Record<string, DayMark | null>>(initial.weekly)
  const [dates, setDates] = useState<Record<string, DayMark[]>>(initial.dates)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  /** What Discard threw away, for Undo. */
  const [discarded, setDiscarded] = useState<{ weekly: Record<string, DayMark | null>; dates: Record<string, DayMark[]> } | null>(null)

  // The "different on a date" form.
  const [newDate, setNewDate] = useState('')
  const [newKind, setNewKind] = useState<DayMark['kind'] | null>('cant')
  const [newSome, setNewSome] = useState(false)
  const [newRange, setNewRange] = useState({ from: '09:00', to: '12:00' })
  const [newNote, setNewNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const timesChanged = !sameTimes({ weekly, dates }, base)
  // A date picked below but not added yet counts as a change too: Save adds it.
  const pendingDate = newDate !== ''
  const dirty = timesChanged || pendingDate

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  // A fresh load from the server (another device saved) replaces what's shown when nothing is being edited.
  // Only on a real change: never on first show (a tap before the first effects ran must not be undone).
  const lastInitial = useRef(initial.updatedAt)
  useEffect(() => {
    if (lastInitial.current === initial.updatedAt) return
    lastInitial.current = initial.updatedAt
    if (!dirtyRef.current) { setBase(initial); setWeekly(initial.weekly); setDates(initial.dates) }
  }, [initial.updatedAt])

  /** A usual-week day whose "To" isn't after its "From". */
  const badDay = days.find((d) => { const r = weekly[d.index]?.range; return !!r && r.to <= r.from })

  function setDay(index: string, mark: DayMark | null) {
    setWeekly((w) => ({ ...w, [index]: mark }))
    setStatus(null)
    setDiscarded(null)
  }

  /** The filled-in date form as a mark, or the sentence that says what's wrong (also shown by the form). */
  function formMark(): { day: string; mark: DayMark } | { error: string } {
    if (!newDate) return { error: 'Pick a date.' }
    if (newDate < today) return { error: 'Pick today or a later date.' }
    if (newDate > addDays(today, 365)) return { error: 'Pick a date within the next year.' }
    if (!newKind) return { error: "Pick Can or Can't." }
    if (newSome && newRange.to <= newRange.from) return { error: 'Pick an end time after the start.' }
    if ((dates[newDate] ?? []).length >= MAX_MARKS_PER_DAY) return { error: 'Up to 4 times on one day.' }
    return { day: newDate, mark: { kind: newKind, range: newSome ? newRange : null, note: newNote.trim() } }
  }

  function clearForm() {
    setNewDate('')
    setNewNote('')
    setFormError(null)
  }

  function addDate() {
    setFormError(null)
    const got = formMark()
    if ('error' in got) { setFormError(got.error); return }
    setDates((d) => ({ ...d, [got.day]: [...(d[got.day] ?? []), got.mark] }))
    clearForm()
    setStatus(null)
    setDiscarded(null)
  }

  function removeMark(day: string, i: number) {
    setDates((d) => {
      const list = (d[day] ?? []).filter((_, j) => j !== i)
      const next = { ...d }
      if (list.length) next[day] = list
      else delete next[day]
      return next
    })
    setStatus(null)
    setDiscarded(null)
  }

  /** Back to what's saved (the date form too). Undo puts the changes back. */
  function discard() {
    if (timesChanged) setDiscarded({ weekly, dates })
    setWeekly(base.weekly)
    setDates(base.dates)
    clearForm()
    setStatus(timesChanged ? { tone: 'info', text: 'Changes discarded. Your saved times are back.' } : null)
  }

  function undoDiscard() {
    if (!discarded) return
    setWeekly(discarded.weekly)
    setDates(discarded.dates)
    setDiscarded(null)
    setStatus(null)
  }

  /** Saves; true when it worked (the leave guard then lets the person go on). */
  async function save(): Promise<boolean> {
    setDiscarded(null)
    if (badDay) { setStatus({ tone: 'error', text: `Check ${PLURAL[badDay.name]}: pick an end time after the start.` }); return false }
    let toSend = dates
    if (pendingDate) {
      const got = formMark()
      if ('error' in got) { setFormError(got.error); setStatus({ tone: 'error', text: 'Check the date below first. Add it, fix it, or tap Discard.' }); return false }
      toSend = { ...dates, [got.day]: [...(dates[got.day] ?? []), got.mark] }
    }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/staff/shifts.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'availability', weekly, dates: toSend, expectedUpdatedAt: base.updatedAt }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 409 && json?.current) {
        // Someone saved on another device: show what's saved now, and say so.
        const cur = json.current as Availability
        setBase(cur); setWeekly(cur.weekly); setDates(cur.dates)
        setStatus({ tone: 'error', text: json.error ?? 'Someone changed your times on another device. Here they are.' })
        return false
      }
      if (!res.ok) { setStatus({ tone: 'error', text: json?.error ?? 'Couldn’t save your times. Try again.' }); return false }
      const saved = json.data.availability as Availability
      setBase(saved); setWeekly(saved.weekly); setDates(saved.dates)
      clearForm()
      setStatus({ tone: 'ok', text: `Saved. ${ownersAnd()} can see this now.` })
      onSaved?.(saved)
      return true
    } catch {
      setStatus({ tone: 'error', text: 'Couldn’t reach the studio server. Check wifi and try again.' })
      return false
    } finally {
      setSaving(false)
    }
  }

  // Leaving My shifts with unsaved times asks first (StaffConsole shows the question in the app).
  const saveRef = useRef(save)
  saveRef.current = save
  const discardRef = useRef(discard)
  discardRef.current = discard
  useEffect(() => {
    const set = nav?.setLeaveGuard
    if (!set) return
    set({ dirty: () => dirtyRef.current, save: () => saveRef.current(), discard: () => discardRef.current() })
    return () => set(null)
  }, [])

  const upcomingDates = Object.keys(dates).filter((d) => d >= today).sort()

  return (
    <div>
      <p style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: 'var(--color-muted)', lineHeight: 1.45 }}>
        Your usual week first. Then add any dates that are different. {ownersAnd()} {oneOwner() ? 'uses' : 'use'} this when they put people on.
      </p>

      <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', color: 'var(--color-dark)' }}>My usual week</h3>
      {days.map((d) => {
        const mark = weekly[d.index] ?? null
        const someHours = !!mark?.range
        return (
          <fieldset key={d.index} style={{ ...card, background: 'rgba(255,255,255,0.85)', margin: '0 0 0.6rem', display: 'grid', gap: '0.6rem' }}>
            <legend style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--color-dark)', padding: 0 }}>{PLURAL[d.name]}</legend>
            <KindButtons
              name={`Can you work ${PLURAL[d.name]}?`}
              value={mark?.kind ?? null}
              allowNone
              onChange={(k) => setDay(d.index, k ? { kind: k, range: mark?.range ?? null, note: mark?.note ?? '' } : null)}
            />
            {mark && (
              <>
                <div role="group" aria-label={`${PLURAL[d.name]} hours`} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <button type="button" aria-pressed={!someHours} onClick={() => setDay(d.index, { ...mark, range: null })} style={seg(!someHours, 'can')}>All day</button>
                  <button
                    type="button"
                    aria-pressed={someHours}
                    onClick={() => setDay(d.index, { ...mark, range: mark.range ?? { from: d.opens, to: d.closes === '00:00' ? '24:00' : d.closes } })}
                    style={seg(someHours, 'can')}
                  >
                    Only some hours
                  </button>
                </div>
                {mark.range && (
                  <TimeRangePicker idBase={`${ids}-w${d.index}`} from={mark.range.from} to={mark.range.to} onChange={(r) => setDay(d.index, { ...mark, range: r })} />
                )}
                {mark.range && mark.range.to <= mark.range.from && (
                  <p role="alert" style={{ margin: 0, color: 'var(--color-error)', fontWeight: 600 }}>Pick an end time after the start.</p>
                )}
              </>
            )}
          </fieldset>
        )
      })}

      <h3 style={{ margin: '1.1rem 0 0.35rem', fontSize: '1rem', color: 'var(--color-dark)' }}>Different on a date</h3>
      <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: 'var(--color-muted)' }}>A date here replaces your usual week for that whole day.</p>
      {upcomingDates.length === 0 && <p style={{ margin: '0 0 0.6rem', fontSize: '0.95rem', color: 'var(--color-dark)' }}>No dates added.</p>}
      <ul style={{ listStyle: 'none', margin: '0 0 0.6rem', padding: 0, display: 'grid', gap: '0.4rem' }}>
        {upcomingDates.flatMap((day) => (dates[day] ?? []).map((m, i) => (
          <li key={`${day}-${i}`} data-testid="date-mark" style={{ ...card, background: 'rgba(255,255,255,0.85)', margin: 0, display: 'flex', gap: '0.6rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span style={{ display: 'grid', gap: '0.15rem' }}>
              <strong style={{ color: 'var(--color-dark)' }}>{formatCalendarDay(day)}</strong>
              <span style={{ color: m.kind === 'cant' ? '#92400e' : 'var(--color-dark)', fontWeight: 600 }}>{`${kindWord(m.kind)} · ${markWhen(m)}`}</span>
              {m.note && <span style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>{m.note}</span>}
            </span>
            <button type="button" onClick={() => removeMark(day, i)} aria-label={`Remove ${formatCalendarDay(day)}, ${kindWord(m.kind)}, ${markWhen(m)}`} style={btn()}>Remove</button>
          </li>
        )))}
      </ul>

      <div style={{ ...card, background: 'rgba(var(--color-primary-rgb),0.04)', display: 'grid', gap: '0.7rem' }}>
        <label style={label} htmlFor={`${ids}-date`}>
          Date
          <input id={`${ids}-date`} type="date" value={newDate} min={today} max={addDays(today, 365)} onChange={(e) => setNewDate(e.target.value)} style={{ ...field, minHeight: '2.75rem', width: '100%' }} />
        </label>
        <KindButtons name="Can or can't on that date" value={newKind} allowNone={false} onChange={setNewKind} />
        <div role="group" aria-label="Hours on that date" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button type="button" aria-pressed={!newSome} onClick={() => setNewSome(false)} style={seg(!newSome, 'can')}>All day</button>
          <button type="button" aria-pressed={newSome} onClick={() => setNewSome(true)} style={seg(newSome, 'can')}>Only some hours</button>
        </div>
        {newSome && <TimeRangePicker idBase={`${ids}-new`} from={newRange.from} to={newRange.to} onChange={setNewRange} />}
        <label style={label} htmlFor={`${ids}-note`}>
          Note (optional)
          <input id={`${ids}-note`} type="text" value={newNote} maxLength={MAX_NOTE} placeholder="Like “dentist” or “after 5 only”" onChange={(e) => setNewNote(e.target.value)} style={{ ...field, minHeight: '2.75rem', width: '100%' }} />
        </label>
        {formError && <p role="alert" style={{ margin: 0, color: 'var(--color-error)', fontWeight: 600 }}>{formError}</p>}
        <button type="button" onClick={addDate} style={{ ...btn(), minHeight: '3rem', fontSize: '1rem' }}>+ Add this date</button>
      </div>

      <div style={{ position: 'sticky', bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))', background: 'var(--color-surface, #fff)', padding: '0.6rem 0', display: 'grid', gap: '0.4rem', zIndex: 5 }}>
        {dirty && (
          <div data-testid="unsaved-bar" style={{ display: 'grid', gap: '0.35rem', padding: '0.55rem 0.7rem', borderRadius: '0.75rem', background: '#fef3c7', border: '1px solid #f59e0b' }}>
            <strong style={{ fontSize: '0.95rem', color: '#92400e' }}>Unsaved changes</strong>
            {pendingDate && <span style={{ fontSize: '0.9rem', color: '#92400e' }}>The date you picked below gets added when you save.</span>}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" onClick={() => { void save() }} disabled={!dirty || saving} style={{ ...btn(true), flex: '2 1 0', minHeight: '3.25rem', fontSize: '1.05rem', opacity: !dirty || saving ? 0.55 : 1 }}>
            {saving ? 'Saving…' : 'Save my times'}
          </button>
          {dirty && !saving && (
            <button type="button" onClick={discard} style={{ ...btn(), flex: '1 1 0', minHeight: '3.25rem', fontSize: '1rem' }}>Discard</button>
          )}
        </div>
        <p role="status" aria-live="polite" style={{ margin: 0, minHeight: '1.3rem', fontSize: '0.95rem', fontWeight: 600, color: status?.tone === 'error' ? 'var(--color-error)' : status?.tone === 'ok' ? '#15803d' : 'var(--color-muted)' }}>
          {status ? `${status.tone === 'ok' ? '✓ ' : ''}${status.text}` : dirty ? 'Unsaved changes. Tap Save my times to keep them.' : ''}
        </p>
        {discarded && (
          <button type="button" onClick={undoDiscard} style={{ ...btn(), minHeight: '2.75rem' }}>Undo</button>
        )}
      </div>
    </div>
  )
}
