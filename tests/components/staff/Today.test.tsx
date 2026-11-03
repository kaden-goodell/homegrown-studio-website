/** Today: the Craft Café row (on café days) opens the day's list; the events below are booked ones only. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@components/staff/StaffHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }))
vi.mock('@components/staff/WarningsPanel', () => ({ default: () => null }))
vi.mock('@components/staff/EventList', () => ({ default: () => <p>events</p> }))
import Today from '@components/staff/Today'

const STAFF = { id: 't', name: 'Test', role: 'crew' } as const
const day = (hours: { opens: string; closes: string } | null, count = 0) => ({
  ok: true,
  json: async () => ({ data: { date: '2026-11-07', count, cafe: !!hours, hours, isToday: true, totals: { households: 1, people: count, adults: 1, kids: count - 1 }, entries: [], waiting: [] } }),
})

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-07T16:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Today: Craft Café', () => {
  it('a café day: one tappable row with the hours and how many are here; tap for the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => day({ opens: '09:00', closes: '13:00' }, 3)))
    render(<Today staff={STAFF} onOpenRoster={() => {}} />)
    const row = await screen.findByRole('button', { name: /Craft Café 9 AM – 1 PM, 3 here/ })
    fireEvent.click(row)
    expect(await screen.findByRole('dialog', { name: /Craft Café/ })).toBeInTheDocument()
  })

  it('not a café day (closed on /admin): no row', async () => {
    const f = vi.fn(async () => day(null))
    vi.stubGlobal('fetch', f)
    render(<Today staff={STAFF} onOpenRoster={() => {}} />)
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    await screen.findByText('events')
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Craft Café/ })).toBeNull())
  })
})
