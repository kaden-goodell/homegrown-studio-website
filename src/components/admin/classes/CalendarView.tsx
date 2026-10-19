import { useState } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { useCalendar } from '../shell/data'
import { byDay, Failed, ItemRow, itemKey, itemName, itemTag, itemTime, Key, KIND_STYLE, Seg, sheetOf, Skeleton } from '../shell/items'
import type { Sheet } from '../shell/router'
import { useWide } from '../shell/useWide'
import { addDays, addMonths, dayLabel, monthLabel, monthStart, today, weekStartMonday } from './dates'

export { KIND_STYLE }

type View = 'week' | 'month'

/** The days on screen: a Monday-to-Sunday week (so a Thursday-to-Sunday weekend stays together), or the weeks covering a month. */
export function rangeOf(view: View, day: string): { from: string; days: string[] } {
  if (view === 'week') {
    const from = weekStartMonday(day)
    return { from, days: Array.from({ length: 7 }, (_, n) => addDays(from, n)) }
  }
  const first = monthStart(day)
  const from = weekStartMonday(first)
  const end = addDays(weekStartMonday(addDays(addMonths(first, 1), -1)), 7)
  const days: string[] = []
  for (let d = from; d < end; d = addDays(d, 1)) days.push(d)
  return { from, days }
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * Calendar: everything holding the room. Week (the default) or Month, with
 * ‹ Today ›. On a phone the week is a list of days, each with a + that opens
 * the day; on an iPad, seven columns. Month shows a count per day (chips on
 * an iPad). Tap any item to open it; tap a day or its + to see it or add to it.
 */
export default function CalendarView({ initialDay, onOpen }: {
  initialDay?: string
  onOpen: (s: Sheet, data?: unknown) => void
}) {
  const wide = useWide()
  const [view, setView] = useState<View>('week')
  const [day, setDay] = useState(initialDay ?? today())
  const { days } = rangeOf(view, day)
  const { items, error, retry } = useCalendar(days[0], addDays(days[days.length - 1], 1))
  const map = items ? byDay(items) : null
  const now = today()
  const showsToday = days.includes(now) && (view === 'week' || day.slice(0, 7) === now.slice(0, 7))

  const step = (n: number) => setDay(view === 'week' ? addDays(day, 7 * n) : addMonths(monthStart(day), n))
  const openItem = (i: CalendarItem, d: string) => onOpen(sheetOf(i, d), i)
  const openDay = (d: string) => onOpen({ kind: 'day', day: d })
  const unit = view === 'week' ? 'week' : 'month'

  return (
    <>
      <div className="adm-top">
        <div className="adm-grow">
          <p className="adm-brand">Hometown Studio</p>
          <h1>Calendar</h1>
        </div>
      </div>
      <Seg label="View" value={view} onChange={setView} options={[['week', 'Week'], ['month', 'Month']]} />
      <div className="adm-wknav">
        <button type="button" className="adm-arrow" aria-label={`Last ${unit}`} onClick={() => step(-1)}>‹</button>
        <span className="adm-grow" aria-live="polite">{view === 'week' ? `Week of ${dayLabel(days[0]).replace(/^\w+ /, '')}` : monthLabel(monthStart(day))}</span>
        <button type="button" className="adm-arrow" aria-label={`Next ${unit}`} onClick={() => step(1)}>›</button>
        {!showsToday && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setDay(now)}>Today</button>}
      </div>
      <Key />
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !map && <Skeleton rows={5} label="Loading the calendar" />}
      {map && view === 'week' && !wide && days.map((d) => {
        const list = map.get(d) ?? []
        return (
          <section key={d} aria-label={dayLabel(d)}>
            <div className="adm-dayh">
              <h3 className={d === now ? 'is-today' : undefined}>{dayLabel(d)}{d === now ? ' · Today' : ''}</h3>
              <button type="button" className="adm-plus" aria-label={`Add on ${dayLabel(d)}`} onClick={() => openDay(d)}>+</button>
            </div>
            {list.map((i) => <ItemRow key={itemKey(i)} item={i} onOpen={() => openItem(i, d)} />)}
            {!list.length && (
              <button type="button" className="adm-empty" onClick={() => openDay(d)}>Nothing on this day<em>+ Add</em></button>
            )}
          </section>
        )
      })}
      {map && view === 'week' && wide && (
        <div className="adm-wgrid">
          {days.map((d) => {
            const [wd, ...md] = dayLabel(d).split(' ')
            return (
              <section key={d} aria-label={dayLabel(d)} className={`adm-wcol${d === now ? ' is-today' : ''}`}>
                <h3 className="adm-wh">
                  <span>{wd}<br />{md.join(' ')}</span>
                  <button type="button" className="adm-plus" aria-label={`Add on ${dayLabel(d)}`} onClick={() => openDay(d)}>+</button>
                </h3>
                {(map.get(d) ?? []).map((i) => {
                  const tag = itemTag(i)
                  return (
                    <button key={itemKey(i)} type="button" data-kind={i.kind} className={`adm-chip ${KIND_STYLE[i.kind].className}`} onClick={() => openItem(i, d)}>
                      <small>{itemTime(i)}</small>
                      <b>{itemName(i)}</b>
                      {tag && <span className={`adm-tag${tag.red ? ' is-red' : ''}`}>{tag.text}</span>}
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
      {map && view === 'month' && (
        <>
          <div className="adm-mgrid">
            {WEEKDAYS.map((w, n) => <span key={n} className="adm-wd" aria-hidden="true">{w}</span>)}
            {days.map((d) => {
              const list = map.get(d) ?? []
              const inMonth = d.slice(0, 7) === day.slice(0, 7)
              const things = list.length === 1 ? '1 thing on' : `${list.length} things on`
              return (
                <button
                  key={d}
                  type="button"
                  className={`adm-mday${inMonth ? '' : ' is-out'}${d === now ? ' is-today' : ''}`}
                  aria-label={`${dayLabel(d)}, ${things}${list.length ? `: ${list.map(itemName).join(', ')}` : ''}`}
                  onClick={() => openDay(d)}
                >
                  <span>{Number(d.slice(8))}</span>
                  {list.length > 0 && !wide && <span className="adm-n" aria-hidden="true">{list.length}</span>}
                  {list.length > 0 && wide && list.slice(0, 3).map((i) => (
                    <span key={itemKey(i)} className={`adm-mi ${KIND_STYLE[i.kind].className}`} aria-hidden="true">{itemName(i)}</span>
                  ))}
                  {wide && list.length > 3 && <span className="adm-mi" aria-hidden="true">+{list.length - 3} more</span>}
                </button>
              )
            })}
          </div>
          <p className="adm-small adm-muted" style={{ marginTop: '0.5rem' }}>Tap a day to see it or add to it.</p>
        </>
      )}
    </>
  )
}
