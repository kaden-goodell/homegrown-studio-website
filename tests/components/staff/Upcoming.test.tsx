import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Upcoming from '@components/staff/Upcoming'

const row = (id: string, startIso: string) => ({ bookingId: id, craftName: 'Slime', startIso, title: `Party ${id}`, hostName: 'H', hostPhone: null, guestCount: 10, rsvpHouseholds: 0, rsvpPeople: 0, themeName: null })

describe('Upcoming', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T15:00:00Z'))
    history.replaceState(null, '', '/staff')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => String(url).startsWith('/api/staff/parties.json')
        ? { data: { parties: [row('later', '2026-11-08T19:00:00Z'), row('past', '2026-10-03T22:00:00Z'), row('soon', '2026-11-07T19:30:00Z')] } }
        : { data: { events: [], sources: {} } },
    })))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('lists only parties that have not happened, soonest first', async () => {
    render(<Upcoming staff={{ id: 's', name: 'Sam', role: 'crew' }} onOpenRoster={() => {}} />)
    await waitFor(() => expect(screen.getByText('Party soon')).toBeTruthy())
    expect(screen.queryByText('Party past')).toBeNull()
    const titles = screen.getAllByText(/^Party /).map((n) => n.textContent)
    expect(titles).toEqual(['Party soon', 'Party later'])
  })
})
