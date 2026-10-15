import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

vi.mock('@components/staff/StaffHeader', () => ({ default: ({ title }: { title: string }) => <h1>{title}</h1> }))
import ThisWeek from '@components/staff/ThisWeek'

const STAFF = { id: 't', name: 'Test', role: 'crew' } as const
const serve = (events: any[], ok = true) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => (ok ? { data: { events } } : { error: 'Couldn’t reach storage — check wifi and try again.' }) }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z')) // Thu Oct 15
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const pails = { kind: 'workshop', id: 'c1', title: 'Bedazzled Pumpkin Pails', startIso: '2026-10-18T18:00:00Z', days: ['2026-10-18'], dropOff: true, sold: 4,
  prep: [{ id: 'pumpkin-color', label: 'Pumpkin color', counts: [{ choice: 'Lavender', n: 2 }, { choice: 'Black', n: 1 }], unpicked: 1 }] }
const party = { kind: 'party', id: 'p1', title: 'Rivera Party', startIso: '2026-10-17T18:30:00Z', days: ['2026-10-17'], dropOff: false, guests: 12 }

describe('This week (staff landing tab)', () => {
  it('today first even when empty, then only days with something on, each with what to prep', async () => {
    serve([pails, party])
    render(<ThisWeek staff={STAFF} onOpenRoster={() => {}} />)
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByText('Nothing scheduled')).toBeInTheDocument()
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Today', 'Sat Oct 17', 'Sun Oct 18'])
    expect(within(screen.getByRole('region', { name: 'Sat Oct 17' })).getByText('12 guests')).toBeInTheDocument()
    const sun = screen.getByRole('region', { name: 'Sun Oct 18' })
    expect(within(sun).getByText('4 seats booked')).toBeInTheDocument()
    expect(within(sun).getByText('DROP-OFF')).toBeInTheDocument()
    expect(within(sun).getByTestId('week-prep')).toHaveTextContent('PREPLavender 2 · Black 1 · 1 no pick yet')
    expect(screen.getByText('2 events in the next 7 days · 1 with picks to prep')).toBeInTheDocument()
  })

  it('a Craft Café day shows its hours (the Nov 7 grand opening runs all day)', async () => {
    vi.setSystemTime(new Date('2026-11-05T15:00:00Z'))
    serve([])
    render(<ThisWeek staff={STAFF} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Sat Nov 7' })
    expect(within(sat).getByText('☕ Craft Café 9 AM – 9 PM')).toBeInTheDocument()
  })

  it('tapping a class opens its roster', async () => {
    serve([pails])
    const open = vi.fn()
    render(<ThisWeek staff={STAFF} onOpenRoster={open} />)
    fireEvent.click(await screen.findByRole('button', { name: /Bedazzled Pumpkin Pails/ }))
    expect(open).toHaveBeenCalledWith({ kind: 'workshop', id: 'c1', title: 'Bedazzled Pumpkin Pails' })
  })

  it('says when nothing is booked, and offers Retry on a failure', async () => {
    serve([])
    const { unmount } = render(<ThisWeek staff={STAFF} onOpenRoster={() => {}} />)
    expect(await screen.findByText('Nothing booked in the next 7 days.')).toBeInTheDocument()
    unmount()
    serve([], false)
    render(<ThisWeek staff={STAFF} onOpenRoster={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
