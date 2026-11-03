/**
 * "Repeat" on New class and Run it again (stage 4): Doesn't repeat / Every
 * week / Every 2 weeks / Pick dates, an "Until" day, and a list of the dates
 * it adds, each ticked or with the plain reason it's skipped (closed, a
 * clash, passed). Unticking a date leaves it out. The server works the dates
 * out (repeat-preview), so the list is exactly what Add will try.
 */
import { useEffect, useState } from 'react'
import type { Session } from '@lib/classes/types'
import type { RepeatPattern } from '@lib/classes/repeat'
import { addDays, dayLabel, today } from './dates'
import { api, CLASSES } from './api'
import { Seg } from '../shell/items'

export type RepeatKind = 'none' | 'week' | 'two' | 'pick'
export interface Repeat { kind: RepeatKind; until: string; picked: string[]; off: string[] }
export interface RepeatDate { ymd: string; ok: boolean; reason: string | null }

export const NO_REPEAT: Repeat = { kind: 'none', until: '', picked: [], off: [] }

export function patternOf(r: Repeat): RepeatPattern | null {
  if (r.kind === 'week' || r.kind === 'two') return r.until ? { every: r.kind === 'week' ? 1 : 2, untilYmd: r.until } : null
  if (r.kind === 'pick') return { dates: r.picked.filter(Boolean) }
  return null
}

/** The dates Add will make: ticked and not skipped. */
export const tickedDates = (r: Repeat, dates: RepeatDate[] | null) => (dates ?? []).filter((d) => d.ok && !r.off.includes(d.ymd))

/** The server's list for this pattern, fetched a moment after the last change. */
export function useRepeatPreview(r: Repeat, sessions: Session[] | null, body: { content?: unknown; libraryId?: string | null }) {
  const pattern = patternOf(r)
  const key = JSON.stringify([pattern, sessions?.map((s) => [s.startIso, s.endIso]), (body.content as any)?.rules?.canShareRoom ?? null, body.libraryId ?? null])
  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{ key: string; dates: RepeatDate[] | null; error: string }>({ key: '', dates: null, error: '' })
  useEffect(() => {
    if (r.kind === 'none' || !pattern || !sessions?.length) return
    let live = true
    const t = setTimeout(async () => {
      const res = await api<{ dates: RepeatDate[] }>(CLASSES, {
        action: 'repeat-preview', sessions, pattern,
        ...(body.content ? { content: body.content } : {}),
        ...(body.libraryId ? { libraryId: body.libraryId } : {}),
      })
      if (!live) return
      setState(res.ok && res.data ? { key, dates: res.data.dates, error: '' } : { key, dates: null, error: res.error ?? 'The dates couldn’t be checked. Try again.' })
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [key, nonce])
  const fresh = state.key === key
  /** M4: ask again after "The dates couldn't be checked." */
  const retry = () => { setState((cur) => ({ ...cur, key: '' })); setNonce((n) => n + 1) }
  return { dates: fresh ? state.dates : null, error: fresh ? state.error : '', checking: r.kind !== 'none' && !!pattern && !!sessions?.length && !fresh, retry }
}

export default function RepeatSection({ value, onChange, firstDay, multi, preview, error, earlyBirdUntil }: {
  value: Repeat
  onChange: (r: Repeat) => void
  /** The first date's day (YYYY-MM-DD), or '' while the dates aren't filled in. */
  firstDay: string
  /** More than one date: the picked days are when the first one runs. */
  multi: boolean
  preview: { dates: RepeatDate[] | null; error: string; checking: boolean; retry?: () => void }
  /** A refusal about the repeat from Add. */
  error?: string
  /** The early-bird's last day on the first date (M6), when it has one: each date gets it the same days before. */
  earlyBirdUntil?: string
}) {
  const set = (patch: Partial<Repeat>) => onChange({ ...value, ...patch })
  function choose(kind: RepeatKind) {
    const base = firstDay || addDays(today(), 7)
    if (kind === 'week' || kind === 'two') {
      // Six classes to start: five more after the first.
      const until = value.until && value.until > base ? value.until : addDays(base, (kind === 'week' ? 7 : 14) * 5)
      set({ kind, until })
    } else if (kind === 'pick') set({ kind, picked: value.picked.length ? value.picked : [addDays(base, 7)] })
    else set({ kind })
  }
  const toggle = (ymd: string) => set({ off: value.off.includes(ymd) ? value.off.filter((d) => d !== ymd) : [...value.off, ymd] })
  const ticked = tickedDates(value, preview.dates).length

  return (
    <fieldset className="adm-repeat" data-field="repeat">
      <legend>Repeat</legend>
      <Seg label="How it repeats" className="is-wrap" value={value.kind} onChange={choose} options={[['none', 'Doesn’t repeat'], ['week', 'Every week'], ['two', 'Every 2 weeks'], ['pick', 'Pick dates']]} />
      {(value.kind === 'week' || value.kind === 'two') && (
        <label className="adm-fld"><span>Until</span><input type="date" value={value.until} min={firstDay ? addDays(firstDay, 1) : undefined} onChange={(e) => set({ until: e.target.value })} /></label>
      )}
      {value.kind === 'pick' && (
        <div className="adm-repeat-picks">
          {value.picked.map((d, i) => (
            <div key={i} className="adm-two">
              <label className="adm-fld"><span>Also on</span><input type="date" value={d} onChange={(e) => set({ picked: value.picked.map((x, n) => (n === i ? e.target.value : x)) })} /></label>
              <button type="button" className="adm-btn is-ghost is-sm" aria-label={d ? `Remove ${dayLabel(d)}` : 'Remove this date'} onClick={() => set({ picked: value.picked.filter((_, n) => n !== i) })}>Remove</button>
            </div>
          ))}
          <button type="button" className="adm-btn is-ghost" onClick={() => set({ picked: [...value.picked, addDays(value.picked[value.picked.length - 1] || firstDay || today(), 7)] })}>+ Add a date</button>
          {multi && <p className="adm-small adm-muted">Pick the day the first date runs. The other dates move with it.</p>}
        </div>
      )}
      {value.kind !== 'none' && (
        <div className="adm-repeat-list">
          <p className="adm-small adm-muted" aria-live="polite">
            {!firstDay ? 'Fill in the dates above to see the list.' : preview.checking ? 'Checking the dates…' : preview.dates ? `${ticked} ${ticked === 1 ? 'class' : 'classes'}, each one its own class on the calendar and the register, kept together as one series: later you can change or cancel one date or all of them. Untick a date to leave it out.` : ''}
          </p>
          {earlyBirdUntil && firstDay && preview.dates && (() => {
            const days = Math.round((Date.parse(`${firstDay}T12:00:00Z`) - Date.parse(`${earlyBirdUntil}T12:00:00Z`)) / 86_400_000)
            return days >= 0 ? <p className="adm-small adm-muted" data-testid="repeat-early-bird">{days === 0 ? 'Early-bird: each date’s ends on that date.' : `Early-bird: each date’s ends ${days} ${days === 1 ? 'day' : 'days'} before that date, like the first one’s.`}</p> : null
          })()}
          {preview.error && <p role="alert" className="adm-error">{preview.error}</p>}
          {preview.error && preview.retry && <button type="button" className="adm-btn is-ghost is-sm" onClick={preview.retry}>Check again</button>}
          {error && <p role="alert" className="adm-error adm-fielderr">{error}</p>}
          {preview.dates && (
            <ul className="adm-repeat-dates" aria-label="Dates it adds">
              {preview.dates.map((d) => (
                <li key={d.ymd}>
                  <label className="adm-check">
                    <input type="checkbox" checked={d.ok && !value.off.includes(d.ymd)} disabled={!d.ok} onChange={() => toggle(d.ymd)} />
                    <span>
                      <b>{dayLabel(d.ymd)}</b>{' '}
                      {d.ok ? <span aria-hidden="true">✓</span> : <span className="adm-small adm-warntext">{`Skipped. ${d.reason}`}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  )
}
