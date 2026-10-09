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
})
