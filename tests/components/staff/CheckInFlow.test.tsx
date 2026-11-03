import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CheckInFlow from '@components/staff/CheckInFlow'

const party = { kind: 'party' as const, id: 'p1', title: 'Rivera party', startIso: '2026-11-08T19:00:00Z' }
const klass = { kind: 'workshop' as const, id: 'clssch_a', title: 'Fall Earring Bar', startIso: '2026-11-08T23:00:00Z' }

describe('CheckInFlow', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); sessionStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  it('lists today’s events, and Craft Café only on café days', () => {
    const { rerender } = render(<CheckInFlow todayEvents={[party, klass]} cafeOpen={false} />)
    expect(screen.getByRole('button', { name: /Rivera party/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Fall Earring Bar/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Craft Café/ })).toBeNull()
    rerender(<CheckInFlow todayEvents={[party]} cafeOpen />)
    expect(screen.getByRole('button', { name: /Craft Café \(walk-in\)/ })).toBeTruthy()
  })

  it('a day with nothing on and no Craft Café: no walk-in check-in, and how to get one', () => {
    render(<CheckInFlow todayEvents={[]} cafeOpen={false} />)
    expect(screen.getByText(/Nothing on today/)).toHaveTextContent('Walk-ins are checked in on Craft Café days only — ask Catherine or Kaden to add a special day.')
    expect(screen.queryByRole('button', { name: /walk-in/i })).toBeNull()
  })

  it('a chosen class adds the found family to that class, then points at Sell a seat', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/staff/rsvp.json')) return { ok: true, json: async () => ({ data: {} }) }
      return {
        ok: true,
        json: async () => ({ data: { households: [{ recordId: 'wvr_1', firstName: 'Kaden', lastName: 'Goodell', contactHint: '2907', signedAt: '2026-10-09T00:00:00Z', agreementVersion: 'v1', validUntil: '2027-10-09T00:00:00Z', covered: true, kids: [], adultAllergies: '', photoConsent: true, openStudioToday: false }] } }),
      }
    })
    const onCheckedIn = vi.fn()
    render(<CheckInFlow todayEvents={[klass]} cafeOpen={false} onCheckedIn={onCheckedIn} />)
    fireEvent.click(screen.getByRole('button', { name: /Fall Earring Bar/ }))
    fireEvent.change(screen.getByPlaceholderText(/Phone, email or last name/), { target: { value: 'Goodell' } })
    fireEvent.click(await screen.findByRole('button', { name: '✓ Add & mark here' }))
    expect(await screen.findByRole('status')).toHaveTextContent('On the Fall Earring Bar roster and marked here')
    expect(screen.getByText(/Sell a seat/)).toBeTruthy()
    const rsvpCall = fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/api/staff/rsvp.json'))!
    expect(JSON.parse(rsvpCall[1].body)).toMatchObject({ kind: 'workshop', id: 'clssch_a', recordId: 'wvr_1' })
    expect(onCheckedIn).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check in someone else' }))
    expect(screen.getByText('What are they here for?')).toBeTruthy()
  })

  it('Craft Café: find a family and check them in, or start a new family on the waiver (no waiver, no check-in)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/staff/open-studio.json')) return { ok: true, json: async () => ({ data: { ok: true } }) }
      return { ok: true, json: async () => ({ data: { households: [{ recordId: 'wvr_1', firstName: 'Jane', lastName: 'Doe', contactHint: '0142', signedAt: '2026-10-09T00:00:00Z', agreementVersion: 'v3', validUntil: '2027-10-09T00:00:00Z', covered: true, kids: [{ name: 'Mia Doe', allergies: '' }], adultAllergies: '', photoConsent: true, openStudioToday: false }] } }) }
    })
    const onCheckedIn = vi.fn()
    render(<CheckInFlow todayEvents={[party]} cafeOpen onCheckedIn={onCheckedIn} />)
    fireEvent.click(screen.getByRole('button', { name: /Craft Café \(walk-in\)/ }))
    expect(screen.getByRole('button', { name: '✍️ New family? Get them signed' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Phone, email or last name/), { target: { value: 'Doe' } })
    fireEvent.click(await screen.findByRole('button', { name: '✓ Here for Craft Café' }))
    await waitFor(() => expect(onCheckedIn).toHaveBeenCalled())
    const post = fetchMock.mock.calls.find((c) => String(c[0]).startsWith('/api/staff/open-studio.json'))!
    expect(JSON.parse(post[1].body)).toEqual({ recordId: 'wvr_1', personIds: ['adult', 'child:0'] })
  })
})
