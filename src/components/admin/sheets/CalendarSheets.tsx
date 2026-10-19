import { useEffect, useState } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import type { AdminParty, AdminPartyGuest } from '@pages/api/admin/party.json'
import { closureOn, OPEN_WEEKDAYS } from '@config/closures'
import { CAFE_HOURS, CAFE_SPECIAL_DAYS, cafeHoursOn } from '@config/hours'
import { partyConfig } from '@config/party.config'
import { formatMoney } from '@lib/money'
import { timeSpan as formatTimeSpan, clockRange } from '../shell/time'
import { localDate } from '@lib/party-slots'
import { api, BLOCKED, PARTY } from '../classes/api'
import { addDays, dayLabel, weekday } from '../classes/dates'
import { useCalendar, useRefresh } from '../shell/data'
import { Failed, ItemRow, itemKey, itemName, itemTime, Seg, sheetOf, Skeleton } from '../shell/items'
import { SheetFrame, useSheet } from '../shell/Sheet'
import { DIDNT_SAVE, useToast } from '../shell/Toast'
import { smsHref, telHref } from '../inbox/describe'
import { ContactButton } from '../inbox/InboxSheets'

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
  const closure = closureOn(day)
  const shut = !!closure || !OPEN_WEEKDAYS.has(weekday(day))
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
      <div className="adm-card"><p>This class lives in Square. Change it there.</p></div>
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

  async function remove() {
    if (!item) return
    setBusy(true)
    setFailed('')
    const r = await api(BLOCKED, { action: 'remove', id: item.id })
    setBusy(false)
    if (!r.ok) return setFailed(r.status === 0 ? r.error ?? DIDNT_SAVE : DIDNT_SAVE)
    bump()
    close()
    const again = { action: 'add', startIso: item.startIso, endIso: item.endIso, reason, confirm: true }
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
        {reason && <p className="adm-muted">Note: {reason}</p>}
      </div>
    </SheetFrame>
  )
}

/** Craft Café on a day: walk-in, read only. Its hours are set under More. */
export function CafeSheet({ day }: { day: string }) {
  const { open } = useSheet()
  const hours = cafeHoursOn(day)
  const special = CAFE_SPECIAL_DAYS.find((d) => d.date === day)
  const weekly = CAFE_HOURS.map((h) => `Every ${h.days.join(' and ')}, ${clockRange(h.opens, h.closes)}.`).join(' ')
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
        {special ? 'A special day: these hours replace the usual Saturday hours.' : weekly}
      </p>
    </SheetFrame>
  )
}

/** A closed day: nothing can be booked. Closed days are listed under More. */
export function ClosedSheet({ day }: { day: string }) {
  const { open } = useSheet()
  const c = closureOn(day)
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

type PartyTab = 'details' | 'guests' | 'pay'
const WAIVER: Record<AdminPartyGuest['waiver'], string> = { current: 'Waiver signed', expired: 'Waiver expired', outdated: 'Needs the new waiver' }

/** A party, read only for now: Details · Guests · Payments, with Call and Text. */
export function PartySheet({ day, id }: { day: string; id: string }) {
  const { item, loading, error, retry } = useItem(day, id)
  const [tab, setTab] = useState<PartyTab>('details')
  const [info, setInfo] = useState<{ party: AdminParty | null; guests: AdminPartyGuest[] | null } | null>(null)
  const [infoError, setInfoError] = useState('')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let live = true
    setInfoError('')
    api<{ party: AdminParty | null; guests: AdminPartyGuest[] | null }>(`${PARTY}?id=${encodeURIComponent(id)}`).then((r) => {
      if (!live) return
      if (r.ok && r.data) setInfo(r.data)
      else setInfoError(r.error ?? '')
    })
    return () => { live = false }
  }, [id, tries])

  if (loading) return <SheetFrame title="Party"><Skeleton rows={3} /></SheetFrame>
  if (error) return <SheetFrame title="Party"><Failed message={error} onRetry={retry} /></SheetFrame>
  if (!item) return <Gone title="Party" />
  const p = info?.party ?? null
  const phone = p?.hostPhone ?? ''
  const footer = phone
    ? (
      <div className="adm-two">
        <ContactButton label="Call" href={telHref(phone)} text={phone} />
        <ContactButton label="Text" href={smsHref(phone)} text={phone} />
      </div>
    )
    : undefined
  const kv = (k: string, v: string | number) => (
    <div key={k} className="adm-kv"><span>{k}</span><span>{v === '' ? '—' : v}</span></div>
  )
  return (
    <SheetFrame tall title={itemName(item)} subtitle={whenOf(item)} footer={footer}>
      <Seg label="Party" value={tab} onChange={setTab} options={[['details', 'Details'], ['guests', 'Guests'], ['pay', 'Payments']]} />
      {infoError && <Failed message={infoError} onRetry={() => setTries((n) => n + 1)} />}
      {!infoError && !info && <Skeleton rows={3} />}
      {info && !p && tab !== 'guests' && <p className="adm-note">This party was booked in Square, so there are no details on file here. Open it in Square.</p>}
      {info && p && tab === 'details' && (
        <>
          {kv('When', whenOf(item))}
          {kv('Host', p.hostName)}
          {kv('Phone', p.hostPhone)}
          {kv('Email', p.hostEmail)}
          {kv('Guests', p.guestCount)}
          {kv('Craft', p.craftName)}
          {p.themeName && kv('Themed table', p.themeName)}
          {p.title && kv('Called', p.title)}
        </>
      )}
      {info && tab === 'guests' && (
        info.guests === null
          ? <p className="adm-error" role="alert">The guest list couldn’t be read. Try again in a minute.</p>
          : (
            <>
              <p className="adm-small adm-muted" style={{ marginBottom: '0.25rem' }}>
                {`${info.guests.length} ${info.guests.length === 1 ? 'family has' : 'families have'} said yes · ${info.guests.reduce((n, g) => n + g.coming, 0)} people`}
                {p ? ` · booked for ${p.guestCount}` : ''}
              </p>
              {info.guests.length === 0 && <p className="adm-empty">No one has said yes yet.</p>}
              {info.guests.map((g, n) => (
                <div key={n} className="adm-bk">
                  <div className="adm-rm">
                    <b>{g.name || 'No name'}</b>
                    <small>{g.kids ? `+${g.kids} ${g.kids === 1 ? 'kid' : 'kids'} · ` : ''}{g.coming} coming</small>
                  </div>
                  <span className={`adm-tag${g.waiver === 'current' ? ' is-grey' : ''}`}>{WAIVER[g.waiver]}</span>
                </div>
              ))}
            </>
          )
      )}
      {info && p && tab === 'pay' && (
        <>
          {kv('Whole studio', formatMoney(partyConfig.basePriceCents))}
          {kv('Crafts', `${p.craftName}, paid at the studio for whoever comes`)}
          <div className="adm-panel" style={{ marginTop: '0.75rem' }}>
            <b>Studio fee paid when they booked</b>
            <span className="adm-small">Crafts are rung up on the POS on the day. Receipts and refunds are in Square.</span>
          </div>
        </>
      )}
    </SheetFrame>
  )
}
