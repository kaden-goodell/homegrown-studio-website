import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import CalendarView, { KIND_STYLE } from '@components/admin/classes/CalendarView'
import { localToUtcISO } from '@lib/party-slots'

const DAY = '2031-03-12' // Wednesday
const at = (hhmm: string, day = DAY) => localToUtcISO(day, hhmm)
const items = [
  { kind: 'class', id: 'cls_a', sessionId: 'ses_a', label: 'Pottery', startIso: at('10:00'), endIso: at('11:30'), status: 'open' },
  { kind: 'class', id: 'cls_b', sessionId: 'ses_b', label: 'Candles', startIso: at('12:00'), endIso: at('13:00'), status: 'draft' },
  { kind: 'legacy-class', id: 'clssch_1', label: 'Old Square Class', startIso: at('13:00'), endIso: at('14:00') },
  { kind: 'party', id: 'bk_1', label: 'Party for Sam', startIso: at('15:00'), endIso: at('17:00') },
  { kind: 'cafe', id: 'cafe-x', label: 'Craft Café', startIso: at('09:00'), endIso: at('12:30') },
  { kind: 'blocked', id: 'blk_1', label: 'Deep clean', startIso: at('18:00'), endIso: at('19:00') },
  { kind: 'closed', id: 'closed-x', label: 'Closed for Thanksgiving', startIso: at('00:00'), endIso: at('00:00', '2031-03-13') },
]
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
function server(list: any[] = items) {
  return vi.fn(async (url: string, init?: any) => {
    if (url.startsWith('/api/admin/classes/calendar.json')) return ok({ data: { items: list } })
    if (url === '/api/admin/classes/blocked.json' && init?.method === 'POST') return ok({ data: { removed: JSON.parse(init.body).id } })
    throw new Error(`unexpected ${url}`)
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('CalendarView', () => {
  it('asks for the week around the day, and shows each kind in its colour', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<CalendarView initialDay={DAY} onOpenClass={() => {}} onPrintDay={() => {}} />)
    await screen.findByRole('button', { name: /Pottery/ })
    const url = new URL(fetchMock.mock.calls[0][0], 'https://x.test')
    expect(url.searchParams.get('from')).toBe(localToUtcISO('2031-03-09', '00:00'))
    expect(url.searchParams.get('to')).toBe(localToUtcISO('2031-03-16', '00:00'))
    for (const it of items) {
      const el = screen.getByRole('button', { name: new RegExp(it.label) })
      expect(el).toHaveAttribute('data-kind', it.kind)
      expect(el.style.borderLeft).toContain(KIND_STYLE[it.kind as keyof typeof KIND_STYLE].colour)
    }
    expect(screen.getByRole('button', { name: /Candles/ })).toHaveTextContent('Draft')
  })

  it('our class opens the class; blocked time asks before removing; others show a read-only detail', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    const onOpenClass = vi.fn()
    render(<CalendarView initialDay={DAY} onOpenClass={onOpenClass} onPrintDay={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Pottery/ }))
    expect(onOpenClass).toHaveBeenCalledWith('cls_a')

    fireEvent.click(screen.getByRole('button', { name: /Party for Sam/ }))
    const detail = screen.getByRole('region', { name: 'Party for Sam' })
    expect(within(detail).getByText('Party')).toBeInTheDocument()
    expect(within(detail).queryByRole('button', { name: /Remove/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Deep clean/ }))
    const block = screen.getByRole('region', { name: 'Deep clean' })
    fireEvent.click(within(block).getByRole('button', { name: 'Remove this blocked time' }))
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
    fireEvent.click(within(block).getByRole('button', { name: 'Yes, remove it' }))
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'remove', id: 'blk_1' })
  })

  it('month view lists the month and a day opens its items', async () => {
    const fetchMock = server()
    vi.stubGlobal('fetch', fetchMock)
    render(<CalendarView initialDay={DAY} onOpenClass={() => {}} onPrintDay={() => {}} />)
    await screen.findByRole('button', { name: /Pottery/ })
    fireEvent.click(screen.getByRole('button', { name: 'Month' }))
    await screen.findByText('March 2031')
    const last = new URL(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0], 'https://x.test')
    expect(last.searchParams.get('from')).toBe(localToUtcISO('2031-02-23', '00:00'))
    fireEvent.click(screen.getByRole('button', { name: /^Wed Mar 12/ }))
    expect(await screen.findByRole('button', { name: /Pottery/ })).toBeInTheDocument()
  })

  it('print day hands the day up', async () => {
    vi.stubGlobal('fetch', server())
    const onPrintDay = vi.fn()
    render(<CalendarView initialDay={DAY} onOpenClass={() => {}} onPrintDay={onPrintDay} />)
    await screen.findByRole('button', { name: /Pottery/ })
    fireEvent.click(screen.getByRole('button', { name: 'Print Wed Mar 12' }))
    expect(onPrintDay).toHaveBeenCalledWith(DAY)
  })

  it('a failed load says so and offers a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({ error: "The calendar couldn't be loaded. Try again." }) })))
    render(<CalendarView initialDay={DAY} onOpenClass={() => {}} onPrintDay={() => {}} />)
    expect(await screen.findByText("The calendar couldn't be loaded. Try again.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
