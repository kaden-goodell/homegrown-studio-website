/**
 * Craft Café on /staff: the tappable row, the day's sheet (who's here,
 * totals, Undo, Waiting on a waiver) and Add someone (a family on file, or a
 * new family on the iPad / by text / by QR).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { CafeRow, CraftCafeSheet, totalsLine } from '@components/staff/CraftCafe'
import type { HouseholdMatch } from '@components/staff/DoorSearch'

const qrSpy = vi.hoisted(() => vi.fn(async () => '<svg></svg>'))
vi.mock('qrcode', () => ({ default: { toString: qrSpy } }))

const TODAY = '2026-11-07'
const jane: HouseholdMatch = {
  recordId: 'wvr_kim', firstName: 'Kim', lastName: 'Lee', contactHint: '••• 0199', signedAt: '2026-11-07T15:05:00.000Z',
  agreementVersion: 'v3', validUntil: '2027-11-07T00:00:00.000Z', covered: true, kids: [], adultAllergies: '', photoConsent: true, openStudioToday: false,
}
const dayDetail = (over: Record<string, unknown> = {}) => ({
  date: TODAY, count: 3, cafe: true, hours: { opens: '09:00', closes: '13:00' }, isToday: true,
  totals: { households: 1, people: 3, adults: 1, kids: 2 },
  entries: [{ recordId: 'wvr_1', name: 'Jane Doe', people: ['Jane Doe', 'Mia', 'Leo'], at: '2026-11-07T15:10:00.000Z', by: 'Sam', adults: 1, kids: 2 }],
  waiting: [
    { id: 'cw_1', name: 'Kim', how: 'text', at: '2026-11-07T15:00:00.000Z', by: 'Sam', signed: jane },
    { id: 'cw_2', name: 'Bo Park', how: 'qr', at: '2026-11-07T15:02:00.000Z', by: 'Sam', signed: null },
  ],
  ...over,
})

const fetchMock = vi.fn()
const replaceSpy = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  sessionStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-07T16:00:00Z'))
  replaceSpy.mockReset()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace: replaceSpy, search: '' } })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
const calls = (prefix: string) => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(prefix))

describe('CafeRow', () => {
  it('is one tappable row: hours and how many are here', () => {
    const open = vi.fn()
    render(<CafeRow date={TODAY} hours={{ opens: '09:00', closes: '13:00' }} here={6} onOpen={open} />)
    const row = screen.getByRole('button', { name: /Craft Café 9 AM – 1 PM, 6 here/ })
    expect(row).toHaveTextContent('☕ Craft Café 9 AM – 1 PM· 6 here')
    fireEvent.click(row)
    expect(open).toHaveBeenCalled()
  })

  it('leaves the count off when it isn’t known (a day still to come)', () => {
    render(<CafeRow date="2026-11-08" hours={{ opens: '13:00', closes: '15:00' }} onOpen={() => {}} />)
    expect(screen.queryByTestId('cafe-here')).toBeNull()
  })
})

describe('totalsLine', () => {
  it('says people, adults, kids and families in plain words', () => {
    expect(totalsLine({ households: 1, people: 1, adults: 1, kids: 0 })).toBe('1 person · 1 adult · 0 kids · 1 family')
    expect(totalsLine({ households: 2, people: 5, adults: 2, kids: 3 })).toBe('5 people · 2 adults · 3 kids · 2 families')
  })
})

describe('CraftCafeSheet', () => {
  it('lists everyone checked in with totals, who checked them in, and the waiting families', async () => {
    fetchMock.mockResolvedValue(ok(dayDetail()))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    expect(await screen.findByTestId('cafe-totals')).toHaveTextContent('Here today: 3 people · 1 adult · 2 kids · 1 family')
    const entry = screen.getByTestId('cafe-entry')
    expect(entry).toHaveTextContent('Jane Doe')
    expect(entry).toHaveTextContent('Jane Doe, Mia, Leo')
    expect(entry).toHaveTextContent('checked in by Sam')
    const waiting = screen.getByRole('region', { name: 'Waiting on a waiver' })
    expect(within(waiting).getByText('✓ Signed')).toBeInTheDocument()
    expect(within(waiting).getByText('Not signed yet')).toBeInTheDocument()
    expect(within(waiting).getAllByRole('button', { name: 'Check them in' })).toHaveLength(1)
    expect(calls('/api/staff/open-studio.json?date=2026-11-07&detail=1')).toHaveLength(1)
  })

  it('Undo asks in the app, then takes them off (one call, however many taps)', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'DELETE' ? ok({ ok: true }) : ok(dayDetail())))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo Jane Doe’s check-in' }))
    const ask = screen.getByRole('group', { name: 'Take Jane Doe off today’s list?' })
    const yes = within(ask).getByRole('button', { name: 'Take off' })
    fireEvent.click(yes)
    fireEvent.click(yes)
    await waitFor(() => expect(calls('/api/staff/open-studio.json?recordId=wvr_1')).toHaveLength(1))
    expect(calls('/api/staff/open-studio.json?recordId=wvr_1')[0][1]).toMatchObject({ method: 'DELETE' })
  })

  it('Keep closes the question without changing anything', async () => {
    fetchMock.mockResolvedValue(ok(dayDetail()))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo Jane Doe’s check-in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('group', { name: /Take Jane Doe off/ })).toBeNull()
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false)
  })

  it('a signed waiting family: Check them in → pick who → ✓ Here for Craft Café', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'POST' ? ok({ ok: true }) : ok(dayDetail())))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Check them in' }))
    fireEvent.click(await screen.findByRole('button', { name: '✓ Here for Craft Café' }))
    await waitFor(() => expect(calls('/api/staff/open-studio.json').some((c) => c[1]?.method === 'POST')).toBe(true))
    const post = calls('/api/staff/open-studio.json').find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ recordId: 'wvr_kim', personIds: ['adult'], waitingId: 'cw_1' })
  })

  it('a name two signed families share: neither is guessed, the crew are told to search and pick', async () => {
    fetchMock.mockResolvedValue(ok(dayDetail({ waiting: [{ id: 'cw_3', name: 'Smith', how: 'qr', at: '2026-11-07T15:00:00.000Z', by: 'Sam', signed: null, signedMany: 2 }] })))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    expect(await screen.findByTestId('cafe-signed-many')).toHaveTextContent('2 families named Smith have signed. Tap + Add someone and search to pick the right one.')
    expect(screen.queryByRole('button', { name: 'Check them in' })).toBeNull()
  })

  it('a texted family whose text didn’t send says so on their row', async () => {
    fetchMock.mockResolvedValue(ok(dayDetail({ waiting: [{ id: 'cw_4', name: 'Kim', how: 'text', at: '2026-11-07T15:00:00.000Z', by: 'Sam', signed: null, textFailed: true }] })))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    expect(await screen.findByText('The text didn’t send. Text them again, or show them the QR.')).toBeInTheDocument()
  })

  it('Remove takes a family off Waiting on a waiver after asking', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'DELETE' ? ok({ ok: true }) : ok(dayDetail())))
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    await screen.findByText('Bo Park')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1])
    fireEvent.click(within(screen.getByRole('group', { name: 'Take Bo Park off this list?' })).getByRole('button', { name: 'Take off' }))
    await waitFor(() => expect(calls('/api/staff/cafe-waiting.json?id=cw_2')).toHaveLength(1))
  })

  it('a past day: who came, with no Add or Undo', async () => {
    fetchMock.mockResolvedValue(ok(dayDetail({ date: '2026-11-01', isToday: false, waiting: [] })))
    render(<CraftCafeSheet date="2026-11-01" onClose={() => {}} />)
    expect(await screen.findByTestId('cafe-totals')).toHaveTextContent('Came: 3 people')
    expect(screen.getByRole('region', { name: 'Who came' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add someone' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('a day still to come says check-ins open on the day', async () => {
    fetchMock.mockResolvedValue(ok(dayDetail({ date: '2026-11-08', isToday: false, count: 0, totals: { households: 0, people: 0, adults: 0, kids: 0 }, entries: [], waiting: [] })))
    render(<CraftCafeSheet date="2026-11-08" onClose={() => {}} />)
    expect(await screen.findByTestId('cafe-totals')).toHaveTextContent('Check-ins open on the day.')
  })

  it('a failed load says so, with Retry; Escape and ✕ close it', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Couldn’t reach storage — check wifi and try again.' }) }).mockResolvedValue(ok(dayDetail()))
    const close = vi.fn()
    render(<CraftCafeSheet date={TODAY} onClose={close} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t reach storage')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('cafe-totals')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(close).toHaveBeenCalledTimes(2)
  })
})

describe('Add someone (new family)', () => {
  async function openNewFamily() {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/staff/cafe-waiting.json')) return ok({ id: 'cw_new', existing: false, sent: true })
      if (String(url).startsWith('/api/staff/coverage.json')) return ok({ households: [] })
      return ok(dayDetail({ waiting: [] }))
    })
    render(<CraftCafeSheet date={TODAY} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '+ Add someone' }))
  }

  it('not on file → New family, with their typed name carried over', async () => {
    await openNewFamily()
    fireEvent.change(screen.getByPlaceholderText(/Phone, email or last name/), { target: { value: 'Park' } })
    fireEvent.click(await screen.findByRole('button', { name: 'New family — get them signed' }))
    expect(screen.getByLabelText('Their name')).toHaveValue('Park')
  })

  it('Sign on this iPad: puts them on the waiting list, then hands the iPad over, coming back to this sheet', async () => {
    await openNewFamily()
    fireEvent.click(screen.getByRole('button', { name: '✍️ New family? Get them signed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign on this iPad' }))
    await waitFor(() => expect(replaceSpy).toHaveBeenCalled())
    expect(JSON.parse(calls('/api/staff/cafe-waiting.json')[0][1].body)).toEqual({ how: 'ipad', name: '' })
    expect(replaceSpy).toHaveBeenCalledWith(`/waiver?kiosk=1&cafeWaiting=cw_new&return=${encodeURIComponent('/staff?cafe=2026-11-07')}`)
    expect(sessionStorage.getItem('hg_kioskOut')).toBe('1')
  })

  it('Text them the waiver link: needs a name and a mobile, sends once, and says where they went', async () => {
    await openNewFamily()
    fireEvent.click(screen.getByRole('button', { name: '✍️ New family? Get them signed' }))
    const text = screen.getByRole('button', { name: 'Text them the waiver link' })
    expect(text).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Kim Lee' } })
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '(256) 555-0199' } })
    fireEvent.click(text)
    fireEvent.click(text)
    expect(await screen.findByRole('status')).toHaveTextContent('Texted the link. Kim Lee is under Waiting on a waiver')
    expect(calls('/api/staff/cafe-waiting.json')).toHaveLength(1)
    expect(JSON.parse(calls('/api/staff/cafe-waiting.json')[0][1].body)).toEqual({ how: 'text', name: 'Kim Lee', phone: '2565550199' })
  })

  it('a retry after a failed text: “Already texted” only when it went', async () => {
    await openNewFamily()
    let n = 0
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/staff/cafe-waiting.json')) return ok(++n === 1 ? { id: 'cw_new', existing: false, sent: false } : n === 2 ? { id: 'cw_new', existing: true, sent: true } : { id: 'cw_new', existing: true, alreadySent: true })
      return ok(dayDetail({ waiting: [] }))
    })
    fireEvent.click(screen.getByRole('button', { name: '✍️ New family? Get them signed' }))
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Kim Lee' } })
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '2565550199' } })
    const text = screen.getByRole('button', { name: 'Text them the waiver link' })
    fireEvent.click(text)
    expect(await screen.findByRole('alert')).toHaveTextContent('The text didn’t send. Tap Text them the waiver link to try again')
    await waitFor(() => expect(text).not.toBeDisabled())
    fireEvent.click(text)
    expect(await screen.findByRole('status')).toHaveTextContent('✓ Texted the link.')
    fireEvent.click(text)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Already texted.'))
  })

  it('a first name only (no mobile) is warned at the time', async () => {
    await openNewFamily()
    fireEvent.click(screen.getByRole('button', { name: '✍️ New family? Get them signed' }))
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Kim' } })
    expect(screen.getByTestId('cafe-name-hint')).toHaveTextContent('Add a last name or mobile so we can find their waiver.')
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Kim Lee' } })
    expect(screen.queryByTestId('cafe-name-hint')).toBeNull()
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Kim' } })
    fireEvent.change(screen.getByLabelText(/Mobile number/), { target: { value: '2565550199' } })
    expect(screen.queryByTestId('cafe-name-hint')).toBeNull()
  })

  it('Show QR: needs a name, then shows the code', async () => {
    await openNewFamily()
    fireEvent.click(screen.getByRole('button', { name: '✍️ New family? Get them signed' }))
    expect(screen.getByRole('button', { name: 'Show QR' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Their name'), { target: { value: 'Bo Park' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    expect(await screen.findByRole('dialog', { name: 'Scan to sign' })).toBeInTheDocument()
  })
})
