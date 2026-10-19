import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { OPEN_WEEKDAYS } from '@config/closures'
import { useCalendar, useShell } from '../shell/data'
import { byDay, Failed, ItemRow, itemKey, itemName, itemTag, itemTime, Key, KIND_STYLE, Seg, sheetOf, Skeleton } from '../shell/items'
import { sheetToken, type Sheet } from '../shell/router'
import { useWide } from '../shell/useWide'
import { addDays, addMonths, dayLabel, monthLabel, monthStart, today, weekday, weekStartMonday } from './dates'

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
/** Narrower than this, seven columns get too thin: the week shows as a list of days instead. */
export const GRID_MIN_PX = 640

const shortDay = (d: string) => dayLabel(d).split(' ')[0]
/** A day the studio is shut and nothing is on: a usual closed weekday (Mon–Wed) with nothing booked, or a closure. */
const isClosedDay = (d: string, list: CalendarItem[]) =>
  list.length ? list.every((i) => i.kind === 'closed') : !OPEN_WEEKDAYS.has(weekday(d))

/** The width of an element, kept up to date (0 until it has been laid out). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/**
 * Calendar: everything holding the room. Week (the default) or Month, with
 * ‹ Today ›. On a phone, or beside an open side panel when seven columns
 * would be too thin, the week is a list of days, each with a +; otherwise
 * seven columns that never scroll sideways. Closed weekdays with nothing on
 * fold into one quiet row. Tap any item to open it (it stays highlighted
 * while its sheet is open); tap a day or its + to see it or add to it.
 */
export default function CalendarView({ initialDay, onOpen }: {
  initialDay?: string
  onOpen: (s: Sheet, data?: unknown) => void
}) {
  const wide = useWide()
  const { activeToken } = useShell()
  const [box, width] = useWidth<HTMLDivElement>()
  const [view, setView] = useState<View>('week')
  const [day, setDay] = useState(initialDay ?? today())
  const [unfold, setUnfold] = useState(false)
  const { days } = rangeOf(view, day)
  const { items, error, retry } = useCalendar(days[0], addDays(days[days.length - 1], 1))
  const map = items ? byDay(items) : null
  const now = today()
  const showsToday = days.includes(now) && (view === 'week' || day.slice(0, 7) === now.slice(0, 7))
  const grid = wide && !(width > 0 && width < GRID_MIN_PX)

  // The item whose sheet is open stays in view.
  useEffect(() => {
    if (!activeToken) return
    box.current?.querySelector<HTMLElement>('.is-active')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeToken, grid, !!map])

  const step = (n: number) => setDay(view === 'week' ? addDays(day, 7 * n) : addMonths(monthStart(day), n))
  const openItem = (i: CalendarItem, d: string) => onOpen(sheetOf(i, d), i)
  const openDay = (d: string) => onOpen({ kind: 'day', day: d })
  const isActive = (i: CalendarItem, d: string) => !!activeToken && sheetToken(sheetOf(i, d)) === activeToken
  const unit = view === 'week' ? 'week' : 'month'

  function dayList(m: Map<string, CalendarItem[]>): ReactNode[] {
    const out: ReactNode[] = []
    for (let n = 0; n < days.length; n++) {
      const d = days[n]
      const list = m.get(d) ?? []
      if (!unfold && !list.length && !OPEN_WEEKDAYS.has(weekday(d))) {
        // Fold a run of closed weekdays with nothing on into one row.
        let last = n
        while (last + 1 < days.length && !(m.get(days[last + 1]) ?? []).length && !OPEN_WEEKDAYS.has(weekday(days[last + 1]))) last++
        const label = `Closed ${shortDay(d)}${last > n ? `–${shortDay(days[last])}` : ''}`
        out.push(
          <button key={`closed-${d}`} type="button" className="adm-closedrow" aria-expanded={false} onClick={() => setUnfold(true)}>
            <span>{label}</span><em>Show</em>
          </button>,
        )
        n = last
        continue
      }
      out.push(
        <section key={d} aria-label={dayLabel(d)}>
          <div className="adm-dayh">
            <h3 className={d === now ? 'is-today' : undefined}>{dayLabel(d)}{d === now ? ' · Today' : ''}</h3>
            <button type="button" className="adm-plus" aria-label={`Add on ${dayLabel(d)}`} onClick={() => openDay(d)}>+</button>
          </div>
          {list.map((i) => <ItemRow key={itemKey(i)} item={i} active={isActive(i, d)} onOpen={() => openItem(i, d)} />)}
          {!list.length && (
            <button type="button" className="adm-empty" onClick={() => openDay(d)}>Nothing on this day<em>+ Add</em></button>
          )}
        </section>,
      )
    }
    return out
  }

  return (
    <div ref={box}>
      <div className="adm-top">
        <div className="adm-grow">
          <p className="adm-brand">Hometown Studio</p>
          <h1>Calendar</h1>
        </div>
      </div>
      <Seg label="View" value={view} onChange={setView} options={[['week', 'Week'], ['month', 'Month']]} className="is-view" />
      <div className="adm-wknav">
        <button type="button" className="adm-arrow" aria-label={`Last ${unit}`} onClick={() => step(-1)}>‹</button>
        <span className="adm-grow" aria-live="polite">{view === 'week' ? `Week of ${dayLabel(days[0]).replace(/^\w+ /, '')}` : monthLabel(monthStart(day))}</span>
        <button type="button" className="adm-arrow" aria-label={`Next ${unit}`} onClick={() => step(1)}>›</button>
        {!showsToday && <button type="button" className="adm-btn is-ghost is-sm" onClick={() => setDay(now)}>Today</button>}
      </div>
      <Key />
      {error && <Failed message={error} onRetry={retry} />}
      {!error && !map && <Skeleton rows={5} label="Loading the calendar" />}
      {map && view === 'week' && !grid && (
        <>
          {dayList(map)}
          {unfold && <button type="button" className="adm-btn is-ghost is-sm" style={{ marginTop: '0.75rem' }} onClick={() => setUnfold(false)}>Fold the closed days</button>}
        </>
      )}
      {map && view === 'week' && grid && (
        <div className="adm-wgrid">
          {days.map((d) => {
            const [wd, , date] = dayLabel(d).split(' ')
            const list = map.get(d) ?? []
            const shut = !list.length && !OPEN_WEEKDAYS.has(weekday(d))
            return (
              <section key={d} aria-label={dayLabel(d)} className={`adm-wcol${d === now ? ' is-today' : ''}`}>
                <h3 className={`adm-wh${d === now ? ' is-today' : ''}`}>
                  <span>{wd} {date}</span>
                  <button type="button" className="adm-plus" aria-label={`Add on ${dayLabel(d)}`} onClick={() => openDay(d)}>+</button>
                </h3>
                {shut && <span className="adm-mclosed">Closed</span>}
                {list.map((i) => {
                  const tag = itemTag(i)
                  const active = isActive(i, d)
                  return (
                    <button
                      key={itemKey(i)}
                      type="button"
                      data-kind={i.kind}
                      title={`${itemName(i)} · ${itemTime(i)}`}
                      aria-current={active ? 'true' : undefined}
                      className={`adm-chip ${KIND_STYLE[i.kind].className}${active ? ' is-active' : ''}`}
                      onClick={() => openItem(i, d)}
                    >
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
              const shut = isClosedDay(d, list)
              const things = list.length === 1 ? '1 thing on' : `${list.length} things on`
              const label = shut
                ? `${dayLabel(d)}, closed${list[0] ? ` (${itemName(list[0])})` : ''}`
                : `${dayLabel(d)}, ${things}${list.length ? `: ${list.map(itemName).join(', ')}` : ''}`
              return (
                <button
                  key={d}
                  type="button"
                  className={`adm-mday${inMonth ? '' : ' is-out'}${d === now ? ' is-today' : ''}${shut ? ' is-closed' : ''}`}
                  aria-label={label}
                  onClick={() => openDay(d)}
                >
                  <span>{Number(d.slice(8))}</span>
                  {shut && <span className="adm-mclosed" aria-hidden="true">Closed</span>}
                  {!shut && list.length > 0 && !wide && <span className="adm-n" aria-hidden="true">{list.length}</span>}
                  {!shut && list.length > 0 && wide && list.slice(0, 3).map((i) => (
                    <span key={itemKey(i)} className={`adm-mi ${KIND_STYLE[i.kind].className}`} aria-hidden="true">{itemName(i)}</span>
                  ))}
                  {!shut && wide && list.length > 3 && <span className="adm-mi" aria-hidden="true">+{list.length - 3} more</span>}
                </button>
              )
            })}
          </div>
          <p className="adm-small adm-muted" style={{ marginTop: '0.5rem' }}>Tap a day to see it or add to it.</p>
        </>
      )}
    </div>
  )
}
