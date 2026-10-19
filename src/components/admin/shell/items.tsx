import type { ReactNode } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { formatTimeSpan } from '@lib/studio-time'
import { localDate } from '@lib/party-slots'
import { addDays, dayLabel } from '../classes/dates'
import type { Sheet } from './router'

/** Each kind's name in the Key and its colour class (see admin.css). */
export const KIND_STYLE = {
  class: { label: 'Our class', className: 'k-class' },
  'legacy-class': { label: 'Square class', className: 'k-legacy-class' },
  party: { label: 'Party', className: 'k-party' },
  cafe: { label: 'Craft Café', className: 'k-cafe' },
  blocked: { label: 'Blocked', className: 'k-blocked' },
  closed: { label: 'Closed', className: 'k-closed' },
} as const

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The days an item touches (a closed day runs midnight to midnight). */
export function daysOf(i: CalendarItem): string[] {
  const first = localDate(i.startIso)
  const last = localDate(new Date(Math.max(Date.parse(i.startIso), Date.parse(i.endIso) - 1)).toISOString())
  const out = [first]
  while (out[out.length - 1] < last && out.length < 40) out.push(addDays(out[out.length - 1], 1))
  return out
}

/** Items by studio day, earliest first. */
export function byDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const m = new Map<string, CalendarItem[]>()
  for (const i of items) for (const d of daysOf(i)) m.set(d, [...(m.get(d) ?? []), i])
  for (const list of m.values()) list.sort((a, b) => Date.parse(a.startIso) - Date.parse(b.startIso))
  return m
}

export function itemName(i: CalendarItem): string {
  switch (i.kind) {
    case 'blocked': return i.label === 'blocked time' ? 'Blocked time' : `Blocked · ${i.label}`
    case 'party': return cap(i.label)
    default: return i.label
  }
}

export function itemSub(i: CalendarItem): string {
  switch (i.kind) {
    case 'class': return i.booked !== undefined && i.capacity !== undefined ? `${i.booked} of ${i.capacity} booked` : 'Our class'
    case 'legacy-class': return 'Square class'
    case 'party': return i.guests ? `${i.guests} guests` : 'Party'
    case 'cafe': return 'Walk-in · pay per craft'
    default: return 'Nothing can be booked'
  }
}

export function itemTime(i: CalendarItem): string {
  return i.kind === 'closed' ? 'All day' : formatTimeSpan(i.startIso, i.endIso)
}

/** Draft, Sign-ups closed. */
export function itemTag(i: CalendarItem): { text: string; red?: boolean } | null {
  if (i.kind !== 'class') return null
  if (i.status === 'draft') return { text: 'Draft' }
  if (i.status === 'closed') return { text: 'Sign-ups closed' }
  if (i.status === 'cancelled') return { text: 'Cancelled', red: true }
  return null
}

/** The sheet an item opens, on the day it was tapped. */
export function sheetOf(i: CalendarItem, day: string): Sheet {
  switch (i.kind) {
    case 'class': return { kind: 'class', id: i.id }
    case 'legacy-class': return { kind: 'legacy', day, id: i.id }
    case 'party': return { kind: 'party', day: localDate(i.startIso), id: i.id }
    case 'blocked': return { kind: 'blocked', day: localDate(i.startIso), id: i.id }
    case 'cafe': return { kind: 'cafe', day }
    default: return { kind: 'closed', day }
  }
}

export const itemKey = (i: CalendarItem) => `${i.kind}-${i.id}-${i.sessionId ?? i.startIso}`

/** One agenda row: time · name · what it is, with the kind's colour bar and a Draft tag. */
export function ItemRow({ item, onOpen }: { item: CalendarItem; onOpen: () => void }) {
  const tag = itemTag(item)
  const time = itemTime(item)
  const [from, to] = time.split('–')
  return (
    <button
      type="button"
      className={`adm-row ${KIND_STYLE[item.kind].className}${item.kind === 'class' && item.status === 'draft' ? ' is-draft' : ''}`}
      data-kind={item.kind}
      onClick={onOpen}
    >
      <span className="adm-rt">{to ? <>{from}–<br />{to}</> : time}</span>
      <span className="adm-rm">
        <b>{itemName(item)}</b>
        <small>{itemSub(item)}{tag && <span className={`adm-tag${tag.red ? ' is-red' : ''}`}>{tag.text}</span>}</small>
      </span>
      <span className="adm-chev" aria-hidden="true">›</span>
    </button>
  )
}

/** Loading rows: the area keeps its shape while it fills. */
export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, n) => <div key={n} className="adm-skel" />)}
    </div>
  )
}

/** A part that failed to load: its own sentence and Try again, the rest of the page carries on. */
export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="adm-fail" role="alert">
      <p>{message || 'That didn’t load.'}</p>
      <button type="button" className="adm-btn is-ghost is-sm" onClick={onRetry}>Try again</button>
    </div>
  )
}

/** A segmented control (Week | Month). */
export function Seg<T extends string>({ value, options, onChange, label, tight }: {
  value: T
  options: [T, ReactNode][]
  onChange: (v: T) => void
  label: string
  tight?: boolean
}) {
  return (
    <div className={`adm-seg${tight ? ' is-tight' : ''}`} role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

/** The colours, folded away behind "Key". */
export function Key() {
  return (
    <details className="adm-key">
      <summary>Key</summary>
      <ul aria-label="Colours">
        {Object.entries(KIND_STYLE).map(([k, s]) => (
          <li key={k} className={s.className}><i aria-hidden="true" />{s.label}</li>
        ))}
      </ul>
    </details>
  )
}

/** "Sat Oct 24" */
export { dayLabel }
