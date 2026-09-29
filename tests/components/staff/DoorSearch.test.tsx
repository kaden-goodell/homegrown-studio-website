/**
 * The door search, both modes (one component, one prop):
 *  - walk-in (Today): GOOD TO GO → one `✓ Here` tap; chips for today's events.
 *  - event (roster "+ Add family"): GOOD TO GO → `✓ Add & mark here`;
 *    EXPIRED / NOT ON FILE → Show QR (event link) + Sign on this iPad (event
 *    deep link, returning to that roster).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import DoorSearch, { type HouseholdMatch, type TodayEvent } from '@components/staff/DoorSearch'
import { SITE_URL } from '@config/site-url'

const qrSpy = vi.hoisted(() => vi.fn(async () => '<svg></svg>'))
vi.mock('qrcode', () => ({ default: { toString: qrSpy } }))

const sam = (over: Partial<HouseholdMatch> = {}): HouseholdMatch => ({
  recordId: 'wvr_9', firstName: 'Sam', lastName: 'Lee', contactHint: '••• 0142',
  signedAt: '2026-08-01T00:00:00.000Z', agreementVersion: 'v3', validUntil: '2027-08-01T00:00:00.000Z',
  covered: true, kids: [{ name: 'Mia Lee', allergies: '' }, { name: 'Noah Lee', allergies: '' }],
  adultAllergies: '', photoConsent: true, openStudioToday: false, ...over,
})

let fetchMock: ReturnType<typeof vi.spyOn>
function serve(households: HouseholdMatch[], post: any = { data: { ok: true } }) {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
    if (String(url).includes('/api/staff/coverage.json')) return { ok: true, json: async () => ({ data: { households } }) } as Response
    return { ok: true, json: async () => post } as Response
  })
}
const posts = () => fetchMock.mock.calls.filter(([, init]: any[]) => (init as RequestInit | undefined)?.method === 'POST')
const search = (q: string) => fireEvent.change(screen.getByPlaceholderText('Phone, email or last name'), { target: { value: q } })

const camp = { kind: 'workshop' as const, id: 'cs-camp', title: 'Fall Camp', day: '2026-10-20' }
const events: TodayEvent[] = [
  { kind: 'party', id: 'p1', title: 'Rivera Party', startIso: '2026-09-29T19:00:00.000Z', rsvpWaiverIds: [] },
  { kind: 'workshop', id: 'ws1', title: 'Slime Night', startIso: '2026-09-29T23:00:00.000Z', rsvpWaiverIds: ['wvr_9'] },
]

beforeEach(() => { sessionStorage.clear(); qrSpy.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

describe('DoorSearch — walk-in mode (Today)', () => {
  it('one search, one tap: GOOD TO GO shows a single ✓ Here button that logs the visit', async () => {
    serve([sam()])
    const onCheckedIn = vi.fn()
    render(<DoorSearch onCheckedIn={onCheckedIn} />)
    search('lee')
    await screen.findByText(/GOOD TO GO — Sam Lee/)
    expect(screen.queryByText(/Check in to Open Studio|Check in again/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '✓ Here' }))
    await waitFor(() => expect(onCheckedIn).toHaveBeenCalled())
    const [url, init] = posts()[0] as [string, RequestInit]
    expect(url).toBe('/api/staff/open-studio.json')
    expect(JSON.parse(init.body as string)).toEqual({ recordId: 'wvr_9', personIds: ['adult', 'child:0', 'child:1'] })
    expect(screen.getByText(/✓ Here today · \d{1,2}:\d{2}\s?[AP]M/)).toBeInTheDocument()
  })

  it('a household already logged today shows ✓ Here today · <time> on arrival', async () => {
    serve([sam({ openStudioToday: true, openStudioAt: '2026-09-29T21:12:00.000Z' })])
    render(<DoorSearch onCheckedIn={vi.fn()} />)
    search('lee')
    expect(await screen.findByText(/✓ Here today · 4:12 PM/)).toBeInTheDocument()
  })

  it('no events today → no "Here for an event?" row', async () => {
    serve([sam()])
    render(<DoorSearch onCheckedIn={vi.fn()} todayEvents={[]} onAddToEvent={vi.fn()} />)
    search('lee')
    await screen.findByText(/GOOD TO GO/)
    expect(screen.queryByText(/Here for an event/)).not.toBeInTheDocument()
  })

  it('today\'s events show as chips; tapping one hands the household to that event; their own RSVP is highlighted', async () => {
    serve([sam()])
    const onAddToEvent = vi.fn()
    render(<DoorSearch onCheckedIn={vi.fn()} todayEvents={events} onAddToEvent={onAddToEvent} />)
    search('lee')
    await screen.findByText(/Here for an event\?/)

    const party = screen.getByRole('button', { name: /Rivera Party/ })
    const slime = screen.getByRole('button', { name: /Slime Night/ })
    expect(slime.style.background).toContain('primary') // RSVP'd → highlighted
    expect(party.style.background).not.toContain('primary')

    fireEvent.click(party)
    expect(onAddToEvent).toHaveBeenCalledWith(events[0], expect.objectContaining({ recordId: 'wvr_9', firstName: 'Sam' }))
    expect(posts()).toHaveLength(0) // choosing a chip is not a check-in by itself
  })

  it('expired: Show QR + Sign on this iPad go to the general agreement (no event)', async () => {
    serve([sam({ covered: false })])
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
    render(<DoorSearch onCheckedIn={vi.fn()} />)
    search('lee')
    await screen.findByText(/EXPIRED — Sam Lee/)
    fireEvent.click(screen.getByRole('button', { name: 'Sign on this iPad' }))
    expect(assign).toHaveBeenCalledWith('/waiver?kiosk=1&return=/staff')
  })
})

describe('DoorSearch — event mode (+ Add family)', () => {
  it('GOOD TO GO → ✓ Add & mark here posts the ticked people to rsvp.json', async () => {
    serve([sam()], { data: { rsvpId: 'r1', day: '2026-10-20', presence: {} } })
    const onAdded = vi.fn()
    render(<DoorSearch mode="event" event={camp} onAdded={onAdded} todayEvents={events} />)
    search('lee')
    await screen.findByText(/GOOD TO GO — Sam Lee/)
    expect(screen.queryByText(/Here for an event/)).not.toBeInTheDocument() // chips are walk-in only

    fireEvent.click(screen.getAllByRole('checkbox')[0]) // untick the adult
    fireEvent.click(screen.getByRole('button', { name: '✓ Add & mark here' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ oneTimeCode: undefined, smsFailed: undefined }))
    const [url, init] = posts()[0] as [string, RequestInit]
    expect(url).toBe('/api/staff/rsvp.json')
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'workshop', id: 'cs-camp', recordId: 'wvr_9', attending: ['child:0', 'child:1'], day: '2026-10-20' })
  })

  it('passes the drop-off pickup code back to the caller', async () => {
    serve([sam()], { data: { oneTimeCode: '4821' } })
    const onAdded = vi.fn()
    render(<DoorSearch mode="event" event={camp} onAdded={onAdded} />)
    search('lee')
    await screen.findByText(/GOOD TO GO/)
    fireEvent.click(screen.getByRole('button', { name: '✓ Add & mark here' }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ oneTimeCode: '4821' })))
  })

  it('a server refusal is shown, and nothing is reported as added', async () => {
    serve([sam()])
    fetchMock.mockImplementation(async (url: any) =>
      String(url).includes('coverage')
        ? ({ ok: true, json: async () => ({ data: { households: [sam()] } }) } as Response)
        : ({ ok: false, json: async () => ({ error: 'Couldn’t confirm this event — refresh the roster and try again.' }) } as Response))
    const onAdded = vi.fn()
    render(<DoorSearch mode="event" event={camp} onAdded={onAdded} />)
    search('lee')
    await screen.findByText(/GOOD TO GO/)
    fireEvent.click(screen.getByRole('button', { name: '✓ Add & mark here' }))
    expect(await screen.findByText(/Couldn’t confirm this event/)).toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('NOT ON FILE → Show QR (the event link) and Sign on this iPad (event deep link + return to the roster)', async () => {
    serve([])
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
    render(<DoorSearch mode="event" event={camp} onAdded={vi.fn()} />)
    search('nobody')
    await screen.findByText(/NOT ON FILE for “nobody”/)

    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    await waitFor(() => expect(qrSpy).toHaveBeenCalledWith(`${SITE_URL}/waiver?workshop=cs-camp`, expect.anything()))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign on this iPad' }))
    expect(assign).toHaveBeenCalledWith(`/waiver?kiosk=1&workshop=cs-camp&return=${encodeURIComponent('/staff?open=workshop:cs-camp')}`)
  })

  it('EXPIRED gets the same two buttons', async () => {
    serve([sam({ covered: false })])
    render(<DoorSearch mode="event" event={{ kind: 'party', id: 'p1', title: 'Rivera Party' }} onAdded={vi.fn()} />)
    search('lee')
    await screen.findByText(/EXPIRED — Sam Lee/)
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    await waitFor(() => expect(qrSpy).toHaveBeenCalledWith(`${SITE_URL}/waiver?party=p1`, expect.anything()))
  })

  it('does not restore the last walk-in name into the sheet', async () => {
    sessionStorage.setItem('hg_lastDoorQuery', 'previous person')
    serve([])
    render(<DoorSearch mode="event" event={camp} onAdded={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 50))
    expect((screen.getByPlaceholderText('Phone, email or last name') as HTMLInputElement).value).toBe('')
  })
})
