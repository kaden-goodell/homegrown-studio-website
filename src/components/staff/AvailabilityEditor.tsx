import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { btn, card, field } from '@components/staff/ui'
import { STUDIO_HOURS, type Weekday } from '@config/hours'
import { addDays } from '@lib/kit-dates'
import { formatCalendarDay, studioDate } from '@lib/studio-time'
import { MAX_MARKS_PER_DAY, MAX_NOTE } from '@lib/staffing/rules'
import type { Availability, DayMark } from '@lib/staffing/types'

/**
 * "When I can work" on My shifts (stage 3, OWNER-1): a usual week of the
 * studio's open days (Can / Can't / Not said, all day or only some hours),
 * then "Different on a date" for one-off changes. Built for a phone: big
 * buttons, words on every state (never colour alone), one Save button with
 * a plain "Saved." after. Owners see exactly this on their Staff screens.
 */

const WEEKDAYS: Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PLURAL: Record<Weekday, string> = {
  Sunday: 'Sundays', Monday: 'Mondays', Tuesday: 'Tuesdays', Wednesday: 'Wednesdays', Thursday: 'Thursdays', Friday: 'Fridays', Saturday: 'Saturdays',
}

/** The studio's open days, Monday-first (Thu, Fri, Sat, Sun today), with their hours. */
export function openDays(): { index: string; name: Weekday; opens: string; closes: string }[] {
  const out = new Map<string, { index: string; name: Weekday; opens: string; closes: string }>()
  for (const h of STUDIO_HOURS) {
    for (const d of h.days) {
      const index = String(WEEKDAYS.indexOf(d))
      if (!out.has(index)) out.set(index, { index, name: d, opens: h.opens, closes: h.closes })
    }
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

export default function AvailabilityEditor({ initial, onSaved }: { initial: Availability; onSaved?: (a: Availability) => void }) {
  const today = studioDate(new Date().toISOString())
  const days = useMemo(openDays, [])
  const ids = useId()
  const [base, setBase] = useState<Availability>(initial)
  const [weekly, setWeekly] = useState<Record<string, DayMark | null>>(initial.weekly)
  const [dates, setDates] = useState<Record<string, DayMark[]>>(initial.dates)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  // A fresh load from the server (another device saved) replaces what's shown when nothing is being edited.
  useEffect(() => {
    if (sameTimes({ weekly, dates }, base)) { setBase(initial); setWeekly(initial.weekly); setDates(initial.dates) }
  }, [initial.updatedAt])

  const dirty = !sameTimes({ weekly, dates }, base)

  // The "different on a date" form.
  const [newDate, setNewDate] = useState('')
  const [newKind, setNewKind] = useState<DayMark['kind'] | null>('cant')
  const [newSome, setNewSome] = useState(false)
  const [newRange, setNewRange] = useState({ from: '09:00', to: '12:00' })
  const [newNote, setNewNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function setDay(index: string, mark: DayMark | null) {
    setWeekly((w) => ({ ...w, [index]: mark }))
    setStatus(null)
  }

  function addDate() {
    setFormError(null)
    if (!newDate) { setFormError('Pick a date.'); return }
    if (newDate < today) { setFormError('Pick today or a later date.'); return }
    if (newDate > addDays(today, 365)) { setFormError('Pick a date within the next year.'); return }
    if (!newKind) { setFormError("Pick Can or Can't."); return }
    if (newSome && newRange.to <= newRange.from) { setFormError('Pick an end time after the start.'); return }
    const list = dates[newDate] ?? []
    if (list.length >= MAX_MARKS_PER_DAY) { setFormError('Up to 4 times on one day.'); return }
    const mark: DayMark = { kind: newKind, range: newSome ? newRange : null, note: newNote.trim() }
    setDates((d) => ({ ...d, [newDate]: [...list, mark] }))
    setNewDate('')
    setNewNote('')
    setStatus(null)
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
  }

  async function save() {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/staff/shifts.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'availability', weekly, dates, expectedUpdatedAt: base.updatedAt }),
      })
      const json = await res.json().catch(() => null)
      if (res.status === 409 && json?.current) {
        // Someone saved on another device: show what's saved now, and say so.
        const cur = json.current as Availability
        setBase(cur); setWeekly(cur.weekly); setDates(cur.dates)
        setStatus({ tone: 'error', text: json.error ?? 'Someone changed your times on another device. Here they are.' })
        return
      }
      if (!res.ok) { setStatus({ tone: 'error', text: json?.error ?? 'Couldn’t save your times. Try again.' }); return }
      const saved = json.data.availability as Availability
      setBase(saved); setWeekly(saved.weekly); setDates(saved.dates)
      setStatus({ tone: 'ok', text: 'Saved. Catherine and Kaden can see this now.' })
      onSaved?.(saved)
    } catch {
      setStatus({ tone: 'error', text: 'Couldn’t reach the studio server. Check wifi and try again.' })
    } finally {
      setSaving(false)
    }
  }

  const upcomingDates = Object.keys(dates).filter((d) => d >= today).sort()

  return (
    <div>
      <p style={{ margin: '0 0 0.9rem', fontSize: '0.95rem', color: 'var(--color-muted)', lineHeight: 1.45 }}>
        Your usual week first. Then add any dates that are different. Catherine and Kaden use this when they put people on.
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
        <button type="button" onClick={save} disabled={!dirty || saving} style={{ ...btn(true), minHeight: '3.25rem', fontSize: '1.05rem', opacity: !dirty || saving ? 0.55 : 1 }}>
          {saving ? 'Saving…' : 'Save my times'}
        </button>
        <p role="status" aria-live="polite" style={{ margin: 0, minHeight: '1.3rem', fontSize: '0.95rem', fontWeight: 600, color: status?.tone === 'error' ? 'var(--color-error)' : status?.tone === 'ok' ? '#15803d' : 'var(--color-muted)' }}>
          {status ? `${status.tone === 'ok' ? '✓ ' : ''}${status.text}` : dirty ? 'You have changes that aren’t saved yet.' : ''}
        </p>
      </div>
    </div>
  )
}
