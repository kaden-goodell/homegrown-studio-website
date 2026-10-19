import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'

vi.mock('@components/admin/classes/photo', () => ({
  uploadPhoto: vi.fn(async () => ({ url: 'https://x.test/api/admin/classes/photo.json?id=abc' })),
}))

import { NewClassSheet, ADDED, defaultDay, nextOpenDay } from '@components/admin/sheets/NewClassSheet'
import { at, cls, content, lib, ok, posts, refuse, renderSheet } from './harness'

const CLASSES = '/api/admin/classes/classes.json'
afterEach(() => vi.unstubAllGlobals())

/** The admin routes New class reads and writes. `create` answers the POST. */
function server(o: { library?: any[]; runs?: any; create?: (body: any) => any; theClass?: any } = {}) {
  return vi.fn(async (url: string, init?: any) => {
    const path = url.split('?')[0]
    if (path === '/api/admin/classes/library.json') return ok({ data: { library: o.library ?? [], runs: o.runs ?? {} } })
    if (path === '/api/admin/classes/bookings.json') return ok({ data: { class: o.theClass, bookings: [], seatsTaken: {} } })
    if (path === CLASSES && init?.method === 'POST') {
      const body = JSON.parse(init.body)
      return o.create ? o.create(body) : ok({ data: { class: cls({ id: 'cls_new', content: body.content }) } })
    }
    throw new Error(`unexpected ${url}`)
  })
}
const date1 = () => screen.getByRole('group', { name: 'Date 1' })
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement
const fillBasics = (name = 'Pottery', price = '30') => {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: price } })
}

describe('New class: one screen', () => {
  it('checks the form before sending: focus goes to the first thing to fix and the footer says what; a clash shows next to the dates', async () => {
    const f = server({ create: () => refuse(409, { error: 'Clashes with Party for Sam, Wed Mar 12 10 AM.' }) })
    vi.stubGlobal('fetch', f)
    renderSheet(<NewClassSheet day="2031-03-12" />)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(screen.getByText('Give the class a name.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
    expect(within(footer()).getByText('Fix the name above.')).toBeInTheDocument()
    expect(posts(f)).toHaveLength(0)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(screen.getByText('Add a price.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Price per seat ($)')).toHaveFocus())

    fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: '30' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    const dates = screen.getByRole('group', { name: 'Date 1' }).parentElement as HTMLElement
    expect(await within(dates).findByText('Clashes with Party for Sam, Wed Mar 12 10 AM.')).toBeInTheDocument()
    // The form stays as typed.
    expect(screen.getByLabelText('Name')).toHaveValue('Pottery')
    const [p] = posts(f, CLASSES)
    expect(p.body).toMatchObject({ action: 'create', status: 'open', content: { name: 'Pottery', ticketTypes: [{ id: 'person', label: 'Person' }] } })
    expect(p.body.libraryId).toBeUndefined()
    expect(Object.values(p.body.content.prices)).toEqual([{ person: 3000 }])
    expect(p.body.content.passes[0]).toMatchObject({ label: 'Full class', covers: { kind: 'all' } })
    expect(p.body.sessions).toEqual([expect.objectContaining({ startIso: at('2031-03-12', '18:00'), endIso: at('2031-03-12', '20:00'), capacity: 12 })])
    // From scratch, the first date sets the library's usual length and seats.
    expect(p.body.content).toMatchObject({ defaultMinutes: 120, defaultCapacity: 12 })
  })

  it('a date has to end after it starts', () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<NewClassSheet />)
    fillBasics()
    fireEvent.change(within(date1()).getByLabelText('Ends'), { target: { value: '09:00' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(screen.getByText('A date has to end after it starts.')).toBeInTheDocument()
    expect(within(footer()).getByText('Fix the dates above.')).toBeInTheDocument()
    expect(posts(f)).toHaveLength(0)
  })

  it('opened from a day, it starts on that day', () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<NewClassSheet day="2031-04-02" />)
    expect(within(date1()).getByLabelText('Day')).toHaveValue('2031-04-02')
  })

  it('after Add: the new class’s sheet opens (on Bookings) with "Added. It’s on the calendar and in your library.", and leaving asks nothing', async () => {
    vi.stubGlobal('fetch', server())
    const { sheet, bump, dirty } = renderSheet(<NewClassSheet />)
    fillBasics()
    expect(dirty()).toBe(true)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalledWith({ kind: 'class', id: 'cls_new' }))
    expect(sheet.setDirty).toHaveBeenLastCalledWith(false)
    expect(bump).toHaveBeenCalled()
    expect(screen.getByText(ADDED)).toBeInTheDocument()
    expect(ADDED).toBe('Added. It’s on the calendar and in your library.')
  })

  it('a warning from the server (the POS, the library) is the toast instead', async () => {
    vi.stubGlobal('fetch', server({ create: (b) => ok({ data: { class: cls({ id: 'cls_new', content: b.content }) }, warning: "Saved. The POS item didn't update. Try Save again." }) }))
    renderSheet(<NewClassSheet />)
    fillBasics()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(await screen.findByText("Saved. The POS item didn't update. Try Save again.")).toBeInTheDocument()
  })

  it('Save as draft adds it as a draft', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<NewClassSheet />)
    fillBasics()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(1))
    expect(posts(f, CLASSES)[0].body.status).toBe('draft')
  })

  it('there is exactly one way to add: no "Add and keep in the library"', () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<NewClassSheet />)
    expect(screen.queryByRole('button', { name: /keep in the library/ })).toBeNull()
    expect(screen.getByText('It goes into your library on its own, so you can run it again later.')).toBeInTheDocument()
  })
})

describe('New class: the details, ported from the old class form', () => {
  it('Ways to book: a price box per kind of seat on each way, and an empty box is not sold', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet />)
    fillBasics('Family Pottery')
    fireEvent.click(screen.getByRole('button', { name: /More options/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add a kind of seat' }))
    fireEvent.change(screen.getByLabelText('Kind of seat 2'), { target: { value: 'Kid' } })
    fireEvent.change(screen.getByLabelText('Full class Kid price ($)'), { target: { value: '15.50' } })
    fireEvent.change(screen.getByLabelText('Full class Person price ($)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '+ Add a way to book' }))
    fireEvent.change(screen.getByLabelText('Way to book 2 name'), { target: { value: 'Drop in' } })
    fireEvent.change(screen.getByLabelText('Drop in Person price ($)'), { target: { value: '12' } })
    // With more than one price, the price box moves under Ways to book.
    expect(screen.queryByLabelText('Price per seat ($)')).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    const sent = posts(f, CLASSES)[0].body.content
    const [full, drop] = sent.passes
    expect(sent.ticketTypes.map((t: any) => t.label)).toEqual(['Person', 'Kid'])
    const kid = sent.ticketTypes[1].id
    expect(sent.prices).toEqual({ [full.id]: { [kid]: 1550 }, [drop.id]: { person: 1200 } })
  })

  it('removing a way to book or a kind of seat removes its prices', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<NewClassSheet />)
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: /More options/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add a way to book' }))
    fireEvent.change(screen.getByLabelText('Way 2 Person price ($)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Way 2' }))
    expect(screen.queryByLabelText('Way 2 Person price ($)')).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(1))
    expect(Object.values(posts(f, CLASSES)[0].body.content.prices)).toEqual([{ person: 3000 }])
  })

  it('number boxes can be cleared and retyped, are checked on save, and Minimum to run is "Needs N by day time"', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<NewClassSheet />)
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: /More options/ }))
    const most = screen.getByLabelText('Most people per booking')
    fireEvent.change(most, { target: { value: '' } })
    expect(most).toHaveValue('')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(within(screen.getByRole('region', { name: 'Ages and booking rules' })).getByText('The most people per booking is 1 to 40.')).toBeInTheDocument()
    expect(within(footer()).getByText('Fix Ages and booking rules above.')).toBeInTheDocument()
    fireEvent.change(most, { target: { value: '5' } })

    fireEvent.change(screen.getByLabelText('Full class includes'), { target: { value: 'choose' } })
    const pick = screen.getByLabelText('Full class how many they pick')
    fireEvent.change(pick, { target: { value: '' } })
    expect(pick).toHaveValue('')
    fireEvent.change(pick, { target: { value: '3' } })

    fireEvent.change(screen.getByLabelText('Minimum people'), { target: { value: '6' } })
    fireEvent.change(screen.getByLabelText('Decide by day'), { target: { value: '2031-03-10' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(screen.getByText('The minimum to run needs how many, a day and a time.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Decide by time'), { target: { value: '17:00' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(1))
    const sent = posts(f, CLASSES)[0].body.content
    expect(sent.rules.maxPerBooking).toBe(5)
    expect(sent.passes[0].covers).toEqual({ kind: 'choose', count: 3 })
    expect(sent.rules.minimumToRun).toEqual({ count: 6, decideByIso: at('2031-03-10', '17:00') })
    // The waitlist cutoff isn't shown until the waitlist exists (stage 4).
    expect(screen.queryByText(/waitlist/i)).toBeNull()
  })

  it('a price error sits on the price box next to a name error; More options stays shut', () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<NewClassSheet />)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(screen.getByText('Give the class a name.')).toBeInTheDocument()
    const priceBox = screen.getByLabelText('Price per seat ($)').closest('[data-field]') as HTMLElement
    expect(within(priceBox).getByText('Add a price.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /More options/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('photo: the file input is hidden behind Choose photo; the photo shows as a thumbnail with Remove, and on the card Preview', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<NewClassSheet />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery' } })
    const input = screen.getByLabelText('Photo')
    expect(input).toHaveClass('sr-only')
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument()
    fireEvent.change(input, { target: { files: [new File(['x'], 'mug.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'Class photo' })).toHaveAttribute('src', 'https://x.test/api/admin/classes/photo.json?id=abc')
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const preview = screen.getByRole('region', { name: 'How the card looks' })
    expect(within(preview).getByRole('img', { name: 'Pottery' })).toHaveAttribute('src', 'https://x.test/api/admin/classes/photo.json?id=abc')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByRole('img', { name: 'Class photo' })).toBeNull()
  })
})

describe('New class › From a past class', () => {
  const candles = lib('lib_c', content({ name: 'Candles', description: 'Pour two candles.', imageUrl: 'https://x.test/c.jpg', defaultCapacity: 8, defaultMinutes: 90, prices: { pas_full: { person: 3500 } } }))
  const runs = { lib_c: { lastIso: at('2031-02-20', '14:00'), nextIso: null, startIso: at('2031-02-20', '14:00'), endIso: at('2031-02-20', '16:00') } }

  it('picking one fills in the name, price, usual time, seats, photo and details; unchanged, Add class links it to the library', async () => {
    const f = server({ library: [candles], runs })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet day="2031-03-14" />)
    fireEvent.click(screen.getByRole('button', { name: 'From a past class' }))
    const row = await screen.findByRole('button', { name: /Candles/ })
    expect(row).toHaveTextContent('Last ran Feb 20 · $35 · 8 seats')
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Name')).toHaveValue('Candles')
    expect(screen.getByLabelText('Price per seat ($)')).toHaveValue('35')
    expect(screen.getByLabelText('Description')).toHaveValue('Pour two candles.')
    expect(screen.getByRole('img', { name: 'Class photo' })).toHaveAttribute('src', 'https://x.test/c.jpg')
    expect(within(date1()).getByLabelText('Day')).toHaveValue('2031-03-14')
    expect(within(date1()).getByLabelText('Starts')).toHaveValue('14:00')
    expect(within(date1()).getByLabelText('Ends')).toHaveValue('16:00')
    expect(within(date1()).getByLabelText('Seats')).toHaveValue('8')
    // Same details as the library: no choice to make.
    expect(within(footer()).queryByRole('button', { name: 'This class and the library' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    expect(posts(f, CLASSES)[0].body).toMatchObject({ action: 'create', libraryId: 'lib_c' })
    expect(posts(f, CLASSES)[0].body.alsoUpdateLibrary).toBeUndefined()
  })

  it('details changed from the library’s: "Only this class" or "This class and the library"; time or seats alone don’t count', async () => {
    const f = server({ library: [candles], runs })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'From a past class' }))
    fireEvent.click(await screen.findByRole('button', { name: /Candles/ }))
    fireEvent.change(within(date1()).getByLabelText('Starts'), { target: { value: '18:00' } })
    fireEvent.change(within(date1()).getByLabelText('Seats'), { target: { value: '10' } })
    expect(within(footer()).getByRole('button', { name: 'Add class' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: '40' } })
    expect(within(footer()).queryByRole('button', { name: 'Add class' })).toBeNull()
    expect(within(footer()).getByRole('button', { name: 'Only this class' })).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'This class and the library' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    expect(posts(f, CLASSES)[0].body).toMatchObject({ libraryId: 'lib_c', alsoUpdateLibrary: true, content: { prices: { pas_full: { person: 4000 } } } })
  })

  it('Schedule it (from the library) opens filled in, with nothing to save yet', async () => {
    vi.stubGlobal('fetch', server({ library: [candles], runs }))
    const { dirty } = renderSheet(<NewClassSheet from={{ kind: 'lib', id: 'lib_c' }} />)
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Candles'))
    expect(screen.queryByRole('button', { name: 'From a past class' })).toBeNull()
    expect(dirty()).toBe(false)
  })

  it('Run it again (from a class) opens with its details and its dates a week on', async () => {
    const theClass = cls({ libraryId: 'lib_c', content: { ...candles.versions[0].content }, sessions: [{ id: 'ses_1', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '12:00'), capacity: 6 }] })
    const f = server({ library: [candles], runs, theClass })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet from={{ kind: 'class', id: 'cls_1' }} />)
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Candles'))
    expect(within(date1()).getByLabelText('Day')).toHaveValue('2031-03-19')
    expect(within(date1()).getByLabelText('Ends')).toHaveValue('12:00')
    fireEvent.click(screen.getByRole('button', { name: '+ Add another date' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    expect(posts(f, CLASSES)[0].body).toMatchObject({ libraryId: 'lib_c', sessions: [
      expect.objectContaining({ startIso: at('2031-03-19', '10:00'), endIso: at('2031-03-19', '12:00'), capacity: 6 }),
      expect.objectContaining({ startIso: at('2031-03-26', '10:00'), endIso: at('2031-03-26', '12:00'), capacity: 6 }),
    ] })
  })
})

describe('New class, fix round 1', () => {
  it('I1 (R35): one create key for this Add, the same on every retry, a new one after it worked', async () => {
    let n = 0
    const f = server({ create: (b) => (++n === 1 ? refuse(503, { error: "The class records couldn't be reached. Try again." }) : ok({ data: { class: cls({ id: 'cls_new', content: b.content }) } })) })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet />)
    fillBasics()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    expect(await within(footer()).findByText("The class records couldn't be reached. Try again.")).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    const [a, b] = posts(f, CLASSES)
    expect(a.body.createKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/)
    expect(b.body.createKey).toBe(a.body.createKey)
  })

  it('Q10: with no day tapped, it starts a week out on the next day the studio opens', () => {
    // Monday 19 Oct 2026: a week out is Monday 26 Oct (usually closed), so Thursday 29 Oct.
    expect(defaultDay('2026-10-19')).toBe('2026-10-29')
    // Halloween weekend is closed: a week from Thu 22 Oct lands on Thu 29 Oct; a week from Fri 23 Oct skips to Thu Nov 5.
    expect(defaultDay('2026-10-23')).toBe('2026-11-05')
  })

  it('Q8: picking a past class after typing asks "Replace what you typed?"; Keep mine keeps it', async () => {
    const candles = lib('lib_c', content({ name: 'Candles' }))
    vi.stubGlobal('fetch', server({ library: [candles] }))
    renderSheet(<NewClassSheet />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My own idea' } })
    fireEvent.click(screen.getByRole('button', { name: 'From a past class' }))
    fireEvent.click(await screen.findByRole('button', { name: /Candles/ }))
    const ask = screen.getByRole('group', { name: 'Replace what you typed?' })
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep mine' }))
    expect(screen.getByLabelText('Name')).toHaveValue('My own idea')
    fireEvent.click(screen.getByRole('button', { name: /Candles/ }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Replace what you typed?' })).getByRole('button', { name: 'Replace' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Candles')
  })

  it('Q9: Run it again on a class whose details differ from the library: a plain Add until she changes something here', async () => {
    const libC = lib('lib_c', content({ name: 'Candles' }))
    const theClass = cls({ libraryId: 'lib_c', content: content({ name: 'Candles', description: 'Only on that date.' }) })
    vi.stubGlobal('fetch', server({ library: [libC], theClass }))
    renderSheet(<NewClassSheet from={{ kind: 'class', id: 'cls_1' }} />)
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Candles'))
    expect(within(footer()).getByRole('button', { name: 'Add class' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: '45' } })
    expect(within(footer()).getByRole('button', { name: 'This class and the library' })).toBeInTheDocument()
  })

  it('M3: Run it again finds its library class even when that one is archived (no second entry)', async () => {
    const archived = lib('lib_c', content({ name: 'Candles' }), { archived: true })
    const f = server({ library: [archived], theClass: cls({ libraryId: 'lib_c', content: content({ name: 'Candles' }) }) })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet from={{ kind: 'class', id: 'cls_1' }} />)
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Candles'))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    expect(posts(f, CLASSES)[0].body.libraryId).toBe('lib_c')
    expect(f.mock.calls.some((c) => String(c[0]).includes('archived=1'))).toBe(true)
  })
})

describe('New class, fix round 2', () => {
  it('N1 (R37): Run it again from a class three weeks gone starts on the next open day or later, same weekday; a past date the server refuses shows under the dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
    try {
      const theClass = cls({ libraryId: null, sessions: [{ id: 'ses_1', startIso: at('2026-09-26', '10:00'), endIso: at('2026-09-26', '12:00'), capacity: 6 }] })
      const f = server({ theClass, create: () => refuse(400, { error: 'Pick a date from today on.', field: 'sessions' }) })
      vi.stubGlobal('fetch', f)
      renderSheet(<NewClassSheet from={{ kind: 'class', id: 'cls_1' }} />)
      await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Pottery'))
      // RM1 (R37): Sat Sep 26 moves on by whole weeks to the first Saturday on or after the next open day from today (Thu Oct 22): Sat Oct 24.
      expect(within(date1()).getByLabelText('Day')).toHaveValue('2026-10-24')
      fireEvent.change(within(date1()).getByLabelText('Day'), { target: { value: '2026-10-01' } })
      fireEvent.click(within(footer()).getByRole('button', { name: 'Add class' }))
      const dates = date1().parentElement as HTMLElement
      expect(await within(dates).findByText('Pick a date from today on.')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('RM1: last Saturday’s class (Oct 17) run again on Monday Oct 19 lands on Sat Oct 24, not a week further', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
    try {
      const theClass = cls({ libraryId: null, sessions: [{ id: 'ses_1', startIso: at('2026-10-17', '15:00'), endIso: at('2026-10-17', '17:00'), capacity: 10 }] })
      vi.stubGlobal('fetch', server({ theClass }))
      renderSheet(<NewClassSheet from={{ kind: 'class', id: 'cls_1' }} />)
      await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Pottery'))
      expect(within(date1()).getByLabelText('Day')).toHaveValue('2026-10-24')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the first open day skips the owners’ saved closed days too', () => {
    const snow = [{ from: '2026-10-29', to: '2026-10-30', name: 'a snow day' }]
    expect(defaultDay('2026-10-19', snow)).toBe('2026-10-31')
    expect(nextOpenDay('2026-10-19', snow)).toBe('2026-10-22')
    expect(nextOpenDay('2026-10-29', snow)).toBe('2026-10-31')
  })

  it('N2: an Add that turns out to be a replay of an earlier one (different from what was sent) says so and opens it', async () => {
    const f = server({ create: () => ok({ data: { class: cls({ id: 'cls_first', status: 'open' }), replay: true } }) })
    vi.stubGlobal('fetch', f)
    const { sheet } = renderSheet(<NewClassSheet />)
    fillBasics('Pottery', '45')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save as draft' }))
    expect(await screen.findByText('This class was already added. Here it is.')).toBeInTheDocument()
    expect(screen.queryByText(/Saved as a draft/)).toBeNull()
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'class', id: 'cls_first' })
  })
})

