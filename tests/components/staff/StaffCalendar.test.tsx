import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'

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
  { kind: 'closed', id: 'closed-2026-10-18', label: 'Closed', startIso: '2026-10-18T05:00:00.000Z', endIso: '2026-10-19T04:59:59.999Z' },
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
    const sun = screen.getByRole('region', { name: 'Sun Oct 18' })
    expect(within(sun).getByTestId('calendar-item')).toHaveTextContent('All day')
    expect(within(sun).getByTestId('calendar-item').textContent).not.toMatch(/12/)
    fireEvent.click(within(sat).getByRole('button', { name: /Clay Camp/ }))
    expect(open).toHaveBeenCalledWith({ kind: 'workshop', id: 'cls_camp', title: 'Clay Camp', day: '2026-10-17' })
  })

  it('UI review: a party still waiting on its studio fee says "Waiting on payment"; a paid one doesn’t', async () => {
    const two = [
      { kind: 'party', id: 'pty_a', label: 'Tess’s party · Slime', startIso: '2026-10-17T19:00:00.000Z', endIso: '2026-10-17T20:30:00.000Z', pay: 'waiting' },
      { kind: 'party', id: 'pty_b', label: 'Paige’s party · Pots', startIso: '2026-10-17T22:00:00.000Z', endIso: '2026-10-17T23:30:00.000Z', pay: 'paid' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { items: two } }) }))
    render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Sat Oct 17' })
    const [tess, paige] = within(sat).getAllByTestId('calendar-item')
    expect(tess).toHaveTextContent('Waiting on payment')
    expect(paige).not.toHaveTextContent('Waiting on payment')
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

  it("says You're on / You asked on my classes and parties, and one tap asks to work an open one", async () => {
    const calendar = { ok: true, json: async () => ({ data: { items } }) }
    const shifts = {
      ok: true,
      json: async () => ({
        data: {
          me: { id: 't', name: 'Test' },
          mine: [{ event: { key: 'party:bk_1', status: 'on', endIso: items[1].endIso } }],
          open: [{ key: 'ses:ses_1', kind: 'class', title: 'Clay Camp', startIso: items[0].startIso, endIso: items[0].endIso, status: 'on', asked: false, askNote: '', needsSomeone: true }],
        },
      }),
    }
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ data: { key: 'ses:ses_1', asked: true } }) }
      return String(url).startsWith('/api/staff/shifts.json') ? shifts : calendar
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Sat Oct 17' })
    await waitFor(() => expect(within(sat).getByRole('button', { name: /Rivera party/ })).toHaveTextContent('You’re on'))
    const ask = within(sat).getByRole('button', { name: "I'd like to work Clay Camp, Sat Oct 17" })
    expect(ask).toHaveTextContent('Needed')
    fireEvent.click(ask)
    await waitFor(() => expect(within(sat).getByRole('button', { name: /Clay Camp/ })).toHaveTextContent('You asked'))
    expect(within(sat).getByRole('status')).toHaveTextContent('Asked. Catherine and Kaden can see it.')
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1].body)).toEqual({ action: 'ask', key: 'ses:ses_1', note: '', startIso: items[0].startIso })
  })

  it('still works as a plain calendar when My shifts cannot be read', async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).startsWith('/api/staff/shifts.json')
      ? { ok: false, json: async () => ({ error: 'nope' }) }
      : { ok: true, json: async () => ({ data: { items } }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Sat Oct 17' })
    expect(within(sat).getAllByRole('button')).toHaveLength(2)
    expect(sat.textContent).not.toMatch(/You’re on|You asked|like to work/)
  })

  it("switching person (same screen) drops the last person's tags and loads the new person's (I1)", async () => {
    const SAM = { id: 'sam', name: 'Sam', role: 'crew' } as const
    const shiftsFor = (id: string, mine: string[]) => ({ ok: true, json: async () => ({ data: { me: { id, name: id }, mine: mine.map((key) => ({ event: { key, status: 'on', endIso: '2026-10-17T20:30:00.000Z' } })), open: [] } }) })
    const calls: string[] = []
    let current = 't'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/staff/shifts.json')) { calls.push(current); return current === 't' ? shiftsFor('t', ['party:bk_1']) : shiftsFor('sam', []) }
      return { ok: true, json: async () => ({ data: { items } }) }
    }))
    const view = render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Sat Oct 17' })
    await waitFor(() => expect(within(sat).getByRole('button', { name: /Rivera party/ })).toHaveTextContent('You’re on'))
    current = 'sam'
    view.rerender(<StaffCalendar staff={SAM} onOpenRoster={() => {}} />)
    await waitFor(() => expect(calls).toEqual(['t', 'sam']))
    const sat2 = await screen.findByRole('region', { name: 'Sat Oct 17' })
    await waitFor(() => expect(within(sat2).getByRole('button', { name: /Rivera party/ })).not.toHaveTextContent('You’re on'))
  })

  it("a slow reply for the last person (or last week) never paints over the current one (I2)", async () => {
    const SAM = { id: 'sam', name: 'Sam', role: 'crew' } as const
    let releaseT!: (v: unknown) => void
    const tShifts = { ok: true, json: async () => ({ data: { me: { id: 't', name: 'Test' }, mine: [{ event: { key: 'party:bk_1', status: 'on', endIso: '2026-10-17T20:30:00.000Z' } }], open: [] } }) }
    const samShifts = { ok: true, json: async () => ({ data: { me: { id: 'sam', name: 'Sam' }, mine: [], open: [] } }) }
    let n = 0
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).startsWith('/api/staff/shifts.json')) return n++ === 0 ? new Promise((r) => { releaseT = r }) : Promise.resolve(samShifts)
      return Promise.resolve({ ok: true, json: async () => ({ data: { items } }) })
    }))
    const view = render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    view.rerender(<StaffCalendar staff={SAM} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Sat Oct 17' })
    await act(async () => { releaseT(tShifts) })
    expect(within(sat).getByRole('button', { name: /Rivera party/ })).not.toHaveTextContent('You’re on')
  })

  it('a shift of mine that already ended says Worked (m3)', async () => {
    vi.setSystemTime(new Date('2026-10-17T21:00:00Z')) // after the party
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).startsWith('/api/staff/shifts.json')
      ? { ok: true, json: async () => ({ data: { me: { id: 't', name: 'Test' }, mine: [{ event: { key: 'party:bk_1', status: 'on', endIso: items[1].endIso } }], open: [] } }) }
      : { ok: true, json: async () => ({ data: { items } }) })))
    render(<StaffCalendar staff={STAFF} onOpenRoster={() => {}} />)
    const sat = await screen.findByRole('region', { name: 'Today' })
    await waitFor(() => expect(within(sat).getByRole('button', { name: /Rivera party/ })).toHaveTextContent('Worked'))
    expect(within(sat).getByRole('button', { name: /Rivera party/ })).not.toHaveTextContent('You’re on')
  })
})
