/**
 * More › Print schedule: the window schedule. Pick a look, what to show and
 * the week; see it; print it. Letter pages, from the public calendar.
 */
import { useEffect, useRef, useState } from 'react'
import { addDays, LAYOUTS, MAX_DAYS, mondayOf, SHOWS, type PrintLayout, type PrintShow } from '@lib/print-schedule'
import { today } from '../classes/dates'
import { Seg } from '../shell/items'
import { SheetFrame } from '../shell/Sheet'

type When = 'this' | 'next' | 'pick'

/** The address of the printable page for these choices. */
export function printScheduleHref(o: { from: string; days: number; layout: PrintLayout; show: PrintShow; print?: boolean }): string {
  const q = new URLSearchParams({ from: o.from, days: String(o.days), layout: o.layout, show: o.show })
  if (o.print) q.set('print', '1')
  return `/admin/print-schedule?${q}`
}

export function PrintScheduleSheet() {
  const thisMon = mondayOf(today())
  const [layout, setLayout] = useState<PrintLayout>('list')
  const [show, setShow] = useState<PrintShow>('full')
  const [when, setWhen] = useState<When>('next')
  const [picked, setPicked] = useState(addDays(thisMon, 7))
  const [days, setDays] = useState(7)
  const from = when === 'this' ? thisMon : when === 'next' ? addDays(thisMon, 7) : picked
  const href = printScheduleHref({ from, days, layout, show })

  // The preview is the real page, shrunk to the sheet's width.
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / 816))
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  const pages = Math.ceil(days / 7)

  return (
    <SheetFrame tall title="Print schedule" subtitle="A schedule for the window, from what’s on the website">
      <div className="adm-fld">
        <span>Look</span>
        <Seg label="Look" value={layout} onChange={setLayout} options={LAYOUTS.map((l) => [l.id, l.label])} />
      </div>
      <div className="adm-fld">
        <span>What to show</span>
        <Seg label="What to show" className="is-wrap" value={show} onChange={setShow} options={SHOWS.map((s) => [s.id, s.label])} />
      </div>
      <div className="adm-fld">
        <span>Which week</span>
        <Seg label="Which week" value={when} onChange={setWhen} options={[['this', 'This week'], ['next', 'Next week'], ['pick', 'Pick a day']]} />
      </div>
      {when === 'pick' && (
        <div className="adm-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="adm-fld">
            <span>Starting</span>
            <input type="date" value={picked} onChange={(e) => e.target.value && setPicked(e.target.value)} />
          </label>
          <label className="adm-fld">
            <span>How many days</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {Array.from({ length: MAX_DAYS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 7 ? '7 (a week)' : n === 14 ? '14 (two weeks, two pages)' : n}</option>)}
            </select>
          </label>
        </div>
      )}
      <a className="adm-btn is-primary" style={{ display: 'block', textAlign: 'center', fontSize: 18, padding: '14px 18px', margin: '12px 0' }} href={printScheduleHref({ from, days, layout, show, print: true })} target="_blank" rel="noopener">
        Print{pages > 1 ? ` (${pages} pages)` : ''}
      </a>
      <p className="adm-muted" style={{ margin: '0 0 8px' }}>Letter paper, standing up. If the printer asks, choose “no margins” or 100% size.</p>
      <div ref={box} style={{ width: '100%' }}>
        <div style={{ height: 1056 * scale * pages, overflow: 'hidden', borderRadius: 8, border: '1px solid #e6ddd3' }}>
          <iframe
            key={href}
            src={href}
            title="Preview of the schedule"
            style={{ width: 816, height: 1056 * pages, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', background: '#faf8f5' }}
          />
        </div>
      </div>
    </SheetFrame>
  )
}
