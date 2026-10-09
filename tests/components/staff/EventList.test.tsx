import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EventList from '@components/staff/EventList'

const TODAY = '2026-10-16'
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => ({ data: { events: [], sources: {}, asked: url } }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  history.replaceState(null, '', '/staff')
})
afterEach(() => vi.unstubAllGlobals())

const dates = () => fetchMock.mock.calls.map((c) => new URL(c[0], 'http://x').searchParams.get('date'))

describe('EventList day in the address', () => {
  it('starts on today with no ?day, and stepping writes it', async () => {
    render(<EventList date={TODAY} onOpenRoster={() => {}} />)
    await waitFor(() => expect(dates()).toEqual([TODAY]))
    expect(window.location.search).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    await waitFor(() => expect(window.location.search).toBe('?day=2026-10-17'))
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('a refresh with ?day lands on that day and still reports today for the door', async () => {
    history.replaceState(null, '', '/staff?day=2026-10-18')
    const onLoaded = vi.fn()
    render(<EventList date={TODAY} onOpenRoster={() => {}} onLoaded={onLoaded} />)
    await waitFor(() => expect(dates()).toEqual(expect.arrayContaining(['2026-10-18', TODAY])))
    // Only today's load reports to the door (the 18th's load never does).
    await waitFor(() => expect(onLoaded).toHaveBeenCalledTimes(1))
    expect(window.location.search).toBe('?day=2026-10-18')
  })

  it('ignores a garbled ?day and keeps other params', async () => {
    history.replaceState(null, '', '/staff?day=nope&x=1')
    render(<EventList date={TODAY} onOpenRoster={() => {}} />)
    await waitFor(() => expect(dates()).toEqual([TODAY]))
    expect(window.location.search).toBe('?x=1')
  })

  it('Today mode: today only, no stepper, ignores and never writes ?day', async () => {
    history.replaceState(null, '', '/staff?day=2026-10-18')
    render(<EventList date={TODAY} stepper={false} onOpenRoster={() => {}} />)
    await waitFor(() => expect(dates()).toEqual([TODAY]))
    expect(screen.queryByRole('button', { name: 'Next day' })).toBeNull()
    expect(screen.getByText(/^Today · /)).toBeTruthy()
  })

  it('Upcoming starts tomorrow when the address has no ?day', async () => {
    render(<EventList date={TODAY} start="2026-10-17" onOpenRoster={() => {}} />)
    await waitFor(() => expect(dates()).toEqual(['2026-10-17']))
    expect(screen.getByText(/^Tomorrow · /)).toBeTruthy()
  })

  it('shows seats sold of capacity on a class row', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ data: { events: [
      { kind: 'workshop', id: 'clssch_a', title: 'Fall Earring Bar', startIso: '2026-10-17T00:00:00Z', days: ['2026-10-16'], dropOff: false, capacity: 35, seats: 23, rsvpCount: 4, hereNow: 0 },
    ], sources: {} } }) }))
    render(<EventList date={TODAY} stepper={false} onOpenRoster={() => {}} />)
    expect(await screen.findByText(/of 35 sold/)).toHaveTextContent('12 of 35 sold')
  })
})
