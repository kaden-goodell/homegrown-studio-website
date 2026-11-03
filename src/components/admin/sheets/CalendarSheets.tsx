import { useEffect, useState } from 'react'
import { SQ_LEGACY_CLASS } from '@lib/admin-help'
import { SquareHow } from '../shell/SquareHow'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { closureOn } from '@config/closures'
import { isStudioOpenOn } from '@config/studio-days'
import { cafeHoursEntries, cafeHoursOn } from '@config/hours'
import { useStudio } from '../shell/studio'
import { timeSpan as formatTimeSpan, clockRange } from '../shell/time'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED, CAFE_VISITS } from '../classes/api'
import { addDays, dayLabel, weekday } from '../classes/dates'
import { useCalendar, useRefresh } from '../shell/data'
import { StaffRow } from '../staffing/StaffRow'
import { Failed, ItemRow, itemKey, itemName, itemTime, sheetOf, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'

/** The item a sheet is about: handed over by the list that opened it, or found again on its day (after a refresh). */
function useItem(day: string, id: string): { item: CalendarItem | null; loading: boolean; error: string; retry: () => void } {
  const { data } = useSheet()
  const given = data && typeof data === 'object' && (data as CalendarItem).id === id ? (data as CalendarItem) : null
  const [found, setFound] = useState<{ item: CalendarItem | null; error: string } | null>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (given) return
    let live = true
    setFound(null)
    const from = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString()
    const to = new Date(Date.parse(`${addDays(day, 1)}T00:00:00Z`) + 86_400_000).toISOString()
    api<{ items: CalendarItem[] }>(`/api/admin/classes/calendar.json?${new URLSearchParams({ from, to })}`).then((r) => {
      if (!live) return
      setFound(r.ok && r.data ? { item: r.data.items.find((i) => i.id === id) ?? null, error: '' } : { item: null, error: r.error ?? '' })
    })
    return () => { live = false }
  }, [day, id, tries, !!given])
  if (given) return { item: given, loading: false, error: '', retry: () => {} }
  return { item: found?.item ?? null, loading: !found, error: found?.error ?? '', retry: () => setTries((n) => n + 1) }
}

const whenOf = (i: CalendarItem) => `${dayLabel(localDate(i.startIso))} · ${itemTime(i)}`

function Gone({ title }: { title: string }) {
  return <SheetFrame title={title}><p className="adm-muted">This isn’t on the calendar any more.</p></SheetFrame>
}

/** One day: what's on, and the ways to add to it. */
export function DaySheet({ day }: { day: string }) {
  const { open } = useSheet()
  const { items, error, retry } = useCalendar(day, addDays(day, 1))
  const list = items ?? []
  // The closure itself is not "a thing on": the count and Print skip it.
  const things = list.filter((i) => i.kind !== 'closed')
  const { days } = useStudio()
  const closure = closureOn(day, days.closures)
  const shut = !isStudioOpenOn(day, days)
  const weekdayName = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' })
  return (
    <SheetFrame title={dayLabel(day)} subtitle={items && things.length ? (things.length === 1 ? '1 thing on' : `${things.length} things on`) : undefined}>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !items && <Skeleton rows={2} label="Loading the day" />}
      {items && list.map((i) => <ItemRow key={itemKey(i)} item={i} onOpen={() => open(sheetOf(i, day), i)} />)}
      {items && !list.length && <p className="adm-empty">Nothing on this day yet.</p>}
      {shut && (
        <p className="adm-note" style={{ marginTop: '0.75rem' }}>
          {closure ? `Closed for ${closure.name}: customers can’t book anything this day.` : `The studio is usually closed on ${weekdayName}s. You can still add something.`}
        </p>
      )}
      <div className="adm-stack" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="adm-btn is-pri" onClick={() => open({ kind: 'new', day })}>+ New class on this day</button>
        {shut
          ? <p className="adm-small adm-muted" style={{ textAlign: 'center' }}>{closure ? 'Parties can’t be booked on closed days.' : `Parties can’t be booked on ${weekdayName}s.`}</p>
          : <button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'book-party', day })}>+ Book a party on this day</button>}
        <button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'block', day })}>Block time on this day</button>
        {!(shut && items && !things.length) && <button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'print', day })}>Print this day</button>}
      </div>
    </SheetFrame>
  )
}

/** A class still run from Square: read only. */
export function LegacySheet({ day, id }: { day: string; id: string }) {
  const { item, loading, error, retry } = useItem(day, id)
  if (loading) return <SheetFrame title="Square class"><Skeleton rows={1} /></SheetFrame>
  if (error) return <SheetFrame title="Square class"><Failed message={error} onRetry={retry} /></SheetFrame>
  if (!item) return <Gone title="Square class" />
  return (
    <SheetFrame title={item.label} subtitle={whenOf(item)}>
      <div className="adm-card"><p>This class lives in Square. Change it there.</p><SquareHow how={SQ_LEGACY_CLASS} /></div>
      <StaffRow eventKey={`legacy:${item.id}`} startIso={item.startIso} />
    </SheetFrame>
  )
}

/** Blocked time: what it holds, and Remove after a second tap. */
export function BlockedSheet({ day, id }: { day: string; id: string }) {
  const { item, loading, error, retry } = useItem(day, id)
  const { close } = useSheet()
  const { bump } = useRefresh()
  const toast = useToast()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  if (loading) return <SheetFrame title="Blocked time"><Skeleton rows={1} /></SheetFrame>
  if (error) return <SheetFrame title="Blocked time"><Failed message={error} onRetry={retry} /></SheetFrame>
  if (!item) return <Gone title="Blocked time" />
  const reason = item.label === 'blocked time' ? '' : item.label
  const note = item.note ?? ''

  async function remove() {
    if (!item) return
    setBusy(true)
    setFailed('')
    const r = await api(BLOCKED, { action: 'remove', id: item.id })
    setBusy(false)
    if (!r.ok) return setFailed(r.status === 0 ? r.error ?? DIDNT_SAVE : DIDNT_SAVE)
    bump()
    close()
    const again = { action: 'add', startIso: item.startIso, endIso: item.endIso, reason, ...(note ? { note } : {}), confirm: true }
    toast('Block removed.', {
      undo: () => api(BLOCKED, again).then((back) => { bump(); if (!back.ok) toast(DIDNT_SAVE) }),
    })
  }

  const footer = asking
    ? (
      <div className="adm-panel is-warn">
        <b>Remove this block?</b>
        <span className="adm-small">Customers can book this time again.</span>
        {failed && <p className="adm-error" role="alert">{failed}</p>}
        <div className="adm-two">
          <button type="button" className="adm-btn is-ghost" onClick={() => { setAsking(false); setFailed('') }}>Keep it</button>
          <button type="button" className="adm-btn is-danger" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Remove'}</button>
        </div>
      </div>
    )
    : <button type="button" className="adm-btn is-danger" onClick={() => setAsking(true)}>Remove this block</button>
  return (
    <SheetFrame title={itemName(item)} subtitle={whenOf(item)} footer={footer}>
      <div className="adm-card">
        <p>Customers can’t book anything {formatTimeSpan(item.startIso, item.endIso)}.</p>
        {reason && <p className="adm-muted">Why: {reason}</p>}
        {note && <p className="adm-muted">Note: {note}</p>}
      </div>
    </SheetFrame>
  )
}

/** Craft Café on a day: walk-in, read only. Its hours are set under More. */
export function CafeSheet({ day }: { day: string }) {
  const { open } = useSheet()
  const { days } = useStudio()
  const hours = cafeHoursOn(day, days.cafe)
  const special = days.cafe.special.find((d) => d.date === day)
  const weekly = cafeHoursEntries(days.cafe).map((h) => `Every ${h.days.join(' and ')}, ${clockRange(h.opens, h.closes)}.`).join(' ')
  return (
    <SheetFrame
      title={special ? `Craft Café · ${special.name.replace(/^Craft Café /, '')}` : 'Craft Café'}
      subtitle={`${dayLabel(day)}${hours ? ` · ${clockRange(hours.opens, hours.closes)}` : ''}`}
      footer={<button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'more', page: 'hours' })}>Change café hours</button>}
    >
      <div className="adm-card">
        <p>Walk-in. No booking needed.</p>
        <p>Pay per craft at the counter.</p>
      </div>
      <p className="adm-note" style={{ marginTop: '0.75rem' }}>
        {special ? 'A special day: these hours replace the usual hours for that day.' : weekly}
      </p>
      <CafeWhoCame day={day} />
    </SheetFrame>
  )
}

interface CafeDayVisits {
  totals: { households: number; people: number; adults: number; kids: number }
  entries: { name: string; people: string[]; at: string; by: string; adults: number; kids: number }[]
}

/** Who the crew checked in at Craft Café that day (today or before). */
function CafeWhoCame({ day }: { day: string }) {
  const [r, setR] = useState<CafeDayVisits | null>(null)
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const todayYmd = localDate(new Date().toISOString())
  useEffect(() => {
    if (day > todayYmd) return
    let live = true
    setR(null)
    setError('')
    api<CafeDayVisits>(`${CAFE_VISITS}?date=${day}`).then((x) => {
      if (!live) return
      if (x.ok && x.data) setR(x.data)
      else setError(x.error ?? '')
    })
    return () => { live = false }
  }, [day, tries])
  if (day > todayYmd) return null
  const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
  return (
    <section aria-label="Who came">
      <p className="adm-lbl adm-gap-top">Who came</p>
      {error && <Failed message={error} onRetry={() => setTries((n) => n + 1)} />}
      {!error && !r && <Skeleton rows={2} label="Loading who came" />}
      {r && (r.entries.length === 0
        ? <p className="adm-empty">No one was checked in at Craft Café this day.</p>
        : (
          <>
            <p>{`${r.totals.people} ${r.totals.people === 1 ? 'person' : 'people'} · ${r.totals.adults} ${r.totals.adults === 1 ? 'adult' : 'adults'} · ${r.totals.kids} ${r.totals.kids === 1 ? 'kid' : 'kids'} · ${r.totals.households} ${r.totals.households === 1 ? 'family' : 'families'}`}</p>
            {r.entries.map((e, n) => (
              <div key={n} className="adm-kv">
                <span>{e.name}{e.people.length ? ` (${e.people.join(', ')})` : ''}</span>
                <span>{`${time(e.at)}${e.by ? ` · ${e.by}` : ''}`}</span>
              </div>
            ))}
          </>
        ))}
      <p className="adm-note">The crew check people in on /staff (This week or Today › Craft Café).</p>
    </section>
  )
}

/** A closed day: nothing can be booked. Closed days are listed under More. */
export function ClosedSheet({ day }: { day: string }) {
  const { open } = useSheet()
  const { days } = useStudio()
  const c = closureOn(day, days.closures)
  const range = c ? (c.from === c.to ? dayLabel(c.from) : `${dayLabel(c.from)} – ${dayLabel(c.to)}`) : dayLabel(day)
  return (
    <SheetFrame
      title={c ? `Closed for ${c.name}` : 'Closed'}
      subtitle={range}
      footer={<button type="button" className="adm-btn is-ghost" onClick={() => open({ kind: 'more', page: 'closed' })}>Edit closed days</button>}
    >
      <div className="adm-card"><p>Nothing can be booked on these days: no classes, parties or Craft Café.</p></div>
    </SheetFrame>
  )
}
