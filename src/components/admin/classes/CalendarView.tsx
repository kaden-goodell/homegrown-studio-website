import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CalendarItem } from '@pages/api/admin/classes/calendar.json'
import { closureOn, OPEN_WEEKDAYS, type Closure } from '@config/closures'
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
/**
 * Narrower than this, seven columns get too thin: the week shows as a list of
 * days instead. iPad portrait (820px: 708px of content, with or without a
 * panel) gets the list; iPad landscape (1024px: 756px of content) the grid.
 */
export const GRID_MIN_PX = 720
/** Narrower than this, month cells show coloured dots and a count, not name stubs. */
export const MONTH_CHIPS_MIN_PX = 560

const shortDay = (d: string) => dayLabel(d).split(' ')[0]
/** A usual closed weekday (Mon–Wed) with nothing on it. */
const quietClosed = (d: string, list: CalendarItem[]) => !list.length && !OPEN_WEEKDAYS.has(weekday(d))
const HOLIDAY_NAME: Record<string, string> = { halloween: 'Halloween', thanksgiving: 'Thanksgiving', christmas: 'Christmas' }
/** What a named closure is called in a small month cell. */
const closureShort = (c: Closure) => (c.holiday ? HOLIDAY_NAME[c.holiday] : c.name.replace(/^the /, ''))

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
  /** The week whose closed weekdays are shown; a different week starts folded again. */
  const [unfoldWeek, setUnfoldWeek] = useState<string | null>(null)
  const { days } = rangeOf(view, day)
  const { items, error, retry } = useCalendar(days[0], addDays(days[days.length - 1], 1))
  const map = items ? byDay(items) : null
  const now = today()
  const showsToday = days.includes(now) && (view === 'week' || day.slice(0, 7) === now.slice(0, 7))
  const grid = wide && !(width > 0 && width < GRID_MIN_PX)
  const unfold = view === 'week' && unfoldWeek === days[0]
  const monthChips = wide && !(width > 0 && width < MONTH_CHIPS_MIN_PX)

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
    const foldable = (d: string) => d !== now && quietClosed(d, m.get(d) ?? [])
    for (let n = 0; n < days.length; n++) {
      const d = days[n]
      const list = m.get(d) ?? []
      let usually = false
      if (foldable(d) && (n === 0 || !foldable(days[n - 1]))) {
        // A run of closed weekdays with nothing on: one row with a Show pill (today never folds).
        let last = n
        while (last + 1 < days.length && foldable(days[last + 1])) last++
        const span = `${shortDay(d)}${last > n ? `–${shortDay(days[last])}` : ''}`
        out.push(
          <div key={`fold-${d}`} className="adm-foldrow">
            <span>Closed {span}</span>
            <button
              type="button"
              className="adm-foldpill"
              aria-expanded={unfold}
              onClick={() => setUnfoldWeek(unfold ? null : days[0])}
            >
              {unfold ? `Hide ${span}` : `Show ${span}`} <i className="adm-chevron" aria-hidden="true" />
            </button>
          </div>,
        )
        if (!unfold) { n = last; continue }
      }
      if (foldable(d)) usually = true
      out.push(
        <section key={d} aria-label={dayLabel(d)}>
          <div className="adm-dayh">
            <h3 className={d === now ? 'is-today' : undefined}>{dayLabel(d)}{d === now ? ' · Today' : ''}</h3>
            <button type="button" className="adm-plus" aria-label={`Add on ${dayLabel(d)}`} onClick={() => openDay(d)}>+</button>
          </div>
          {(usually || (d === now && quietClosed(d, list))) && <p className="adm-usually">Usually closed</p>}
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
        </>
      )}
      {map && view === 'week' && grid && (
        <div
          className="adm-wgrid"
          style={{ gridTemplateColumns: days.map((d) => (quietClosed(d, map.get(d) ?? []) ? 'minmax(0, 0.5fr)' : 'minmax(0, 1fr)')).join(' ') }}
        >
          {days.map((d) => {
            const [wd, , date] = dayLabel(d).split(' ')
            const list = map.get(d) ?? []
            const shut = quietClosed(d, list)
            return (
              <section key={d} aria-label={dayLabel(d)} className={`adm-wcol${d === now ? ' is-today' : ''}`}>
                <h3 className={`adm-wh${d === now ? ' is-today' : ''}`}>
                  <span>{wd} {date}</span>
                  <button type="button" className="adm-plus" aria-label={`Add on ${dayLabel(d)}`} onClick={() => openDay(d)}>+</button>
                </h3>
                {shut && <p className="adm-usually">Usually closed</p>}
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
              const shown = list.filter((i) => i.kind !== 'closed')
              const inMonth = d.slice(0, 7) === day.slice(0, 7)
              const closure = closureOn(d)
              const shut = !closure && quietClosed(d, list)
              const things = shown.length === 1 ? '1 thing on' : `${shown.length} things on`
              const active = !!activeToken && (activeToken === `day-${d}` || list.some((i) => isActive(i, d)))
              const label = closure
                ? `${dayLabel(d)}, closed for ${closure.name}${shown.length ? `; ${things}: ${shown.map(itemName).join(', ')}` : ''}`
                : shut
                  ? `${dayLabel(d)}, usually closed`
                  : `${dayLabel(d)}, ${things}${shown.length ? `: ${shown.map(itemName).join(', ')}` : ''}`
              return (
                <button
                  key={d}
                  type="button"
                  className={`adm-mday${inMonth ? '' : ' is-out'}${d === now ? ' is-today' : ''}${shut ? ' is-shut' : ''}${closure ? ` is-holiday h-${closure.holiday ?? 'none'}` : ''}${active ? ' is-active' : ''}`}
                  aria-label={label}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => openDay(d)}
                >
                  <span>{Number(d.slice(8))}</span>
                  {/* Small cells (phone, beside a panel) say "Closed"; the colour says which holiday and the name is in the label and the sheet. */}
                  {closure && <span className="adm-hname" aria-hidden="true">{monthChips ? closureShort(closure) : 'Closed'}</span>}
                  {shown.length > 0 && !wide && <span className="adm-n" aria-hidden="true">{shown.length}</span>}
                  {shown.length > 0 && wide && !monthChips && (
                    <span className="adm-dots" aria-hidden="true">
                      {shown.slice(0, 4).map((i) => <i key={itemKey(i)} className={KIND_STYLE[i.kind].className} />)}
                      <b>{shown.length}</b>
                    </span>
                  )}
                  {shown.length > 0 && monthChips && shown.slice(0, 3).map((i) => (
                    <span key={itemKey(i)} className={`adm-mi ${KIND_STYLE[i.kind].className}`} aria-hidden="true">{itemName(i)}</span>
                  ))}
                  {monthChips && shown.length > 3 && <span className="adm-mi" aria-hidden="true">+{shown.length - 3} more</span>}
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
