import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import CalendarView, { KIND_STYLE } from '@components/admin/classes/CalendarView'
import { localToUtcISO } from '@lib/party-slots'
import { ShellContext } from '@components/admin/shell/data'

const DAY = '2031-03-12' // Wednesday
const at = (hhmm: string, day = DAY) => localToUtcISO(day, hhmm)
const items = [
  { kind: 'class', id: 'cls_a', sessionId: 'ses_a', label: 'Pottery', startIso: at('10:00'), endIso: at('11:30'), status: 'open', booked: 5, capacity: 12 },
  { kind: 'class', id: 'cls_b', sessionId: 'ses_b', label: 'Candles', startIso: at('12:00'), endIso: at('13:00'), status: 'draft', booked: 0, capacity: 8 },
  { kind: 'legacy-class', id: 'clssch_1', label: 'Old Square Class', startIso: at('13:00'), endIso: at('14:00') },
  { kind: 'party', id: 'bk_1', label: 'the Sam party', startIso: at('15:00'), endIso: at('17:00'), guests: 14 },
  { kind: 'cafe', id: 'cafe-x', label: 'Craft Café', startIso: at('09:00'), endIso: at('12:30') },
  { kind: 'blocked', id: 'blk_1', label: 'Deep clean', startIso: at('18:00'), endIso: at('19:00') },
  { kind: 'blocked', id: 'blk_2', label: 'Painting', startIso: at('09:00', '2031-03-13'), endIso: at('10:00', '2031-03-13') },
  { kind: 'closed', id: 'closed-x', label: 'Closed for Thanksgiving', startIso: at('00:00'), endIso: at('00:00', '2031-03-13') },
]
const NAMES: Record<string, RegExp> = {
  cls_a: /Pottery/, cls_b: /Candles/, clssch_1: /Old Square Class/, bk_1: /The Sam party/, 'cafe-x': /Craft Café/,
  blk_1: /Blocked · Deep clean/, blk_2: /Blocked · Painting/, 'closed-x': /Closed for Thanksgiving/,
}
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
function server(list: any[] = items) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/admin/classes/calendar.json')) return ok({ data: { items: list } })
    throw new Error(`unexpected ${url}`)
  })
}
const wide = (on: boolean) => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: on, addEventListener: () => {}, removeEventListener: () => {} })))
afterEach(() => vi.unstubAllGlobals())

describe('CalendarView', () => {
  it('asks for the Monday-to-Sunday week around the day, and shows each kind in its colour with what it is', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
    await screen.findByRole('button', { name: /Pottery/ })
    const url = new URL(fetchMock.mock.calls[0][0], 'https://x.test')
    expect(url.searchParams.get('from')).toBe(localToUtcISO('2031-03-10', '00:00'))
    expect(url.searchParams.get('to')).toBe(localToUtcISO('2031-03-17', '00:00'))
    expect(screen.getByText('Week of Mar 10')).toBeInTheDocument()
    for (const it of items) {
      const el = screen.getByRole('button', { name: NAMES[it.id] })
      expect(el).toHaveAttribute('data-kind', it.kind)
      expect(el).toHaveClass(KIND_STYLE[it.kind as keyof typeof KIND_STYLE].className)
    }
    expect(screen.getByRole('button', { name: /Pottery/ })).toHaveTextContent('5 of 12 booked')
    expect(screen.getByRole('button', { name: /Candles/ })).toHaveTextContent('Draft')
    expect(screen.getByRole('button', { name: /The Sam party/ })).toHaveTextContent('14 guests')
    expect(screen.getByRole('button', { name: /Closed for Thanksgiving/ })).toHaveTextContent('All day')
  })

  it('every item opens its own sheet, with the item handed over', async () => {
    vi.stubGlobal('fetch', server())
    const onOpen = vi.fn()
    render(<CalendarView initialDay={DAY} onOpen={onOpen} />)
    const tap = async (name: RegExp) => { fireEvent.click(await screen.findByRole('button', { name })); return onOpen.mock.calls[onOpen.mock.calls.length - 1] }
    expect((await tap(/Pottery/))[0]).toEqual({ kind: 'class', id: 'cls_a' })
    expect((await tap(/Old Square Class/))[0]).toEqual({ kind: 'legacy', day: DAY, id: 'clssch_1' })
    const party = await tap(/The Sam party/)
    expect(party[0]).toEqual({ kind: 'party', day: DAY, id: 'bk_1' })
    expect(party[1]).toMatchObject({ id: 'bk_1', guests: 14 })
    expect((await tap(/Deep clean/))[0]).toEqual({ kind: 'blocked', day: DAY, id: 'blk_1' })
    expect((await tap(/Craft Café/))[0]).toEqual({ kind: 'cafe', day: DAY })
    expect((await tap(/Closed for Thanksgiving/))[0]).toEqual({ kind: 'closed', day: DAY })
  })

  it('the + on a day, or an empty day, opens that day', async () => {
    vi.stubGlobal('fetch', server())
    const onOpen = vi.fn()
    render(<CalendarView initialDay={DAY} onOpen={onOpen} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add on Wed Mar 12' }))
    expect(onOpen).toHaveBeenLastCalledWith({ kind: 'day', day: DAY })
    const fri = screen.getByRole('region', { name: 'Fri Mar 14' })
    fireEvent.click(within(fri).getByRole('button', { name: /Nothing on this day/ }))
    expect(onOpen).toHaveBeenLastCalledWith({ kind: 'day', day: '2031-03-14' })
  })

  it('‹ › move a week; Today shows when the week is not this one', async () => {
    const fetchMock = server([])
    vi.stubGlobal('fetch', fetchMock)
    render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
    await screen.findByText('Week of Mar 10')
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await screen.findByText('Week of Mar 17')
    expect(new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0], 'https://x.test').searchParams.get('from')).toBe(localToUtcISO('2031-03-17', '00:00'))
    fireEvent.click(screen.getByRole('button', { name: 'Last week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Last week' }))
    await screen.findByText('Week of Mar 3')
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument()
  })

  it('month view: whole weeks from Monday, a text count per day, and a day opens its sheet', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    const onOpen = vi.fn()
    render(<CalendarView initialDay={DAY} onOpen={onOpen} />)
    await screen.findByRole('button', { name: /Pottery/ })
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await screen.findByText('March 2031')
    const last = new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0], 'https://x.test')
    expect(last.searchParams.get('from')).toBe(localToUtcISO('2031-02-24', '00:00'))
    const cell = await screen.findByRole('button', { name: /^Wed Mar 12, 6 things on: Craft Café, Pottery/ })
    expect(cell).toHaveTextContent('6')
    expect(screen.getByRole('button', { name: 'Fri Mar 14, 0 things on' })).toBeInTheDocument()
    fireEvent.click(cell)
    expect(onOpen).toHaveBeenLastCalledWith({ kind: 'day', day: DAY })
  })

  it('on an iPad the week is seven columns of chips, and month cells show what is on', async () => {
    wide(true)
    vi.stubGlobal('fetch', server())
    render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
    const wed = await screen.findByRole('region', { name: 'Wed Mar 12' })
    expect(wed).toHaveClass('adm-wcol')
    expect(within(wed).getByRole('button', { name: /Pottery/ })).toHaveClass('adm-chip')
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    const cell = await screen.findByRole('button', { name: /^Wed Mar 12, 6 things on/ })
    expect(cell).toHaveTextContent('Craft Café')
    expect(cell).toHaveTextContent('Pottery')
    expect(cell).toHaveTextContent('+3 more')
  })

  it('the colours fold away behind Key', async () => {
    vi.stubGlobal('fetch', server())
    render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
    await screen.findByRole('button', { name: /Pottery/ })
    const key = screen.getByText('Key').closest('details')!
    expect(key).not.toHaveAttribute('open')
    expect(within(key).getByRole('list', { name: 'Colours' })).toHaveTextContent('Square class')
  })

  it('a failed load says so in place and Try again loads again', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "The calendar couldn't be loaded. Try again." }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
    expect(await screen.findByText("The calendar couldn't be loaded. Try again.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText("The calendar couldn't be loaded. Try again.")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  describe('fix round 1', () => {
    const width = (px: number) => Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px })
    afterEach(() => { delete (HTMLElement.prototype as any).clientWidth })

    it('beside a side panel, or on iPad portrait, where seven columns would be under 720px, the week is a day list and the open item stays highlighted', async () => {
      wide(true)
      width(708)
      vi.stubGlobal('fetch', server())
      render(
        <ShellContext.Provider value={{ paneled: true, activeToken: `party-${DAY}-bk_1` }}>
          <CalendarView initialDay={DAY} onOpen={() => {}} />
        </ShellContext.Provider>,
      )
      const party = await screen.findByRole('button', { name: /The Sam party/ })
      expect(party).toHaveClass('adm-row')
      expect(party).toHaveClass('is-active')
      expect(party).toHaveAttribute('aria-current', 'true')
      expect(document.querySelector('.adm-wgrid')).toBeNull()
      expect(screen.getByRole('button', { name: /Pottery/ })).not.toHaveClass('is-active')
    })

    it('wide enough (720px+, iPad landscape), the seven columns come back (they never scroll sideways: see layout-css.test)', async () => {
      wide(true)
      width(756)
      vi.stubGlobal('fetch', server())
      render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
      expect(await screen.findByRole('button', { name: /Pottery/ })).toHaveClass('adm-chip')
      expect(screen.getByRole('button', { name: /Pottery/ })).toHaveAttribute('title', expect.stringContaining('Pottery'))
      expect(screen.getByRole('region', { name: 'Wed Mar 12' }).querySelector('h3')).toHaveTextContent('Wed 12')
    })

    it('closed weekdays with nothing on fold into one row, which opens them back up', async () => {
      vi.stubGlobal('fetch', server())
      render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
      const fold = await screen.findByRole('button', { name: /Show Mon–Tue/ })
      expect(fold).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region', { name: 'Mon Mar 10' })).toBeNull()
      fireEvent.click(fold)
      expect(fold).toHaveAttribute('aria-expanded', 'true')
      expect(fold).toHaveTextContent('Hide Mon–Tue')
      expect(screen.getByRole('region', { name: 'Mon Mar 10' })).toHaveTextContent('Usually closed')
      expect(screen.getByRole('region', { name: 'Tue Mar 11' })).toBeInTheDocument()
      // Another week starts folded again.
      fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
      expect(await screen.findByRole('button', { name: /Show Mon–Wed/ })).toHaveAttribute('aria-expanded', 'false')
    })

    it('month: a usual closed weekday is a quiet shaded cell with no word; a named closure shows its name', async () => {
      vi.stubGlobal('fetch', server([]))
      render(<CalendarView initialDay="2026-10-14" onOpen={() => {}} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
      const mon = await screen.findByRole('button', { name: 'Mon Oct 19, usually closed' })
      expect(mon).toHaveClass('is-shut')
      expect(mon.textContent).toBe('19')
      const fri = screen.getByRole('button', { name: 'Fri Oct 30, closed for Halloween weekend' })
      expect(fri).toHaveClass('is-holiday', 'h-halloween')
      expect(fri).toHaveTextContent('Halloween')
      expect(screen.getByRole('button', { name: 'Thu Oct 22, 0 things on' })).not.toHaveClass('is-shut')
    })

    it('today never folds, even on a closed weekday', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2031-03-10T15:00:00Z'))
      vi.stubGlobal('fetch', server([]))
      render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
      const mon = await screen.findByRole('region', { name: 'Mon Mar 10' })
      expect(mon).toHaveTextContent('Today')
      expect(mon).toHaveTextContent('Usually closed')
      expect(screen.getByRole('button', { name: /Show Tue–Wed/ })).toBeInTheDocument()
      vi.useRealTimers()
    })

    it('iPad month beside a panel: dots and a count, and the open day is marked', async () => {
      wide(true)
      width(400)
      vi.stubGlobal('fetch', server())
      render(
        <ShellContext.Provider value={{ paneled: true, activeToken: `day-${DAY}` }}>
          <CalendarView initialDay={DAY} onOpen={() => {}} />
        </ShellContext.Provider>,
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
      const cell = await screen.findByRole('button', { name: /^Wed Mar 12, 6 things on/ })
      expect(cell).toHaveClass('is-active')
      expect(cell.querySelectorAll('.adm-dots i')).toHaveLength(4)
      expect(cell.querySelector('.adm-dots b')).toHaveTextContent('6')
      expect(cell.querySelector('.adm-mi')).toBeNull()
    })

    it('the week grid gives a shut, empty day a half-width column marked Usually closed', async () => {
      wide(true)
      width(1000)
      vi.stubGlobal('fetch', server())
      render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
      await screen.findByRole('button', { name: /Pottery/ })
      const grid = document.querySelector<HTMLElement>('.adm-wgrid')!
      expect(grid.style.gridTemplateColumns.split(/\)\s+/)[0]).toContain('0.5fr')
      expect(screen.getByRole('region', { name: 'Mon Mar 10' })).toHaveTextContent('Usually closed')
      expect(screen.getByRole('region', { name: 'Wed Mar 12' })).not.toHaveTextContent('Usually closed')
    })

    it('times are one line: one format, a no-break space before AM/PM', async () => {
      vi.stubGlobal('fetch', server())
      render(<CalendarView initialDay={DAY} onOpen={() => {}} />)
      const row = await screen.findByRole('button', { name: /Pottery/ })
      expect(row.querySelector('.adm-rt')!.textContent).toBe('10–11:30\u00a0AM')
      expect(screen.getByRole('button', { name: /Craft Café/ }).querySelector('.adm-rt')!.textContent).toBe('9\u00a0AM–12:30\u00a0PM')
      expect(row.querySelector('br')).toBeNull()
    })
  })
})
