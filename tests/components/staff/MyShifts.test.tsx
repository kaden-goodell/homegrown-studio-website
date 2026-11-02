import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

vi.mock('@components/staff/StaffHeader', () => ({ default: ({ title }: { title: string }) => <nav>{title}</nav> }))
import MyShifts from '@components/staff/MyShifts'
import { StaffNavContext } from '@components/staff/nav'

const STAFF = { id: 'TM2', name: 'Jessica', role: 'crew' } as const
const avail = { staffId: 'TM2', name: 'Jessica', weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }, dates: {}, updatedAt: null, history: [] }

const ev = (key: string, title: string, startIso: string, over: any = {}) => ({
  key, kind: over.kind ?? 'class', title, startIso, endIso: new Date(Date.parse(startIso) + 2 * 3_600_000).toISOString(),
  status: 'on', openHref: '#x', detail: {}, roster: { kind: over.kind === 'party' ? 'party' : 'workshop', id: over.rosterId ?? 'cls_1', day: startIso.slice(0, 10) }, ...over,
})
const row = (event: any, assigned: { staffId: string; name: string }[]) => ({
  event, entry: { key: event.key, needed: null, assigned: assigned.map((a) => ({ ...a, by: { id: 'o', name: 'Kaden' }, at: 'x', notified: null })), asks: [], seen: null, sequence: 0, updatedAt: 'u', history: [] },
  state: 'staffed', needed: 1, people: [], leftTeam: [],
})

function data(over: any = {}) {
  return {
    me: { id: 'TM2', name: 'Jessica' },
    availability: avail,
    mine: [
      row(ev('ses:a', 'Needlepoint 101', '2026-11-07T16:00:00.000Z', { rosterId: 'cls_np' }), [{ staffId: 'TM2', name: 'Jessica' }, { staffId: 'TM4', name: 'Catherine' }]),
      row(ev('party:pty_1', 'Party · 14 guests', '2026-11-08T19:00:00.000Z', { kind: 'party', rosterId: 'pty_1' }), [{ staffId: 'TM2', name: 'Jessica' }]),
    ],
    open: [
      { ...ev('ses:b', 'Weaving', '2026-11-13T23:00:00.000Z'), asked: false, askNote: '', needsSomeone: true },
      { ...ev('ses:c', 'Pottery', '2026-11-14T16:00:00.000Z'), asked: false, askNote: '', needsSomeone: false },
      { ...ev('ses:d', 'Clay', '2026-11-15T19:00:00.000Z'), asked: true, askNote: 'pick me', needsSomeone: true },
      { ...ev('ses:e', 'Looms', '2026-11-21T16:00:00.000Z', { status: 'cancelled' }), asked: true, askNote: '', needsSomeone: false },
    ],
    feed: { has: false },
    ...over,
  }
}

let fetchMock: ReturnType<typeof vi.fn>
const ok = (d: any) => ({ ok: true, status: 200, json: async () => ({ data: d }) })
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T15:00:00Z'))
  fetchMock = vi.fn().mockResolvedValue(ok(data()))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const posts = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST' || c[1]?.method === 'DELETE')

describe('My shifts', () => {
  it('says whose shifts these are (shared iPad) and lists only what I am on, with who else is on', async () => {
    const switchStaff = vi.fn()
    render(
      <StaffNavContext.Provider value={{ active: 'shifts', go: () => {}, switchStaff, logout: () => {} }}>
        <MyShifts staff={STAFF} onOpenRoster={() => {}} />
      </StaffNavContext.Provider>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Jessica’s shifts' })).toBeInTheDocument()
    const shifts = screen.getAllByTestId('my-shift')
    expect(shifts).toHaveLength(2)
    expect(shifts[0]).toHaveTextContent('Needlepoint 101')
    expect(shifts[0]).toHaveTextContent('With Catherine')
    expect(shifts[0]).toHaveTextContent('You’re on')
    expect(shifts[1]).toHaveTextContent('Just you on this one')
    expect(shifts[1]).toHaveTextContent('Be there 30 minutes before it starts.')
    fireEvent.click(screen.getByRole('button', { name: 'Not Jessica? Switch' }))
    expect(switchStaff).toHaveBeenCalled()
  })

  it('tapping a shift opens its roster on that day', async () => {
    const open = vi.fn()
    render(<MyShifts staff={STAFF} onOpenRoster={open} />)
    fireEvent.click((await screen.findAllByTestId('my-shift'))[0])
    expect(open).toHaveBeenCalledWith({ kind: 'workshop', id: 'cls_np', title: 'Needlepoint 101', day: '2026-11-07' })
  })

  it('Ask to work: needed ones first by default, states in words (Needed, Has enough people, You asked, Cancelled)', async () => {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    let cards = screen.getAllByTestId('open-event')
    // Pottery has enough people: hidden until "Everything"
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Weaving'), expect.stringContaining('Clay'), expect.stringContaining('Looms'),
    ])
    expect(cards[0]).toHaveTextContent('Needed')
    expect(cards[1]).toHaveTextContent('You asked')
    expect(cards[1]).toHaveTextContent('You wrote “pick me”')
    expect(cards[2]).toHaveTextContent('Cancelled')
    fireEvent.click(screen.getByRole('button', { name: 'Everything (4)' }))
    cards = screen.getAllByTestId('open-event')
    expect(cards).toHaveLength(4)
    expect(cards[1]).toHaveTextContent('Has enough people')
  })

  it('one tap asks (with the start as a hint), then a note can be added; taking it back unasks', async () => {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fetchMock.mockResolvedValue(ok({ key: 'ses:b', asked: true }))
    fireEvent.click(screen.getByRole('button', { name: /I'd like to work Weaving/ }))
    const card = () => screen.getAllByTestId('open-event').find((c) => c.textContent!.includes('Weaving'))!
    await waitFor(() => expect(card()).toHaveTextContent('You asked'))
    expect(card()).toHaveTextContent('Asked. Catherine and Kaden can see it.')
    expect(JSON.parse(posts()[0][1].body)).toEqual({ action: 'ask', key: 'ses:b', note: '', startIso: '2026-11-13T23:00:00.000Z' })
    fireEvent.click(within(card()).getByRole('button', { name: 'Add a note' }))
    fireEvent.change(within(card()).getByLabelText('Note for Catherine and Kaden (optional)'), { target: { value: 'I can stay late' } })
    fireEvent.click(within(card()).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(card()).toHaveTextContent('You wrote “I can stay late”'))
    expect(JSON.parse(posts()[1][1].body)).toMatchObject({ action: 'ask', key: 'ses:b', note: 'I can stay late' })
    fetchMock.mockResolvedValue(ok({ key: 'ses:b', asked: false }))
    fireEvent.click(within(card()).getByRole('button', { name: /Take back my ask for Weaving/ }))
    await waitFor(() => expect(within(card()).getByRole('button', { name: /I'd like to work Weaving/ })).toBeInTheDocument())
    expect(JSON.parse(posts()[2][1].body)).toMatchObject({ action: 'unask', key: 'ses:b' })
  })

  it('a refused ask shows the server’s sentence on that card', async () => {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'That one has already happened.' }) })
    fireEvent.click(screen.getByRole('button', { name: /I'd like to work Weaving/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That one has already happened.')
  })

  it('a cancelled ask can be cleared, and then leaves the list', async () => {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fetchMock.mockResolvedValue(ok({ key: 'ses:e', asked: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear my ask' }))
    await waitFor(() => expect(screen.queryByText('Looms')).toBeNull())
  })

  it("an event I said I can't work says so in words", async () => {
    fetchMock.mockResolvedValue(ok(data({ availability: { ...avail, dates: { '2026-11-13': [{ kind: 'cant', range: null, note: '' }] } } })))
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    const weaving = screen.getAllByTestId('open-event').find((c) => c.textContent!.includes('Weaving'))!
    expect(weaving).toHaveTextContent('You said you can’t')
  })

  it('no tab-level crash when the API fails: the sentence and Try again', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: "You're not on the team list any more. Ask an owner." }) })
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent("You're not on the team list any more. Ask an owner.")
    fetchMock.mockResolvedValue(ok(data()))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByTestId('my-shift')).toHaveLength(2)
  })

  it('built for a phone: nothing wider than the screen, every button at least 44 px', async () => {
    const { container } = render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    const root = container.firstElementChild as HTMLElement
    expect(root.style.width).toBe('100%')
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      const w = el.style.width
      if (w.endsWith('px')) expect(parseFloat(w)).toBeLessThanOrEqual(400)
    }
    for (const b of screen.getAllByRole('button')) {
      if (b.dataset.testid === 'my-shift') continue // whole cards
      expect(['2.75rem', '3rem', '3.25rem']).toContain(b.style.minHeight)
    }
  })
})

describe('calendar link', () => {
  it('makes a link: iPhone (webcal) and Android/Google help, Copy; the sheet is a dialog, not a browser pop-up', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fireEvent.click(screen.getByRole('button', { name: 'Add my shifts to my phone' }))
    const dialog = screen.getByRole('dialog', { name: 'My shifts on my phone' })
    fetchMock.mockResolvedValue(ok({ https: 'https://x.test/api/calendar/feed/TOKEN.ics', webcal: 'webcal://x.test/api/calendar/feed/TOKEN.ics' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get my calendar link' }))
    expect(await within(dialog).findByRole('link', { name: 'Add to my iPhone calendar' })).toHaveAttribute('href', 'webcal://x.test/api/calendar/feed/TOKEN.ics')
    expect(dialog).toHaveTextContent('From URL')
    expect(dialog).toHaveTextContent('This link is only shown now.')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy my link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://x.test/api/calendar/feed/TOKEN.ics'))
    expect(await within(dialog).findByText('Copied. Now paste it in Google Calendar.')).toBeInTheDocument()
    expect(posts()[0][0]).toBe('/api/staff/feed.json')
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('with a link already: "Make a new link" asks in the sheet first; Keep my old link does nothing', async () => {
    fetchMock.mockResolvedValue(ok(data({ feed: { has: true } })))
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fireEvent.click(screen.getByRole('button', { name: 'Calendar link settings' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }))
    expect(dialog).toHaveTextContent('Any phone using your old link stops getting updates.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my old link' }))
    expect(posts()).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make a new link' }))
    fetchMock.mockResolvedValue(ok({ https: 'https://x.test/a.ics', webcal: 'webcal://x.test/a.ics' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, make a new link' }))
    expect(await within(dialog).findByRole('link', { name: 'Add to my iPhone calendar' })).toBeInTheDocument()
  })

  it('stop my link asks first, then DELETEs; Escape closes the sheet', async () => {
    fetchMock.mockResolvedValue(ok(data({ feed: { has: true } })))
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fireEvent.click(screen.getByRole('button', { name: 'Calendar link settings' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop my calendar link' }))
    fetchMock.mockResolvedValue(ok({ stopped: true }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, stop it' }))
    expect(await within(dialog).findByText(/Your calendar link is stopped/)).toBeInTheDocument()
    expect(posts()[0][1].method).toBe('DELETE')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add my shifts to my phone' })).toBeInTheDocument()
  })
})
