import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'

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

describe('shared iPad: the person on screen is the only one whose shifts show (I2)', () => {
  const SAM = { id: 'TM3', name: 'Sam', role: 'crew' } as const
  const samData = () => data({ me: { id: 'TM3', name: 'Sam' }, availability: { ...avail, staffId: 'TM3', name: 'Sam' }, mine: [], open: [] })

  it("cold start: Jessica's slow reply that lands after Sam's never shows under Sam's name", async () => {
    let releaseJessica!: (v: unknown) => void
    fetchMock.mockReset()
    fetchMock
      .mockImplementationOnce(() => new Promise((r) => { releaseJessica = r })) // Jessica's first load: slow
      .mockResolvedValueOnce(ok(samData())) // Sam's
    const view = render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    view.rerender(<MyShifts staff={SAM} onOpenRoster={() => {}} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam’s shifts' })).toBeInTheDocument()
    await screen.findByText(/Nothing yet in the next 8 weeks/)
    await act(async () => { releaseJessica(ok(data())) })
    expect(screen.queryAllByTestId('my-shift')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/Needlepoint 101|pick me/)
  })

  it("a reply for someone else (sent with the last person's sign-in) is dropped", async () => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok(data())) // me: Jessica
    render(<MyShifts staff={SAM} onOpenRoster={() => {}} />)
    await screen.findByRole('heading', { level: 1, name: 'Sam’s shifts' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryAllByTestId('my-shift')).toHaveLength(0)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('review minors', () => {
  it('a shift that already ended says Worked, not You’re on (m3)', async () => {
    const past = row(ev('ses:z', 'Last Night', '2026-11-01T23:00:00.000Z', { rosterId: 'cls_z' }), [{ staffId: 'TM2', name: 'Jessica' }])
    fetchMock.mockResolvedValue(ok(data({ mine: [past, ...data().mine] })))
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    const cards = await screen.findAllByTestId('my-shift')
    expect(cards[0]).toHaveTextContent('Worked')
    expect(cards[0]).not.toHaveTextContent('You’re on')
    expect(cards[0].getAttribute('aria-label')).toMatch(/Worked\./)
    expect(cards[1]).toHaveTextContent('You’re on')
  })

  it('"Need someone (N)" counts the cards that filter shows (m4)', async () => {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    const btn = screen.getByRole('button', { name: /^Need someone/ })
    expect(btn).toHaveTextContent(`Need someone (${screen.getAllByTestId('open-event').length})`)
    expect(btn).toHaveTextContent('Need someone (3)')
  })

  it('after the one-tap ask, focus moves to Add a note (m6)', async () => {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    fetchMock.mockResolvedValue(ok({ key: 'ses:b', asked: true }))
    fireEvent.click(screen.getByRole('button', { name: /I'd like to work Weaving/ }))
    const card = () => screen.getAllByTestId('open-event').find((c) => c.textContent!.includes('Weaving'))!
    await waitFor(() => expect(document.activeElement).toBe(within(card()).getByRole('button', { name: 'Add a note' })))
  })

  it('an event outside the hours I gave says so in words (I7)', async () => {
    // Weaving is Fri Nov 13 5–7 PM; I said Fridays only 9 AM–1 PM
    fetchMock.mockResolvedValue(ok(data({ availability: { ...avail, weekly: { ...avail.weekly, '5': { kind: 'can', range: { from: '09:00', to: '13:00' }, note: '' } } } })))
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    const weaving = screen.getAllByTestId('open-event').find((c) => c.textContent!.includes('Weaving'))!
    expect(weaving).toHaveTextContent('Outside the hours you gave')
    expect(weaving).not.toHaveTextContent('You said you can’t')
  })
})

describe('calendar link', () => {
  const LINKS = { https: 'https://x.test/api/calendar/feed/TOKEN.ics', webcal: 'webcal://x.test/api/calendar/feed/TOKEN.ics' }

  async function makeLink() {
    render(<MyShifts staff={STAFF} onOpenRoster={() => {}} />)
    await screen.findAllByTestId('my-shift')
    const opener = screen.getByRole('button', { name: 'Add my shifts to my phone' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'My shifts on my phone' })
    fetchMock.mockResolvedValue(ok(LINKS))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get my calendar link' }))
    await within(dialog).findByRole('button', { name: 'Show my link' })
    return { dialog, opener }
  }

  it('says to do it on your own phone; a new link stays hidden until Show my link (shared iPad, I3)', async () => {
    const { dialog } = await makeLink()
    expect(within(dialog).getByTestId('own-phone')).toHaveTextContent('Do this on your own phone. On the studio iPad, scan the code with your phone’s camera instead.')
    expect(dialog.innerHTML).not.toContain('TOKEN')
    expect(within(dialog).queryByRole('link', { name: 'Add to my iPhone calendar' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show my link' }))
    expect(await within(dialog).findByRole('link', { name: 'Add to my iPhone calendar' })).toHaveAttribute('href', LINKS.webcal)
    // a code to scan with your own phone, drawn here (an inline SVG, no outside service)
    await waitFor(() => expect(within(dialog).getByTestId('cal-qr').querySelector('svg')).not.toBeNull())
    expect(within(dialog).getByRole('img', { name: /Code to scan with your iPhone camera/ })).toBeInTheDocument()
    expect(dialog.querySelector('img[src^="http"]')).toBeNull()
    // Hide my link puts it away again
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide my link' }))
    expect(dialog.innerHTML).not.toContain('TOKEN')
    expect(within(dialog).getByRole('button', { name: 'Show my link' })).toBeInTheDocument()
  })

  it('iPhone and Android steps in plain words; Copy; never a browser pop-up (I4)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    const { dialog } = await makeLink()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show my link' }))
    await within(dialog).findByRole('link', { name: 'Add to my iPhone calendar' })
    expect(dialog).toHaveTextContent('Tap it, tap Subscribe, then tap Add.')
    expect(dialog).toHaveTextContent('Open calendar.google.com in Chrome. On a phone, tap ⋮ and tick Desktop site first. Use the same Google account as your phone.')
    expect(dialog).toHaveTextContent('Next to Other calendars, tap +, then From URL. Paste and tap Add calendar.')
    expect(dialog).toHaveTextContent('On your phone, open the Google Calendar app › Settings › Hometown Studio · my shifts, and turn on Sync.')
    expect(dialog).toHaveTextContent('Google can take up to a day to show changes. Your text from Catherine or Kaden is the quick way to hear.')
    expect(dialog).not.toHaveTextContent('On a computer')
    expect(dialog).toHaveTextContent('This link is only shown now.')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy my link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINKS.https))
    expect(await within(dialog).findByText('Copied. Now paste it in Google Calendar.')).toBeInTheDocument()
    expect(posts()[0][0]).toBe('/api/staff/feed.json')
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('a stray tap outside does not throw the link away; Done does, and focus goes back to the opener (m7)', async () => {
    const { dialog, opener } = await makeLink()
    fireEvent.click(dialog) // the backdrop
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Closing hides your link for good.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('Tab stays inside the sheet (focus trap)', async () => {
    const { dialog } = await makeLink()
    const buttons = within(dialog).getAllByRole('button')
    const last = buttons[buttons.length - 1]
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('a shown link hides itself after a few minutes', async () => {
    const { dialog } = await makeLink()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-11-02T15:00:00Z'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show my link' }))
    expect(within(dialog).getByRole('link', { name: 'Add to my iPhone calendar' })).toBeInTheDocument()
    const { LINK_SHOW_MS } = await import('@components/staff/CalendarLinkSheet')
    act(() => { vi.advanceTimersByTime(LINK_SHOW_MS + 10) })
    expect(within(dialog).queryByRole('link', { name: 'Add to my iPhone calendar' })).toBeNull()
    // It forgets the link too (review m1): nothing brings it back but a new link.
    expect(within(dialog).queryByRole('button', { name: 'Show my link' })).toBeNull()
    expect(dialog).toHaveTextContent('Your link was hidden after a few minutes')
    expect(dialog.innerHTML).not.toContain('x.test')
    expect(within(dialog).getByRole('button', { name: 'Make a new link' })).toBeInTheDocument()
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
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Show my link' }))
    expect(within(dialog).getByRole('link', { name: 'Add to my iPhone calendar' })).toBeInTheDocument()
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
