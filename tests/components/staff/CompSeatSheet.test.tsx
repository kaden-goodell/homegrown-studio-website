import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CompSeatSheet from '@components/staff/CompSeatSheet'

const event = { id: 'SCHED123', title: 'Pumpkins', day: '2026-10-20' }
const options = [{ id: 'color', label: 'Pumpkin color', choices: ['Orange', 'White'] }] as any

function fill() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Ada' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Lovelace' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@x.com' } })
}

/** Crew I6: a comp says why. Types one (unless already typed), then taps Add comped seat. */
function addComped() {
  const r = screen.queryByLabelText('Why is it comped?') as HTMLInputElement | null
  if (r && !r.value) fireEvent.change(r, { target: { value: 'Birthday guest' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add comped seat' }))
}

describe('CompSeatSheet', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('is one step: no Square link until the site’s Square sign-in turns out expired', () => {
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('link', { name: 'Open this class in Square' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add comped seat' })).toBeTruthy()
  })

  it('falls back to Square’s screen when the sign-in expired, then records with alreadyInSquare', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: 'square_signed_out', error: 'The site’s Square sign-in has expired.' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'comp_1', emailSent: true, seats: 1 } }) })
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={event} options={[]} onRecorded={onRecorded} onClose={() => {}} />)
    fill()
    addComped()
    const a = await screen.findByRole('link', { name: 'Open this class in Square' })
    expect(a.getAttribute('href')).toBe('https://app.squareup.com/dashboard/appointments/calendar/classes/SCHED123?date=2026-10-20&view=week')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(onRecorded).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I added them in Square' }))
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).alreadyInSquare).toBe(true)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).alreadyInSquare).toBeUndefined()
    expect(screen.getByText(/^Recorded\. They’ll get the usual confirmation email\./)).toBeTruthy()
  })

  it('shows Square’s partial-add warning on success', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'clsbk_1', emailSent: true, seats: 1, warning: 'Square added 1 of 2 seats, then stopped.' } }) })
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    fill()
    addComped()
    expect((await screen.findByRole('alert')).textContent).toMatch(/added 1 of 2 seats/)
  })

  it('shows the server error when a pick is missing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Pick a Pumpkin color for seat 1.' }) })
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={event} options={options} onRecorded={onRecorded} onClose={() => {}} />)
    fill()
    addComped()
    expect((await screen.findByRole('alert')).textContent).toBe('Pick a Pumpkin color for seat 1.')
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it('posts picks per seat and calls onRecorded on 200', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'b1', emailSent: true } }) })
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={event} options={options} onRecorded={onRecorded} onClose={() => {}} />)
    fill()
    fireEvent.change(screen.getByLabelText('Seat 1 · Pumpkin color'), { target: { value: 'Orange' } })
    addComped()
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ scheduleId: 'SCHED123', email: 'ada@x.com', seats: 1, picks: [{ seat: 1, optionId: 'color', choice: 'Orange' }] })
    expect(screen.getByText(/Added in Square, no charge\. They’ll get the usual confirmation email\./)).toBeTruthy()
  })

  it('lets the seats field be cleared and retyped, and clamps it on leaving', () => {
    render(<CompSeatSheet event={event} options={options} onRecorded={() => {}} onClose={() => {}} />)
    const seats = screen.getByLabelText('Seats') as HTMLInputElement
    fireEvent.change(seats, { target: { value: '' } })
    expect(seats.value).toBe('')
    fireEvent.change(seats, { target: { value: '3' } })
    expect(screen.getByLabelText('Seat 3 · Pumpkin color')).toBeTruthy()
    fireEvent.change(seats, { target: { value: '' } })
    fireEvent.blur(seats)
    expect(seats.value).toBe('1')
  })

  it('marks name and email required', () => {
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    for (const l of ['First name', 'Last name', 'Email']) expect((screen.getByLabelText(l) as HTMLInputElement).required).toBe(true)
    expect((screen.getByLabelText('Phone (optional)') as HTMLInputElement).required).toBe(false)
  })

  it('Sell a seat: says the price, sends payAtRegister, then says what to take at the register', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'clsbk_1', emailSent: true, seats: 1, dueCents: 2500 } }) })
    render(<CompSeatSheet mode="sell" priceCents={2500} event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Sell a seat' }).textContent).toContain('($25 each)')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Add seat, pay at register' }))
    const box = await screen.findByTestId('take-payment')
    expect(box.textContent).toBe('Now take $25 at the registerIn Square, open Pumpkins, tap Ada Lovelace, then Take payment.')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payAtRegister).toBe(true)
  })

  it('a walk-in with no waiver: the done screen leads to signing on this iPad (M7), and says why email is asked', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'clsbk_1', emailSent: false, seats: 1, dueCents: 2500 } }) })
    render(<CompSeatSheet mode="sell" priceCents={2500} event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('For their receipt and waiver.')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Add seat, pay at register' }))
    const next = await screen.findByTestId('sign-next')
    expect(next).toHaveTextContent('No waiver on file for Ada Lovelace yet.')
    const replace = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, replace }, writable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Now sign the waiver on this iPad' }))
    expect(replace).toHaveBeenCalledWith(`/waiver?kiosk=1&workshop=SCHED123&return=${encodeURIComponent('/staff?open=workshop:SCHED123')}`)
  })
})

describe('CompSeatSheet — find a customer, then who’s coming', () => {
  const fetchMock = vi.fn()
  const ASH = { id: 'C1', givenName: 'Ashley', familyName: 'Singleton', email: 'ash@x.com', phone: '+12519794753' }
  const HOUSE = { recordId: 'wvr_ash', status: 'ok', people: [
    { id: 'adult', name: 'Ashley Singleton', adult: true },
    { id: 'child:0', name: 'Flynn', adult: false },
    { id: 'child:1', name: 'Rowan', adult: false },
  ] }
  const answer = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => ({ data }) })
  function routes(household: unknown) {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') return answer({ bookingId: 'clsbk_1', emailSent: true, seats: 2 })
      if (url.includes('?q=')) return answer([ASH])
      return answer({ customer: ASH, household })
    })
  }
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  async function findAshley() {
    fireEvent.change(screen.getByLabelText('Find a customer'), { target: { value: 'sing' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ashley Singleton/ }))
    await screen.findByTestId('picked-customer')
  }

  it('lists matches with the last 4 of the phone, and fills the person in on a tap', async () => {
    routes(null)
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    await findAshley()
    expect(screen.getByTestId('picked-customer')).toHaveTextContent('ash@x.com · ••4753')
    expect(screen.queryByLabelText('First name')).toBeNull()
    expect(screen.getByText('No waiver on file yet, so they’ll sign at the door.')).toBeInTheDocument()
    expect(screen.getByLabelText('Seats')).toBeInTheDocument()
  })

  it('with a waiver in date, seats whoever is ticked plus named guests, picks per person', async () => {
    routes(HOUSE)
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={event} options={options} onRecorded={onRecorded} onClose={() => {}} />)
    await findAshley()
    expect(screen.queryByLabelText('Seats')).toBeNull()
    fireEvent.click(screen.getByLabelText('Rowan'))
    fireEvent.click(screen.getByLabelText('Flynn'))
    fireEvent.click(screen.getByRole('button', { name: '+ Add someone not on the waiver' }))
    fireEvent.change(screen.getByLabelText('Name of guest 1'), { target: { value: 'Sam Lee' } })
    fireEvent.change(screen.getByLabelText('Flynn · Pumpkin color'), { target: { value: 'White' } })
    fireEvent.change(screen.getByLabelText('Rowan · Pumpkin color'), { target: { value: 'Orange' } })
    fireEvent.change(screen.getByLabelText('Sam Lee · Pumpkin color'), { target: { value: 'Orange' } })
    addComped()
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    const sent = JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1].body)
    expect(sent).toMatchObject({
      customerId: 'C1', waiverId: 'wvr_ash', people: ['child:0', 'child:1'], guests: ['Sam Lee'], seats: 3,
      givenName: 'Ashley', familyName: 'Singleton', email: 'ash@x.com',
      picks: [
        { seat: 1, optionId: 'color', choice: 'White' },
        { seat: 2, optionId: 'color', choice: 'Orange' },
        { seat: 3, optionId: 'color', choice: 'Orange' },
      ],
    })
  })

  it('a pick stays with its person when someone else is ticked', async () => {
    routes(HOUSE)
    render(<CompSeatSheet event={event} options={options} onRecorded={() => {}} onClose={() => {}} />)
    await findAshley()
    fireEvent.click(screen.getByLabelText('Flynn'))
    fireEvent.change(screen.getByLabelText('Flynn · Pumpkin color'), { target: { value: 'White' } })
    fireEvent.click(screen.getByLabelText('Ashley Singleton (adult)'))
    expect(screen.getByLabelText('Flynn · Pumpkin color')).toHaveValue('White')
    expect(screen.getByLabelText('Ashley Singleton · Pumpkin color')).toHaveValue('')
  })

  it('says to pick someone before sending, and a lapsed waiver falls back to Seats', async () => {
    routes(HOUSE)
    const { unmount } = render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    await findAshley()
    addComped()
    expect(await screen.findByText('Pick who’s coming.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
    unmount()
    routes({ ...HOUSE, status: 'expired' })
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    await findAshley()
    expect(screen.getByText('Their waiver is out of date, so they’ll sign again at the door.')).toBeInTheDocument()
    expect(screen.getByLabelText('Seats')).toBeInTheDocument()
  })

  it('“Not them” goes back to typing someone new', async () => {
    routes(null)
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    await findAshley()
    fireEvent.click(screen.getByRole('button', { name: 'Not them' }))
    expect(screen.getByLabelText('First name')).toHaveValue('')
    expect(screen.getByLabelText('Find a customer')).toHaveValue('')
  })
})

describe('CompSeatSheet — the confirmation email', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('is off unless ticked, and the done screen says no email went', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'b1', emailSent: false, seats: 1 } }) })
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    expect(screen.getByLabelText('Email them a confirmation')).not.toBeChecked()
    fill()
    addComped()
    expect(await screen.findByText(/Added in Square, no charge\. No email sent\./)).toBeTruthy()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).sendEmail).toBe(false)
  })

  it('sends it when ticked', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'b1', emailSent: true, seats: 1 } }) })
    render(<CompSeatSheet event={event} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    fill()
    fireEvent.click(screen.getByLabelText('Email them a confirmation'))
    addComped()
    await waitFor(() => expect(JSON.parse(fetchMock.mock.calls[0][1].body).sendEmail).toBe(true))
  })
})

describe('CompSeatSheet on our own classes (Task 14)', () => {
  const fetchMock = vi.fn()
  afterEach(() => vi.unstubAllGlobals())
  const own = {
    classId: 'cls_camp', taxPercent: 9, instructor: null, questions: [{ id: 'glaze', label: 'Glaze', choices: ['Blue', 'Green'] }], addOns: [],
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
    prices: { all: { adult: 9000, kid: 6000 }, day: { adult: 3500, kid: 2500 } },
    sessions: [
      { id: 'ses_tue', startIso: '2026-10-20T15:00:00.000Z', endIso: '2026-10-20T17:00:00.000Z', left: 0, closed: false },
      { id: 'ses_wed', startIso: '2026-10-21T15:00:00.000Z', endIso: '2026-10-21T17:00:00.000Z', left: 2, closed: false },
    ],
    passes: [
      { id: 'all', label: 'All days', covers: { kind: 'all' }, sessionIds: [], state: 'closed', left: 0 },
      { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 }, sessionIds: null, state: 'open', left: 2 },
    ],
  }
  const workshop = { id: 'cls_camp', name: 'Clay Camp', description: '', category: 'workshop', date: '2026-10-20', startTime: '', endTime: '', duration: 120, price: 2500, currency: 'USD', taxPercent: 9, remainingSeats: 2, signupClosed: false, own }
  const ownEvent = { id: 'cls_camp', title: 'Clay Camp', day: '2026-10-20', own: true as const }
  beforeEach(() => {
    fetchMock.mockReset()
    readerInfo = { on: false, linked: true, message: null }
    vi.stubGlobal('fetch', fetchMock)
    // The sessions are Oct 20 and 21: pin the clock before them so the counter quote never ages out (only Date is faked).
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00.000Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  /** Charge on the reader, as GET /api/staff/reader.json answers it (off unless a test says otherwise). */
  let readerInfo: { on: boolean; linked: boolean; message: string | null } = { on: false, linked: true, message: null }
  function serveClass(...replies: any[]) {
    fetchMock.mockImplementation(async (url: string, init?: any) => {
      if (String(url).startsWith('/api/staff/class.json')) return { ok: true, status: 200, json: async () => ({ workshop }) }
      if (String(url) === '/api/staff/reader.json' && !init?.method) return { ok: true, status: 200, json: async () => ({ data: readerInfo }) }
      const r = replies.shift()
      return r ?? { ok: true, status: 200, json: async () => ({ data: { bookingId: 'bkg_1', emailSent: false, seats: 1 } }) }
    })
  }

  const compCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/staff/comp-seat.json')

  it('comp: never pre-ticks a full day; picks option, day and typed seats, then writes to the class (no Square)', async () => {
    serveClass()
    const onRecorded = vi.fn()
    render(<CompSeatSheet event={ownEvent} options={own.questions as any} onRecorded={onRecorded} onClose={() => {}} />)
    await screen.findByTestId('own-pickers')
    expect(screen.queryByRole('radio', { name: /All days/ })).toBeNull() // closed options aren't offered
    const tue = screen.getByRole('checkbox', { name: /Tue, Oct 20/ }) as HTMLInputElement
    expect(tue.checked).toBe(false) // the roster's day is full: never pre-ticked
    expect(tue.parentElement).toHaveTextContent('Full')
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    fill()
    fireEvent.change(screen.getByLabelText('Adult seats'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Kid seats'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/Kid 1 · Glaze/), { target: { value: 'Green' } })
    addComped()
    await waitFor(() => expect(onRecorded).toHaveBeenCalled())
    expect(JSON.parse(compCalls()[0][1].body)).toMatchObject({
      scheduleId: 'cls_camp', passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 0, kid: 1 },
      picks: [{ seat: 1, optionId: 'glaze', choice: 'Green' }], givenName: 'Ada', attempt: expect.any(String),
    })
    expect(screen.getByText(/^Added, no charge\./)).toBeTruthy()
  })

  it('a full day needs Add over capacity ticked; the success screen says how far over', async () => {
    serveClass({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'bkg_1', emailSent: false, seats: 1, overCapacity: true, over: { sold: 3, capacity: 2 } } }) })
    render(<CompSeatSheet event={ownEvent} options={own.questions as any} onRecorded={() => {}} onClose={() => {}} />)
    await screen.findByTestId('own-pickers')
    fireEvent.click(screen.getByRole('checkbox', { name: /Tue, Oct 20/ }))
    fill()
    fireEvent.change(screen.getByLabelText(/Adult 1 · Glaze/), { target: { value: 'Blue' } })
    const add = screen.getByRole('button', { name: 'Add comped seat' })
    expect(add).toBeDisabled()
    expect(screen.getByTestId('comp-hint')).toHaveTextContent('That day is full. Tick Add over capacity to seat them anyway.')
    fireEvent.click(screen.getByLabelText('Add over capacity'))
    expect(add).not.toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why is it comped?'), { target: { value: 'Birthday guest' } })
    fireEvent.click(add)
    expect(await screen.findByText(/^Added over capacity \(3 of 2\)\. Added, no charge\./)).toBeTruthy()
    expect(JSON.parse(compCalls()[0][1].body).overCapacity).toBe(true)
  })

  it('refused as full meanwhile: only Cancel or Add over capacity, no repeat button', async () => {
    serveClass({ ok: false, status: 409, json: async () => ({ code: 'sold_out', error: 'That class is full on Wed, Oct 21.' }) })
    const onClose = vi.fn()
    render(<CompSeatSheet event={ownEvent} options={own.questions as any} onRecorded={() => {}} onClose={onClose} />)
    await screen.findByTestId('own-pickers')
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    fill()
    fireEvent.change(screen.getByLabelText(/Adult 1 · Glaze/), { target: { value: 'Blue' } })
    addComped()
    expect(await screen.findByText('That class is full on Wed, Oct 21.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add comped seat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add over capacity' }))
    await waitFor(() => expect(compCalls()).toHaveLength(2))
    expect(JSON.parse(compCalls()[1][1].body).overCapacity).toBe(true)
  })

  it('with a waiver household, each person gets a ticket (adult, kid) and the seats follow them', async () => {
    serveClass()
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/api/staff/class.json')) return { ok: true, status: 200, json: async () => ({ workshop }) }
      if (u.startsWith('/api/staff/customers.json?q=')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'C1', givenName: 'Ada', familyName: 'Lovelace', email: 'ada@x.com', phone: '' }] }) }
      if (u.startsWith('/api/staff/customers.json?id=')) return { ok: true, status: 200, json: async () => ({ data: { customer: { id: 'C1', givenName: 'Ada', familyName: 'Lovelace', email: 'ada@x.com', phone: '' }, household: { recordId: 'wvr_1', status: 'ok', people: [{ id: 'adult', name: 'Ada Lovelace', adult: true }, { id: 'child:0', name: 'Byron', adult: false }] } } }) }
      return { ok: true, status: 200, json: async () => ({ data: { bookingId: 'b', emailSent: false, seats: 2 } }) }
    })
    render(<CompSeatSheet event={ownEvent} options={own.questions as any} onRecorded={() => {}} onClose={() => {}} />)
    await screen.findByTestId('own-pickers')
    fireEvent.change(screen.getByLabelText('Find a customer'), { target: { value: 'Ada' } })
    fireEvent.click(await screen.findByRole('button', { name: /Ada Lovelace/ }))
    await screen.findByText('Who’s coming')
    fireEvent.click(screen.getByRole('checkbox', { name: /Byron/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Ada Lovelace/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    expect((screen.getByLabelText('Byron', { selector: 'select' }) as HTMLSelectElement).value).toBe('kid')
    // seats in ticket order: the adult first, then the kid
    fireEvent.change(screen.getByLabelText(/Ada Lovelace \(Adult\) · Glaze/), { target: { value: 'Blue' } })
    fireEvent.change(screen.getByLabelText(/Byron \(Kid\) · Glaze/), { target: { value: 'Green' } })
    addComped()
    await waitFor(() => expect(compCalls()).toHaveLength(1))
    expect(JSON.parse(compCalls()[0][1].body)).toMatchObject({
      tickets: { adult: 1, kid: 1 }, people: ['adult', 'child:0'],
      picks: [{ seat: 1, optionId: 'glaze', choice: 'Blue' }, { seat: 2, optionId: 'glaze', choice: 'Green' }],
    })
  })

  it('sell: asks how they pay; at the counter shows the total first, has Back, then says what to ring up', async () => {
    serveClass({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'bkg_2', emailSent: false, seats: 1, dueCents: 3815 } }) })
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay at the counter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Pay at the counter' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    expect(screen.getByTestId('counter-total')).toHaveTextContent('Ring up $38.15 at the counter, tax included.')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Add seat, pay at the counter' }))
    const box = await screen.findByTestId('take-payment')
    expect(box.textContent).toMatch(/Now take \$38\.15 at the counter/)
    expect(box.textContent).toMatch(/Ring up 1 × Adult at the register today to pay for this seat\./)
    expect(JSON.parse(compCalls()[0][1].body).payAtRegister).toBe(true)
  })

  it('sell: Pay on the iPad opens the class checkout in door mode', async () => {
    serveClass()
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay on the iPad' }))
    expect(await screen.findByRole('group', { name: 'Pick a day' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Sell a seat' })).toBeNull()
    // the roster's day starts picked (full: card needs Add over capacity), and Back returns to the pay choice
    expect(screen.getByRole('button', { name: /Tue, Oct 20/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Back/ }))
    expect(await screen.findByRole('button', { name: 'Pay at the counter' })).toBeTruthy()
  })

  const readerCalls = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/staff/reader.json' && c[1]?.method === 'POST')

  it('Charge on the reader is hidden while it’s off', async () => {
    serveClass()
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    await screen.findByRole('button', { name: 'Pay at the counter' })
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === '/api/staff/reader.json')).toBe(true))
    expect(screen.queryByRole('button', { name: 'Charge on the reader' })).toBeNull()
    expect(screen.queryByTestId('reader-not-linked')).toBeNull()
  })

  it('on but not linked to the Square app: a plain sentence, the other two ways still there', async () => {
    readerInfo = { on: true, linked: false, message: 'Charge on the reader isn’t linked to the Square app yet, so it can’t be used. Pay on the iPad and Pay at the counter still work.' }
    serveClass()
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    expect(await screen.findByTestId('reader-not-linked')).toHaveTextContent('Pay on the iPad and Pay at the counter still work.')
    expect(screen.queryByRole('button', { name: 'Charge on the reader' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Pay on the iPad' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pay at the counter' })).toBeTruthy()
  })

  it('Charge on the reader: shows the amount, starts the sale, opens the Square app, then waits with Check again / Let the seat go', async () => {
    readerInfo = { on: true, linked: true, message: null }
    const posUrl = 'square-commerce-v1://payment/create?data=%7B%7D'
    serveClass(
      { ok: true, status: 200, json: async () => ({ data: { bookingId: 'bkg_r1', amountCents: 3815, posUrl } }) },
      { ok: true, status: 200, json: async () => ({ data: { outcome: 'paid', message: 'Paid $38.15 on the reader. Ada is on the class list.' } }) },
    )
    const hrefs: string[] = []
    const loc = window.location
    vi.stubGlobal('location', { ...loc, set href(v: string) { hrefs.push(v) }, get href() { return loc.href } })
    const onRecorded = vi.fn()
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={onRecorded} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Charge on the reader' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    expect(screen.getByTestId('reader-total')).toHaveTextContent('$38.15 on the reader, tax included.')
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Charge $38.15 on the reader' }))
    expect(await screen.findByTestId('reader-waiting')).toHaveTextContent('Finish the $38.15 payment in the Square app')
    expect(JSON.parse(readerCalls()[0][1].body)).toMatchObject({ action: 'start', classId: 'cls_camp', passId: 'day', sessionIds: ['ses_wed'], tickets: { adult: 1 }, givenName: 'Ada', attempt: expect.any(String) })
    expect(hrefs).toEqual([posUrl])
    expect(onRecorded).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Paid $38.15 on the reader. Ada is on the class list.')).toBeTruthy()
    expect(JSON.parse(readerCalls()[1][1].body)).toEqual({ action: 'check', bookingId: 'bkg_r1' })
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
  })

  it('Charge on the reader: the Square app didn’t open → plain help to check the app and sign-in', async () => {
    readerInfo = { on: true, linked: true, message: null }
    serveClass({ ok: true, status: 200, json: async () => ({ data: { bookingId: 'bkg_r2', amountCents: 3815, posUrl: 'square-commerce-v1://payment/create?data=x' } }) })
    vi.stubGlobal('location', { ...window.location, set href(_v: string) { /* the app isn't there: nothing happens */ }, get href() { return '' } })
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Charge on the reader' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    fill()
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    fireEvent.click(screen.getByRole('button', { name: /on the reader$/ }))
    await vi.waitFor(() => expect(readerCalls()).toHaveLength(1))
    await vi.waitFor(() => expect(screen.getByTestId('reader-waiting')).toBeTruthy())
    vi.advanceTimersByTime(3000)
    vi.useRealTimers()
    expect(await screen.findByTestId('reader-no-app')).toHaveTextContent('Check that the Square Point of Sale app is on this iPad and signed in to the studio’s account')
  })

  it('R33: no joining partway and the class has started: says so, offers nothing the server would refuse', async () => {
    const closed = { ...workshop, own: { ...own, rules: { ...own.rules, joinPartway: false }, passes: own.passes.map((p) => ({ ...p, state: 'closed' })), sessions: own.sessions.map((x) => ({ ...x, closed: true })) } }
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ workshop: closed }) }))
    render(<CompSeatSheet mode="sell" event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    expect(await screen.findByTestId('signups-closed')).toHaveTextContent('Sign-ups for this class closed when it started. Ask Catherine or Kaden to turn on joining partway.')
    expect(screen.queryByRole('button', { name: 'Pay on the iPad' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pay at the counter' })).toBeNull()
  })

  it('N3/m2: after a failed try, fixing a typo keeps the attempt; changing the day makes a new one', async () => {
    serveClass({ ok: false, status: 503, json: async () => ({ error: 'Couldn’t record that seat — please try again.' }) }, { ok: false, status: 503, json: async () => ({ error: 'again' }) }, { ok: false, status: 503, json: async () => ({ error: 'again' }) })
    render(<CompSeatSheet event={ownEvent} options={[]} onRecorded={() => {}} onClose={() => {}} />)
    await screen.findByTestId('own-pickers')
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    fill()
    addComped()
    await screen.findByText(/please try again/)
    addComped()
    await waitFor(() => expect(compCalls()).toHaveLength(2))
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Grace' } })
    addComped()
    await waitFor(() => expect(compCalls()).toHaveLength(3))
    fireEvent.click(screen.getByRole('checkbox', { name: /Wed, Oct 21/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Tue, Oct 20/ }))
    fireEvent.click(screen.getByLabelText('Add over capacity'))
    addComped()
    await waitFor(() => expect(compCalls()).toHaveLength(4))
    const tokens = compCalls().map((c) => JSON.parse(c[1].body).attempt)
    expect(tokens[1]).toBe(tokens[0])
    expect(tokens[2]).toBe(tokens[0]) // a name typo fixed: same add
    expect(tokens[3]).not.toBe(tokens[0]) // another day: a new add
  })
})
