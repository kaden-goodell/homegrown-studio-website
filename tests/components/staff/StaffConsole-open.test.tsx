/**
 * `/staff?open={kind}:{id}` — where the kiosk returns after signing for an
 * event: straight to that roster, then the param is stripped.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import StaffConsole from '@components/staff/StaffConsole'

const EVENT = { kind: 'party', id: 'p1', title: 'Rivera Party', startIso: '2026-09-29T19:00:00.000Z', days: ['2026-09-29'], dropOff: false }

function serve() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    const href = String(url)
    if (href.includes('/api/staff/me.json')) return { ok: true, status: 200, json: async () => ({ data: { staff: { id: 't', name: 'Test', role: 'crew' } } }) } as Response
    if (href.includes('/api/staff/roster.json')) {
      return { ok: true, json: async () => ({ data: { event: EVENT, day: '2026-09-29', summary: { households: 0, people: 0, childrenHereNow: 0 }, households: [] } }) } as Response
    }
    if (href.includes('/api/staff/incidents.json')) return { ok: true, json: async () => ({ data: { incidents: [] } }) } as Response
    return { ok: true, json: async () => ({ data: { events: [], sources: {}, count: 0, parties: [] } }) } as Response
  })
}

afterEach(() => { vi.restoreAllMocks(); history.replaceState(null, '', '/') })

describe('StaffConsole ?open=', () => {
  it('goes straight to that roster and strips the param', async () => {
    history.replaceState(null, '', '/staff?open=party:p1&keep=1')
    const fetchSpy = serve()
    render(<StaffConsole />)

    await screen.findByText(/Rivera Party/)
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/api/staff/roster.json?kind=party&id=p1'))).toBe(true)
    expect(window.location.search).toBe('?keep=1')
    expect(screen.getByRole('button', { name: '+ Add family' })).toBeInTheDocument()
  })

  it('without the param it lands on Today', async () => {
    history.replaceState(null, '', '/staff')
    serve()
    render(<StaffConsole />)
    await screen.findByText(/Today ·/)
  })

  it('ignores a malformed open value (lands on Today, still strips it)', async () => {
    history.replaceState(null, '', '/staff?open=program:zzz')
    serve()
    render(<StaffConsole />)
    await screen.findByText(/Today ·/)
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it.each(['party:../../x', 'program:abc', 'party:a/b', 'party:'])('ignores open=%s (lands on Today, strips it)', async (v) => {
    history.replaceState(null, '', `/staff?open=${v}`)
    serve()
    render(<StaffConsole />)
    await screen.findByText(/Today ·/)
    await waitFor(() => expect(window.location.search).toBe(''))
  })
})
