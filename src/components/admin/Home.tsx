import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { closureOn } from '@config/closures'
import { addDays, dayLabel, today } from './classes/dates'
import { useCalendar } from './shell/data'
import { byDay, Failed, ItemRow, itemKey, sheetOf, Skeleton } from './shell/items'
import type { Sheet } from './shell/router'
import { useInbox } from './inbox/InboxData'
import { useWide } from './shell/useWide'
import type { InboxSegment } from './inbox/Inbox'

/** "Good morning" by the studio's clock (America/Chicago). */
export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** "Monday, October 19" */
function longDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
}

/**
 * Home: today, the rest of the week (only days with something on), what is
 * waiting on the owners, and the jobs done most. On an iPad, two columns.
 */
export default function Home({ who, onOpen, onInbox }: {
  who: string
  onOpen: (s: Sheet, data?: unknown) => void
  onInbox: (s: InboxSegment) => void
}) {
  const day = today()
  const { items, error, retry } = useCalendar(day, addDays(day, 7))
  const inbox = useInbox()
  const wide = useWide()
  const days = items ? byDay(items) : null
  const open = (i: CalendarItem, d: string) => onOpen(sheetOf(i, d), i)

  const todays = (days?.get(day) ?? []).filter((i) => i.kind !== 'closed')
  const closure = closureOn(day)

  const agenda = (
    <div>
      <p className="adm-lbl">Today</p>
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !days && <Skeleton rows={2} label="Loading today" />}
      {days && todays.map((i) => <ItemRow key={itemKey(i)} item={i} onOpen={() => open(i, day)} />)}
      {days && !todays.length && (
        <p className="adm-empty">{closure ? `Nothing on today. Closed for ${closure.name}.` : 'Nothing on today.'}</p>
      )}
      <p className="adm-lbl">This week</p>
      {!error && !days && <Skeleton rows={3} label="Loading this week" />}
      {days && (() => {
        const rest = Array.from({ length: 6 }, (_, n) => addDays(day, n + 1)).filter((d) => (days.get(d) ?? []).length)
        if (!rest.length) return <p className="adm-empty">Nothing else this week.</p>
        return rest.map((d) => (
          <section key={d} aria-label={dayLabel(d)}>
            <p className="adm-dayname">{dayLabel(d)}</p>
            {(days.get(d) ?? []).map((i) => <ItemRow key={itemKey(i)} item={i} onOpen={() => open(i, d)} />)}
          </section>
        ))
      })()}
    </div>
  )

  const count = (n: number, loaded: boolean, failed: boolean) => (loaded ? n : failed ? '!' : '–')
  const need = (
    <div>
      <p className="adm-lbl">Needs you</p>
      <div className="adm-need">
        {([
          ['request', 'Requests', inbox.request],
          ['message', 'Messages', inbox.message],
          ['teacher', 'Teachers', inbox.teacher],
          ['todo', 'To decide', inbox.todo],
        ] as const).map(([seg, label, src]) => (
          <button key={seg} type="button" onClick={() => onInbox(seg)} aria-label={`${label}: ${src.items ? inbox.counts[seg] : 'not loaded'}`}>
            <b>{count(inbox.counts[seg], !!src.items, !!src.error)}</b>
            <small>{label}</small>
          </button>
        ))}
      </div>
    </div>
  )

  const actions = (
    <div className="adm-home-actions">
      <button type="button" className="adm-btn is-pri" onClick={() => onOpen({ kind: 'new' })}>+ New class</button>
      <div className="adm-two">
        <button type="button" className="adm-btn is-ghost" onClick={() => onOpen({ kind: 'book-party' })}>+ Book a party</button>
        <button type="button" className="adm-btn is-ghost" onClick={() => onOpen({ kind: 'block' })}>Block time</button>
      </div>
      <button type="button" className="adm-btn is-ghost is-sm" onClick={() => onOpen({ kind: 'print', day })}>Print today</button>
    </div>
  )

  return (
    <>
      <p className="adm-brand">Hometown Studio · Admin</p>
      <h1>{greeting()}{who ? `, ${who}` : ''}</h1>
      <p className="adm-muted adm-small">{longDay(day)}</p>
      <div className="adm-cols">
        {/* Phone: the week, the buttons, then Needs you. iPad: the week | Needs you and the buttons. */}
        <div>{agenda}{!wide && actions}</div>
        <div>{need}{wide && actions}</div>
      </div>
    </>
  )
}
