import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('@components/staff/StaffHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }))
import StaffCalendar from '@components/staff/StaffCalendar'

const STAFF = { id: 't', name: 'Test', role: 'crew' } as const
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z')) // Thu Oct 15
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const items = [
  { kind: 'class', id: 'cls_camp', label: 'Clay Camp', startIso: '2026-10-17T15:00:00.000Z', endIso: '2026-10-17T17:00:00.000Z', sessionId: 'ses_1', status: 'open' },
  { kind: 'party', id: 'bk_1', label: 'Rivera party', startIso: '2026-10-17T19:00:00.000Z', endIso: '2026-10-17T20:30:00.000Z' },
  { kind: 'cafe', id: 'cafe-2026-10-17', label: 'Craft Café', startIso: '2026-10-17T14:00:00.000Z', endIso: '2026-10-17T17:30:00.000Z' },
]

describe('StaffCalendar (crew, read-only)', () => {
  it('shows the week from Monday, everything on each day, and opens a class roster on that day', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { items } }) })
    vi.stubGlobal('fetch', fetchMock)
    const open = vi.fn()
    render(<StaffCalendar staff={STAFF} onOpenRoster={open} />)
    const sat = await screen.findByRole('region', { name: 'Sat Oct 17' })
    expect(within(sat).getAllByTestId('calendar-item').map((x) => x.textContent)).toEqual([
      expect.stringContaining('Craft Café'), expect.stringContaining('Clay Camp'), expect.stringContaining('Rivera party'),
    ])
    expect(String(fetchMock.mock.calls[0][0])).toContain('from=2026-10-12T05%3A00%3A00.000Z')
    // Craft Café is not a button: nothing to open, nothing to edit
    expect(within(sat).getAllByRole('button')).toHaveLength(2)
    fireEvent.click(within(sat).getByRole('button', { name: /Clay Camp/ }))
    expect(open).toHaveBeenCalledWith({ kind: 'workshop', id: 'cls_camp', title: 'Clay Camp', day: '2026-10-17' })
  })

  it('moves a week at a time and comes back to this week', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { items: [] } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findByRole('region', { name: 'Today' })
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByRole('region', { name: 'Mon Oct 19' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'This week' }))
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument()
  })
})
