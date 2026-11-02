/**
 * More › Parties setup (`#more-parties`): when parties can start, how far
 * ahead people book online, the packages, the extras, the party crafts (from
 * Square, read only) and whether parties still booked in Square are counted.
 *
 * One Save for the whole page, sent with the time it was loaded (a save made
 * elsewhere in between is never written over: "Someone else saved Parties
 * setup. Reload to see their changes."). Saving never touches a party already
 * booked: the reply lists parties on times the save took away, and they stay
 * booked.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PartyAddOn, PartyPackage, PartySettings, PartySettingsInput, WeekdayKey } from '@lib/parties/types'
import { formatMoney } from '@lib/money'
import { localDate } from '@lib/party-slots'
import { api } from '../classes/api'
import { dayLabel, today } from '../classes/dates'
import { useRefresh } from '../shell/data'
import { Failed, Seg, Skeleton } from '../shell/items'
import { SheetFrame, useSheet, useSheetDirty } from '../shell/Sheet'
import { clock, dayAndClock } from '../shell/time'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { newKey, PARTY_SETTINGS, useCrafts, usePartySettings, type LegacyRemaining } from './api'

const WEEK: [WeekdayKey, string][] = [['1', 'Mondays'], ['2', 'Tuesdays'], ['3', 'Wednesdays'], ['4', 'Thursdays'], ['5', 'Fridays'], ['6', 'Saturdays'], ['0', 'Sundays']]
const WHO: [PartyPackage['who'], string][] = [['everyone', 'Everyone'], ['link', 'Only with the link'], ['admin', 'Only from here']]
const WHO_NOTE: Record<PartyPackage['who'], string> = {
  everyone: 'Anyone can book it on the website.',
  link: 'Only someone you send the link to can book it online.',
  admin: 'Only you can book it, from here.',
}
const EXTRA_MINUTES = [0, 15, 30, 45, 60] as const
export const STALE = 'Someone else saved Parties setup. Reload to see their changes.'
export const SAVED = 'Saved. New bookings use these.'

type Keyed<T> = T & { _k: string }
interface Draft {
  weekly: Record<WeekdayKey, string[]>
  dates: { _k: string; ymd: string; starts: string[] }[]
  bookingWindowDays: number
  minLeadDays: number
  opensDate: string
  packages: Keyed<PartyPackage>[]
  addOns: Keyed<PartyAddOn>[]
  readSquareBookings: boolean
}
interface Booked { partyId: string; hostName: string; startIso: string; label: string }

const keyed = <T,>(x: T): Keyed<T> => ({ ...x, _k: newKey() })

function draftOf(s: PartySettings): Draft {
  return {
    weekly: { ...s.times.weekly },
    dates: Object.entries(s.times.dates).sort(([a], [b]) => a.localeCompare(b)).map(([ymd, starts]) => ({ _k: ymd, ymd, starts: [...starts] })),
    bookingWindowDays: s.times.bookingWindowDays,
    minLeadDays: s.times.minLeadDays,
    opensDate: s.times.opensDate,
    packages: s.packages.map(keyed),
    addOns: s.addOns.map(keyed),
    readSquareBookings: s.readSquareBookings,
  }
}

const strip = <T extends { _k: string }>({ _k, ...rest }: T) => rest
/** What Save sends (and what "changed?" compares). */
function inputOf(d: Draft): PartySettingsInput {
  return {
    times: {
      weekly: Object.fromEntries(WEEK.map(([k]) => [k, [...(d.weekly[k] ?? [])].sort()])) as Draft['weekly'],
      dates: Object.fromEntries(d.dates.filter((x) => x.ymd).map((x) => [x.ymd, [...x.starts].sort()])),
      bookingWindowDays: d.bookingWindowDays,
      minLeadDays: d.minLeadDays,
      opensDate: d.opensDate,
    },
    packages: d.packages.map(strip),
    addOns: d.addOns.map(strip),
    readSquareBookings: d.readSquareBookings,
  }
}

const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v))
const shown = (n: number) => (Number.isFinite(n) ? String(n) : '')
const dollars = (cents: number) => (Number.isFinite(cents) ? String(cents / 100) : '')
const toCents = (v: string) => (v.trim() === '' ? Number.NaN : Math.round(Number(v) * 100))

/** "Fri · 4:30 PM", "Sat · 2 PM, 4:30 PM" for More's row. */
export function partiesSummary(s: PartySettings): string {
  const days = WEEK.filter(([k]) => (s.times.weekly[k] ?? []).length).map(([, n]) => n.slice(0, 3))
  const pkg = s.packages.find((p) => !p.archived && p.who === 'everyone')
  return [days.length ? days.join(', ') : 'No weekly party days', pkg ? `${pkg.name} ${formatMoney(pkg.priceCents)}` : '', pkg ? `${pkg.minGuests}–${pkg.maxGuests} guests` : ''].filter(Boolean).join(' · ')
}

export function PartiesSetupSheet() {
  const party = usePartySettings()
  if (party.error && !party.settings) return <SheetFrame title="Parties setup"><Failed message={party.error} onRetry={party.retry} /></SheetFrame>
  if (!party.settings) return <SheetFrame title="Parties setup"><Skeleton rows={5} label="Loading Parties setup" /></SheetFrame>
  return <SetupForm settings={party.settings} legacy={party.legacy} replace={party.replace} />
}

function SetupForm({ settings, legacy, replace }: { settings: PartySettings; legacy: LegacyRemaining; replace: (s: PartySettings, l?: LegacyRemaining) => void }) {
  const { open } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const [base, setBase] = useState(settings)
  const [d, setD] = useState<Draft>(() => draftOf(settings))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ field: string; text: string } | null>(null)
  const [stale, setStale] = useState<PartySettings | null>(null)
  const [booked, setBooked] = useState<{ list: Booked[]; unknown: boolean } | null>(null)
  const dirty = useMemo(() => JSON.stringify(inputOf(d)) !== JSON.stringify(inputOf(draftOf(base))), [d, base])
  useSheetDirty(dirty)
  const set = (patch: Partial<Draft>) => { setD((cur) => ({ ...cur, ...patch })); setError(null) }

  // A date row with no date is never dropped quietly (m13): Save says to pick it.
  const undated = d.dates.some((x) => !x.ymd)
  async function save() {
    if (busy) return
    if (undated) {
      setError({ field: 'undated-date', text: 'Pick the date for each new date row, or remove the row. Nothing was saved.' })
      return
    }
    setBusy(true)
    setError(null)
    setStale(null)
    const r = await api<{ settings: PartySettings; booked: Booked[]; bookedUnknown?: boolean; note?: string }>(PARTY_SETTINGS, { ...inputOf(d), expectedUpdatedAt: base.updatedAt })
    setBusy(false)
    if (r.ok && r.data) {
      setBase(r.data.settings)
      setD(draftOf(r.data.settings))
      replace(r.data.settings)
      bump()
      const list = r.data.booked ?? []
      setBooked(list.length || r.data.bookedUnknown ? { list, unknown: !!r.data.bookedUnknown } : null)
      toast(list.length ? `${SAVED} ${list.length === 1 ? '1 party' : `${list.length} parties`} already booked on times you took away stay booked.` : SAVED)
      return
    }
    if (r.status === 409 && r.extra.stale) {
      setStale(r.extra.current as PartySettings)
      return
    }
    if (r.extra.legacyRemaining) replace(base, r.extra.legacyRemaining as LegacyRemaining)
    setError({ field: String(r.extra.field ?? ''), text: r.error ?? DIDNT_SAVE })
  }

  function reload() {
    if (!stale) return
    setBase(stale)
    setD(draftOf(stale))
    replace(stale)
    setStale(null)
    setError(null)
  }

  const errAt = (prefix: string) => (error && (error.field === prefix || error.field.startsWith(`${prefix}.`)) ? <p className="adm-error adm-fielderr" role="alert">{error.text}</p> : null)
  const now = today()
  const datesShown = d.dates.filter((x) => !x.ymd || x.ymd >= now)
  const anyEveryone = d.packages.some((p) => !p.archived && p.who === 'everyone')
  const footer = (
    <div className="adm-stack">
      {stale && (
        <div className="adm-panel is-warn" role="alert">
          <b>{STALE}</b>
          <span className="adm-small">Your changes here aren’t saved. Reloading shows theirs; then make yours again.</span>
          <button type="button" className="adm-btn is-ghost is-sm" onClick={reload}>Reload</button>
        </div>
      )}
      {error && <p className="adm-footline" role="alert">{error.text}</p>}
      <button type="button" className="adm-btn is-pri" disabled={(!dirty && !undated) || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  )

  return (
    <SheetFrame tall title="Parties setup" subtitle={partiesSummary(base)} footer={footer}>
      {booked && (
        <div className="adm-panel is-warn adm-gap-bottom" role="status">
          <b>Anything already booked stays booked.</b>
          {booked.list.length > 0 && <span className="adm-small">These parties are on times you just took away. Nothing was changed or sent.</span>}
          {booked.list.map((b) => (
            <button key={b.partyId} type="button" className="adm-bookedlink" onClick={() => open({ kind: 'party', day: localDate(b.startIso), id: b.partyId })}>
              {`${b.hostName} · ${dayAndClock(b.startIso)}`}<span aria-hidden="true"> ›</span>
            </button>
          ))}
          {booked.unknown && <span className="adm-small">The parties already booked couldn’t be checked just now. Look at the calendar for parties on the times you changed.</span>}
          <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setBooked(null)}>Got it</button>
        </div>
      )}

      <p className="adm-lbl adm-lbl-first">Party days and times</p>
      <p className="adm-small adm-muted">The times a party can start, every week. Each party needs its length plus an hour to clean up before the next.</p>
      {WEEK.map(([k, name]) => (
        <TimesRow key={k} label={name} starts={d.weekly[k] ?? []} onChange={(s) => set({ weekly: { ...d.weekly, [k]: s } })} error={errAt(`times.weekly.${k}`)} />
      ))}

      <p className="adm-lbl">Different on a date</p>
      <p className="adm-small adm-muted">A date here replaces that weekday’s times. Leave it with no times for a day with no parties.</p>
      {datesShown.length === 0 && <p className="adm-small adm-muted">No dates set.</p>}
      {datesShown.map((x) => (
        <TimesRow
          key={x._k}
          label={x.ymd ? dayLabel(x.ymd) : 'New date'}
          starts={x.starts}
          noneText="No parties this day"
          date={{ ymd: x.ymd, onDate: (ymd) => set({ dates: d.dates.map((y) => (y._k === x._k ? { ...y, ymd } : y)) }) }}
          onChange={(s) => set({ dates: d.dates.map((y) => (y._k === x._k ? { ...y, starts: s } : y)) })}
          onRemove={() => set({ dates: d.dates.filter((y) => y._k !== x._k) })}
          error={x.ymd ? errAt(`times.dates.${x.ymd}`) : <p className={`adm-error adm-fielderr${error?.field === 'undated-date' ? '' : ' adm-muted'}`}>Pick the date.</p>}
        />
      ))}
      {errAt('times.dates')}
      <button type="button" className="adm-btn is-ghost adm-gap-top" onClick={() => set({ dates: [...d.dates, { _k: newKey(), ymd: '', starts: [] }] })}>+ Add a date</button>

      <p className="adm-lbl">Booking on the website</p>
      <div className="adm-two">
        <label className="adm-fld"><span>Notice (days)</span><input type="number" inputMode="numeric" min={0} max={60} value={shown(d.minLeadDays)} onChange={(e) => set({ minLeadDays: num(e.target.value) })} /></label>
        <label className="adm-fld"><span>Up to (days ahead)</span><input type="number" inputMode="numeric" min={1} max={365} value={shown(d.bookingWindowDays)} onChange={(e) => set({ bookingWindowDays: num(e.target.value) })} /></label>
      </div>
      {errAt('times.minLeadDays')}{errAt('times.bookingWindowDays')}
      <label className="adm-fld"><span>First day parties can be booked</span><input type="date" value={d.opensDate} onChange={(e) => set({ opensDate: e.target.value })} /></label>
      {errAt('times.opensDate')}
      <p className="adm-small adm-muted">{`Online, people book at least ${shown(d.minLeadDays) || '…'} days ahead and up to ${shown(d.bookingWindowDays) || '…'} days ahead. From here you can book any free time, any day.`}</p>

      <p className="adm-lbl">Packages</p>
      {d.packages.map((p, i) => (
        <PackageBox key={p._k} p={p} saved={base.packages.some((x) => x.id === p.id)} error={errAt(`packages.${i}`)}
          onChange={(patch) => set({ packages: d.packages.map((x) => (x._k === p._k ? { ...x, ...patch } : x)) })}
          onRemove={() => set({ packages: d.packages.filter((x) => x._k !== p._k) })} />
      ))}
      {error?.field === 'packages' && <p className="adm-error adm-fielderr" role="alert">{error.text}</p>}
      {!anyEveryone && <p className="adm-small adm-warntext">Keep at least one package that everyone can book.</p>}
      <button type="button" className="adm-btn is-ghost" onClick={() => set({ packages: [...d.packages, keyed<PartyPackage>({ id: '', name: '', priceCents: Number.NaN, minutes: 90, minGuests: 10, maxGuests: 30, defaultGuests: 10, quickPicks: [], who: 'admin', archived: false })] })}>+ Add a package</button>
      <p className="adm-small adm-muted adm-gap-top">Crafts are charged per guest on top of the package, at the studio.</p>

      <p className="adm-lbl">Extras</p>
      {d.addOns.length === 0 && <p className="adm-small adm-muted">No extras yet.</p>}
      {d.addOns.map((a, i) => (
        <ExtraBox key={a._k} a={a} saved={base.addOns.some((x) => x.id === a.id)} error={errAt(`addOns.${i}`)}
          onChange={(patch) => set({ addOns: d.addOns.map((x) => (x._k === a._k ? { ...x, ...patch } : x)) })}
          onRemove={() => set({ addOns: d.addOns.filter((x) => x._k !== a._k) })} />
      ))}
      {error?.field === 'addOns' && <p className="adm-error adm-fielderr" role="alert">{error.text}</p>}
      <button type="button" className="adm-btn is-ghost" onClick={() => set({ addOns: [...d.addOns, keyed<PartyAddOn>({ id: '', label: '', priceCents: Number.NaN, per: 'party', extraMinutes: 0, maxQty: 1, online: true, archived: false })] })}>+ Add an extra</button>

      <PartyCrafts />

      <p className="adm-lbl">Parties booked in Square</p>
      <LegacyRow legacy={legacy} on={d.readSquareBookings} onChange={(v) => set({ readSquareBookings: v })} error={errAt('readSquareBookings')} />
    </SheetFrame>
  )
}

/** One day's start times as chips (each removable), and + Add a time. */
function TimesRow({ label, starts, onChange, error, noneText = 'No parties', date, onRemove }: {
  label: string
  starts: string[]
  onChange: (s: string[]) => void
  error: ReactNode
  noneText?: string
  date?: { ymd: string; onDate: (ymd: string) => void }
  onRemove?: () => void
}) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [t, setT] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (adding) input.current?.focus() }, [adding])
  const sorted = [...starts].sort()
  function add() {
    if (!/^\d{2}:\d{2}$/.test(t)) return
    if (!starts.includes(t)) onChange([...starts, t].sort())
    setT('')
    setAdding(false)
  }
  return (
    <div className="adm-timesrow" role="group" aria-label={label}>
      <div className="adm-timesrow-head">
        {date
          ? <label className="adm-fld" style={{ margin: 0, flex: 1 }}><span>Date</span><input type="date" min={today()} value={date.ymd} onChange={(e) => date.onDate(e.target.value)} /></label>
          : <b>{label}</b>}
        {onRemove && <button type="button" className="adm-btn is-ghost is-sm" aria-label={`Remove ${label}`} onClick={onRemove}>Remove</button>}
      </div>
      <div className="adm-times">
        {sorted.length === 0 && <span className="adm-small adm-muted">{noneText}</span>}
        {sorted.map((s) => (
          <button key={s} type="button" className="adm-time is-chip" aria-label={`Remove ${clock(s)} on ${label}`} onClick={() => {
            const before = starts
            onChange(starts.filter((x) => x !== s))
            // One tap takes it away; the toast's Undo puts it back (m14). Nothing is saved until Save.
            toast(`Took away ${clock(s)} on ${label}. Not saved yet.`, { undo: () => onChange(before) })
          }}>
            {clock(s)} <span aria-hidden="true">×</span>
          </button>
        ))}
        {!adding && <button type="button" className="adm-time is-add" onClick={() => setAdding(true)} aria-label={`Add a party time on ${label}`}>+ Add a time</button>}
      </div>
      {adding && (
        <div className="adm-timesrow-add">
          <label className="adm-fld" style={{ margin: 0, flex: 1 }}><span>Start time</span><input ref={input} type="time" step={900} value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} /></label>
          <button type="button" className="adm-btn is-pri is-sm" disabled={!/^\d{2}:\d{2}$/.test(t)} onClick={add}>Add</button>
          <button type="button" className="adm-btn is-ghost is-sm" onClick={() => { setAdding(false); setT('') }}>Never mind</button>
        </div>
      )}
      {error}
    </div>
  )
}

function PackageBox({ p, saved, error, onChange, onRemove }: { p: Keyed<PartyPackage>; saved: boolean; error: ReactNode; onChange: (patch: Partial<PartyPackage>) => void; onRemove: () => void }) {
  const name = p.name || 'New package'
  if (p.archived) {
    return (
      <div className="adm-kv adm-setrow">
        <span><b>{name}</b><br /><span className="adm-small adm-muted">Archived. Parties already booked keep it.</span></span>
        <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onChange({ archived: false })}>Bring back</button>
      </div>
    )
  }
  const link = typeof window !== 'undefined' && saved && p.who === 'link' ? `${window.location.origin}/book?package=${p.id}` : ''
  return (
    <fieldset className="adm-date adm-gap-bottom">
      <legend>{name}</legend>
      <label className="adm-fld"><span>Name</span><input value={p.name} maxLength={60} placeholder="Like: Whole studio" onChange={(e) => onChange({ name: e.target.value })} /></label>
      <div className="adm-two">
        <label className="adm-fld"><span>Price ($)</span><input type="number" inputMode="decimal" min={0} step="0.01" value={dollars(p.priceCents)} onChange={(e) => onChange({ priceCents: toCents(e.target.value) })} /></label>
        <label className="adm-fld"><span>Length (minutes)</span><input type="number" inputMode="numeric" min={15} max={480} step={15} value={shown(p.minutes)} onChange={(e) => onChange({ minutes: num(e.target.value) })} /></label>
      </div>
      <div className="adm-three is-fields">
        <label className="adm-fld"><span>Fewest guests</span><input type="number" inputMode="numeric" min={1} max={60} value={shown(p.minGuests)} onChange={(e) => onChange({ minGuests: num(e.target.value) })} /></label>
        <label className="adm-fld"><span>Most guests</span><input type="number" inputMode="numeric" min={1} max={60} value={shown(p.maxGuests)} onChange={(e) => onChange({ maxGuests: num(e.target.value) })} /></label>
        <label className="adm-fld"><span>Usual guests</span><input type="number" inputMode="numeric" min={1} max={60} value={shown(p.defaultGuests)} onChange={(e) => onChange({ defaultGuests: num(e.target.value) })} /></label>
      </div>
      <p className="adm-small" style={{ margin: '0 0 0.3rem', fontWeight: 600 }}>Who can book it</p>
      <Seg label={`Who can book ${name}`} value={p.who} className="is-wrap" options={WHO} onChange={(who) => onChange({ who })} />
      <p className="adm-small adm-muted" style={{ marginTop: '-0.4rem' }}>{WHO_NOTE[p.who]}{Number.isFinite(p.minutes) ? ` The party runs ${p.minutes} minutes, then an hour to clean up.` : ''}</p>
      {link && <p className="adm-small adm-selectable" aria-label="The booking link">{link}</p>}
      {p.who === 'link' && !saved && <p className="adm-small adm-muted">The link to send shows here once you save.</p>}
      {error}
      {saved
        ? <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onChange({ archived: true })}>{`Archive ${name}`}</button>
        : <button type="button" className="adm-btn is-ghost is-sm" onClick={onRemove}>Remove</button>}
    </fieldset>
  )
}

function ExtraBox({ a, saved, error, onChange, onRemove }: { a: Keyed<PartyAddOn>; saved: boolean; error: ReactNode; onChange: (patch: Partial<PartyAddOn>) => void; onRemove: () => void }) {
  const name = a.label || 'New extra'
  if (a.archived) {
    return (
      <div className="adm-kv adm-setrow">
        <span><b>{name}</b><br /><span className="adm-small adm-muted">Archived. Parties that have it keep it.</span></span>
        <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onChange({ archived: false })}>Bring back</button>
      </div>
    )
  }
  return (
    <fieldset className="adm-date adm-gap-bottom">
      <legend>{name}</legend>
      <label className="adm-fld"><span>Name</span><input value={a.label} maxLength={60} placeholder="Like: Extra half hour" onChange={(e) => onChange({ label: e.target.value })} /></label>
      <label className="adm-fld"><span>Price ($)</span><input type="number" inputMode="decimal" min={0} step="0.01" value={dollars(a.priceCents)} onChange={(e) => onChange({ priceCents: toCents(e.target.value) })} /></label>
      <Seg label={`${name} is charged`} value={a.per} options={[['party', 'Per party'], ['guest', 'Per guest']]} onChange={(per) => onChange({ per })} />
      <div className="adm-two">
        <label className="adm-fld">
          <span>Extra time</span>
          <select value={a.extraMinutes} onChange={(e) => { const m = Number(e.target.value) as PartyAddOn['extraMinutes']; onChange({ extraMinutes: m, ...(m > 0 ? { maxQty: 1 } : {}) }) }}>
            {EXTRA_MINUTES.map((m) => <option key={m} value={m}>{m ? `${m} minutes` : 'None'}</option>)}
          </select>
        </label>
        <label className="adm-fld">
          <span>{a.per === 'guest' ? 'Most for each guest' : 'Most per party'}</span>
          <input type="number" inputMode="numeric" min={1} max={60} disabled={a.extraMinutes > 0} value={shown(a.maxQty)} onChange={(e) => onChange({ maxQty: num(e.target.value) })} />
        </label>
      </div>
      {a.extraMinutes > 0 && <p className="adm-small adm-muted" style={{ marginTop: '-0.4rem' }}>Extra time makes the party longer, so it can be added once.</p>}
      <label className="adm-check"><input type="checkbox" checked={a.online} onChange={(e) => onChange({ online: e.target.checked })} /><span>Offered on the website</span></label>
      {!a.online && <p className="adm-small adm-muted">Only you can add it, from here.</p>}
      {error}
      {saved
        ? <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onChange({ archived: true })}>{`Archive ${name}`}</button>
        : <button type="button" className="adm-btn is-ghost is-sm" onClick={onRemove}>Remove</button>}
    </fieldset>
  )
}

function PartyCrafts() {
  const { crafts, error, retry } = useCrafts()
  return (
    <>
      <p className="adm-lbl">Party crafts</p>
      <p className="adm-small adm-muted">These come from Square (the party crafts there). Change them in Square.</p>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !crafts && <Skeleton rows={2} label="Loading the party crafts" />}
      {crafts && crafts.length === 0 && <p className="adm-empty">No party crafts in Square yet.</p>}
      {crafts?.map((c) => (
        <div key={c.id} className="adm-kv"><span>{c.name}</span><span>{`${c.perHeadMaxCents > c.perHeadCents ? `${formatMoney(c.perHeadCents)}–${formatMoney(c.perHeadMaxCents)}` : formatMoney(c.perHeadCents)} a guest`}</span></div>
      ))}
    </>
  )
}

/** Parties still booked in Square, and the switch that counts them (off only once none are left, S2-R27). */
function LegacyRow({ legacy, on, onChange, error }: { legacy: LegacyRemaining; on: boolean; onChange: (v: boolean) => void; error: ReactNode }) {
  const left = legacy === null ? null : legacy.count
  const locked = on && left !== 0
  const why = legacy === null
    ? 'Square couldn’t be asked how many are left, so this stays on.'
    : legacy.count > 0
      ? `${legacy.count === 1 ? '1 party' : `${legacy.count} parties`} booked in Square ${legacy.count === 1 ? 'is' : 'are'} still to come${legacy.lastIso ? `, the last on ${dayLabel(localDate(legacy.lastIso))}` : ''}. This stays on until they’ve run.`
      : 'None left to come. You can turn this off.'
  return (
    <>
      <div className="adm-kv"><span>Parties still booked in Square</span><span>{legacy === null ? 'Couldn’t check' : legacy.count === 0 ? 'None' : `${legacy.count}${legacy.lastIso ? `, last on ${dayLabel(localDate(legacy.lastIso))}` : ''}`}</span></div>
      <label className="adm-check">
        <input type="checkbox" checked={on} disabled={locked} aria-describedby="adm-legacy-why" onChange={(e) => onChange(e.target.checked)} />
        <span>Keep their times blocked on the calendar</span>
      </label>
      <p id="adm-legacy-why" className="adm-small adm-muted">{why}</p>
      {error}
    </>
  )
}
