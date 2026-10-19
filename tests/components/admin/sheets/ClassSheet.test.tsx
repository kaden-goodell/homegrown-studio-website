import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { ClassSheet, STALE_KEPT } from '@components/admin/sheets/ClassSheet'
import { setAdminWho } from '@components/admin/classes/api'
import { at, booking, cls, content, lib, ok, posts, refuse, renderSheet } from './harness'

const CLASSES = '/api/admin/classes/classes.json'
const REFUND = '/api/admin/classes/refund.json'
afterEach(() => { vi.unstubAllGlobals(); setAdminWho('') })

/**
 * The class sheet's routes. `the` is the class as stored now (a POST can change it); `post` answers
 * classes.json POSTs; `refund` answers refund.json; `library` is the library list.
 */
function server(o: { the?: any; bookings?: any[]; seatsTaken?: any; post?: (b: any) => any; refund?: (b: any) => any; library?: any[] } = {}) {
  const state = { the: o.the ?? cls() }
  const fn = vi.fn(async (url: string, init?: any) => {
    const path = url.split('?')[0]
    if (path === '/api/admin/classes/bookings.json') return ok({ data: { class: state.the, bookings: o.bookings ?? [], seatsTaken: o.seatsTaken ?? {} } })
    if (path === '/api/admin/classes/library.json') return ok({ data: { library: o.library ?? [], runs: {} } })
    if (path === CLASSES && init?.method === 'POST') {
      const b = JSON.parse(init.body)
      const r = o.post?.(b)
      if (r) return r
      state.the = { ...state.the, ...(b.content ? { content: b.content } : {}), ...(b.sessions ? { sessions: b.sessions } : {}), ...(b.status ? { status: b.status } : {}), ...(b.action === 'cancel' ? { status: 'cancelled' } : {}), updatedAt: `${state.the.updatedAt}+` }
      return ok({ data: { class: state.the, ...(b.action === 'cancel' ? { booked: [] } : {}) } })
    }
    if (path === REFUND) return o.refund?.(JSON.parse(init.body)) ?? ok({ data: { cents: 6540, emailed: true } })
    throw new Error(`unexpected ${url}`)
  })
  return Object.assign(fn, { state })
}
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement
/** The class has loaded (the sheet's heading is its name). */
const loaded = () => screen.findByRole('heading', { name: /Pottery/ })
const tabTo = async (name: 'Bookings' | 'Details' | 'Dates') => fireEvent.click(await screen.findByRole('button', { name }))

describe('class sheet › Bookings', () => {
  const two = cls({
    content: content({ ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }], prices: { pas_full: { adult: 3000, kid: 2000 } }, questions: [{ id: 'q1', label: 'Glaze', choices: ['Red', 'Blue'] }] }),
    sessions: [{ id: 'ses_1', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), capacity: 10 }],
  })
  const ada = booking({ seats: { adult: 1, kid: 2 }, picks: [{ seat: 1, ticketTypeId: 'adult', answers: { q1: 'Red' } }], paidCents: 7630, refundableCents: 7630 })

  it('header: name, day · time · price and status; summary, then each booking with what they bought and the Refund panel', async () => {
    vi.stubGlobal('fetch', server({ the: { ...two, status: 'draft' }, bookings: [ada], seatsTaken: { ses_1: 3 } }))
    renderSheet(<ClassSheet id="cls_1" />)
    expect(await screen.findByRole('heading', { name: 'Pottery' })).toBeInTheDocument()
    const head = document.querySelector('.adm-sheet-head small') as HTMLElement
    expect(head.textContent).toBe('Wed Mar 12 · 10–11:30\u00a0AM · $30 adult · $20 kidDraft')
    expect(within(head).getByText('Draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bookings' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('3 of 10')).toBeInTheDocument()
    expect(screen.getByText('$76.30')).toBeInTheDocument()
    const b = screen.getByRole('article', { name: 'Ada Lovelace' })
    expect(within(b).getByText(/1 Adult, 2 Kid · paid \$76\.30 · card/)).toBeInTheDocument()
    expect(within(b).getByText(/ada@example.com/)).toBeInTheDocument()
    expect(within(b).getByText(/Glaze Red/)).toBeInTheDocument()
    expect(b.querySelector('[data-refund-slot="bkg_1"]')).not.toBeNull()
    expect(within(b).getByRole('button', { name: 'Refund' })).toBeInTheDocument()
  })

  it('a refund from the sheet goes through the owner route and says who is doing it (X-Admin-Who)', async () => {
    setAdminWho('Catherine')
    const f = server({ bookings: [booking()] })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" />)
    fireEvent.click(await within(await screen.findByRole('article', { name: 'Ada Lovelace' })).findByRole('button', { name: 'Refund' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => expect(posts(f, REFUND)).toHaveLength(1))
    expect(posts(f, REFUND)[0].body).toMatchObject({ classId: 'cls_1', bookingId: 'bkg_1', kind: 'booking' })
    expect(posts(f, REFUND)[0].headers['X-Admin-Who']).toBe('Catherine')
  })

  it('a refund still waiting on Square shows "I checked Square" on its row (R29)', async () => {
    const waiting = { requestId: 'rq_1', cents: 6540, at: '2031-03-02T15:00:00Z', by: { id: 'owner-kaden', name: 'Kaden' }, people: [{ name: 'Ada Lovelace', cents: 6540 }], dates: [] }
    vi.stubGlobal('fetch', server({ bookings: [booking({ waiting })] }))
    renderSheet(<ClassSheet id="cls_1" />)
    expect(await screen.findByText('A refund is waiting on Square')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'It went through' })).toBeInTheDocument()
  })

  it('more than one date: seats on each date', async () => {
    const multi = cls({ sessions: [
      { id: 'ses_1', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), capacity: 10 },
      { id: 'ses_2', startIso: at('2031-03-19', '10:00'), endIso: at('2031-03-19', '11:30'), capacity: 10 },
    ] })
    vi.stubGlobal('fetch', server({ the: multi, seatsTaken: { ses_1: 4, ses_2: 3 } }))
    renderSheet(<ClassSheet id="cls_1" />)
    const list = await screen.findByRole('list', { name: 'Seats on each date' })
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Wed Mar 12 · 10–11:30 AM4 of 10', 'Wed Mar 19 · 10–11:30 AM3 of 10'])
  })

  it('Print list opens that day’s print sheet; Text everyone shows the numbers and opens Messages with them', async () => {
    vi.stubGlobal('fetch', server({ bookings: [booking(), booking({ bookingId: 'bkg_2', customer: { givenName: 'Bo', familyName: 'D', email: '', phone: '(256) 555-0111' } })] }))
    const { sheet } = renderSheet(<ClassSheet id="cls_1" />)
    await screen.findByRole('article', { name: 'Ada Lovelace' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Print list' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'print', day: '2031-03-12' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Text everyone' }))
    const panel = screen.getByRole('group', { name: 'Text everyone' })
    expect(within(panel).getByText('(256) 555-0100, (256) 555-0111')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Open Messages' })).toHaveAttribute('href', 'sms:/open?addresses=2565550100,2565550111')
  })

  it('no bookings: says where it is, by status', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<ClassSheet id="cls_1" />)
    expect(await screen.findByText('No bookings yet. It’s live on the What’s On page.')).toBeInTheDocument()
  })
})

describe('class sheet › Details', () => {
  it('Save is off until something changes; it sends the copy it loaded (no dates), then the new one', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    const { dirty } = renderSheet(<ClassSheet id="cls_1" tab="details" />)
    await loaded()
    const save = within(footer()).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery 2' } })
    expect(dirty()).toBe(true)
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(1))
    expect(posts(f, CLASSES)[0].body).toMatchObject({ action: 'update', id: 'cls_1', expectedUpdatedAt: '2031-01-02T00:00:00.000Z', content: { name: 'Pottery 2' } })
    expect(posts(f, CLASSES)[0].body.sessions).toBeUndefined()
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    await waitFor(() => expect(dirty()).toBe(false))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Pottery 3' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(2))
    expect(posts(f, CLASSES)[1].body.expectedUpdatedAt).toBe('2031-01-02T00:00:00.000Z+')
  })

  it('"Only this class" and "This class and the library" show only when the details differ from the library’s', async () => {
    const f = server({ the: cls({ libraryId: 'lib_1', libraryVersion: 1 }), library: [lib('lib_1', content())] })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    await screen.findByLabelText('Name')
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).startsWith('/api/admin/classes/library.json'))).toBe(true))
    expect(within(footer()).getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: '35' } })
    expect(await within(footer()).findByRole('button', { name: 'Only this class' })).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Save' })).toBeNull()
    // Back to the library's price: one plain Save again.
    fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: '30' } })
    expect(within(footer()).getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Price per seat ($)'), { target: { value: '35' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'This class and the library' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(1))
    expect(posts(f, CLASSES)[0].body).toMatchObject({ alsoUpdateLibrary: true, content: { prices: { pas_full: { person: 3500 } } } })
    expect(await screen.findByText('Saved. The library has it too.')).toBeInTheDocument()
  })

  it('a class whose details already differ from the library, changed to match it: a plain Save', async () => {
    const f = server({ the: cls({ libraryId: 'lib_1', content: content({ description: 'Only on this date.' }) }), library: [lib('lib_1', content())] })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Make a mug.' } })
    await waitFor(() => expect(within(footer()).getByRole('button', { name: 'Save' })).toBeEnabled())
    expect(within(footer()).queryByRole('button', { name: 'This class and the library' })).toBeNull()
  })

  it('someone else saved first (409 stale): the typed form stays, the sentence says so and what they changed, and Save works again', async () => {
    let n = 0
    const f = server({
      post: () => (++n === 1 ? refuse(409, { error: 'Someone else changed this class. Reload to see their changes.', stale: true }) : undefined),
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'My new name' } })
    // Meanwhile the other owner changed the price.
    f.state.the = { ...f.state.the, updatedAt: 'theirs', content: content({ prices: { pas_full: { person: 4500 } } }) }
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(`${STALE_KEPT} They changed: Price.`)).toBeInTheDocument()
    expect(STALE_KEPT).toBe('Someone else changed this class. Your edits are kept; check them and save again.')
    expect(screen.getByLabelText('Name')).toHaveValue('My new name')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(2))
    expect(posts(f, CLASSES)[1].body).toMatchObject({ expectedUpdatedAt: 'theirs', content: { name: 'My new name' } })
  })

  it('a failed save moves to the first thing to fix and says so in the footer', async () => {
    vi.stubGlobal('fetch', server())
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: '' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Give the class a name.')).toBeInTheDocument()
    expect(within(footer()).getByText('Fix the name under Details.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
  })

  it('a POS warning after a save is the toast', async () => {
    vi.stubGlobal('fetch', server({ post: (b) => ok({ data: { class: cls({ content: b.content }) }, warning: "Saved. The POS item didn't update. Try Save again." }) }))
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Pottery 2' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("Saved. The POS item didn't update. Try Save again.")).toBeInTheDocument()
  })

  it('More options opens on its own when the class has something in it', async () => {
    vi.stubGlobal('fetch', server({ the: cls({ content: content({ addOns: [{ id: 'add_1', label: 'Second mug', priceCents: 500, maxPerSeat: 2 }] }) }) }))
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    expect(await screen.findByRole('button', { name: /More options/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Extra 1')).toHaveValue('Second mug')
  })
})

describe('class sheet › Cancel', () => {
  const bo = booking({ bookingId: 'bkg_2', customer: { givenName: 'Bo', familyName: 'D', email: 'bo@example.com', phone: '(256) 555-0111' }, seats: { person: 1 }, refundable: [{ id: 'led_3', seat: 1, ticketTypeId: 'person', sessions: 1, remainingCents: 3270, sessionCents: 0, freed: false }], paidCents: 3270, refundableCents: 3270 })

  it('lists everyone booked before asking; Keep it does nothing; Cancel class sends the copy it loaded, then shows who to contact and refunds nobody', async () => {
    const f = server({ bookings: [booking(), bo] })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this class' }))
    const ask = screen.getByRole('group', { name: 'Cancel the class' })
    const listed = within(ask).getByRole('list', { name: 'Booked on this class' })
    expect(within(listed).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ada Lovelace · 2 seats · (256) 555-0100', 'Bo D · 1 seat · (256) 555-0111'])
    expect(posts(f)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(screen.queryByRole('group', { name: 'Cancel the class' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this class' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Cancel the class' })).getByRole('button', { name: 'Cancel class' }))
    const contact = await screen.findByRole('group', { name: 'Who to contact' })
    expect(within(contact).getByText('Cancelled. Let these people know.')).toBeInTheDocument()
    expect(within(contact).getByText(/Ada Lovelace · \(256\) 555-0100 · ada@example.com · 2 seats · paid \$65\.40/)).toBeInTheDocument()
    expect(posts(f, CLASSES)[0].body).toEqual({ action: 'cancel', id: 'cls_1', expectedUpdatedAt: '2031-01-02T00:00:00.000Z' })
    expect(posts(f, REFUND)).toHaveLength(0)
    expect(screen.getByText('Cancelled. Here is who to contact.')).toBeInTheDocument()
  })

  it('a stale cancel says so and shows the class as it is now', async () => {
    let gets = 0
    const f = server({ post: () => refuse(409, { error: 'Someone else changed this class. Reload to see their changes.', stale: true }) })
    f.mockImplementationOnce(async (url: string) => { gets++; return ok({ data: { class: cls(), bookings: [], seatsTaken: {} } }) })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="details" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this class' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel class' }))
    expect(await screen.findByText('Someone else changed this class. It’s shown as it is now; cancel again if you still want to.')).toBeInTheDocument()
    await waitFor(() => expect(f.mock.calls.filter((c) => String(c[0]).startsWith('/api/admin/classes/bookings.json')).length).toBeGreaterThan(1))
    expect(gets).toBe(1)
  })

  it('Refund everyone: its own confirm names each person and amount; each is refunded whole with the seat freed, each result shows, and a failed one can be tried again with the same request', async () => {
    let n = 0
    const comp = booking({ bookingId: 'bkg_3', customer: { givenName: 'Cy', familyName: 'Comp', email: '', phone: '' }, source: 'comp', paidHere: false, paidCents: 0, refundableCents: 0 })
    const pos = booking({ bookingId: 'bkg_4', customer: { givenName: 'Di', familyName: 'Pos', email: '', phone: '' }, source: 'pos', paidHere: false, paidCents: 3270, refundableCents: 3270 })
    const f = server({
      the: cls({ status: 'cancelled' }), bookings: [booking(), bo, comp, pos],
      refund: (b) => (b.bookingId === 'bkg_2' && ++n === 1 ? refuse(502, { error: "Square didn't confirm the refund. Try again. It won't refund twice." }) : ok({ data: { cents: b.bookingId === 'bkg_1' ? 6540 : 3270, emailed: true } })),
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Refund everyone…' }))
    const ask = within(footer()).getByRole('group', { name: 'Refund everyone?' })
    expect(within(within(ask).getByRole('list', { name: 'Refunds to make' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ada Lovelace · $65.40', 'Bo D · $32.70'])
    expect(within(ask).getByText(/Not included: Di Pos/)).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Never mind' }))
    expect(posts(f, REFUND)).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Refund everyone…' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund 2 people' }))
    const results = await screen.findByRole('list', { name: 'Refund results' })
    await waitFor(() => expect(within(results).getAllByRole('listitem')).toHaveLength(2))
    expect(within(results).getByText('Ada Lovelace: Refunded $65.40. They’ve been emailed.')).toBeInTheDocument()
    expect(within(results).getByText(/Bo D: Didn’t go through\. Square didn't confirm/)).toBeInTheDocument()
    const sent = posts(f, REFUND)
    expect(sent.map((p: any) => p.body)).toEqual([
      expect.objectContaining({ classId: 'cls_1', bookingId: 'bkg_1', kind: 'booking', freeSeat: true }),
      expect.objectContaining({ classId: 'cls_1', bookingId: 'bkg_2', kind: 'booking', freeSeat: true }),
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Try the ones that didn’t go through' }))
    await waitFor(() => expect(posts(f, REFUND)).toHaveLength(3))
    expect(posts(f, REFUND)[2].body).toMatchObject({ bookingId: 'bkg_2', attempt: sent[1].body.attempt })
    expect(await within(screen.getByRole('list', { name: 'Refund results' })).findByText('Bo D: Refunded $32.70. They’ve been emailed.')).toBeInTheDocument()
  })
})

describe('class sheet › Dates', () => {
  const date1 = () => screen.getByRole('group', { name: 'Date 1' })
  const datesLoaded = () => screen.findByRole('group', { name: 'Date 1' })

  it('the one date picker; Save dates is off until a change; the status switch is Open · Draft · Closed', async () => {
    const f = server()
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="dates" />)
    await datesLoaded()
    expect(within(date1()).getByLabelText('Starts')).toHaveValue('10:00')
    expect(within(footer()).getByRole('button', { name: 'Save dates' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }))
    expect(screen.getByText('Saved, but not on the website yet. Only you see it.')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save dates' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(1))
    expect(posts(f, CLASSES)[0].body).toMatchObject({ action: 'update', status: 'draft', sessions: [{ id: 'ses_1', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '11:30'), capacity: 12 }] })
    expect(posts(f, CLASSES)[0].body.content).toBeUndefined()
    expect(await screen.findByText('Saved. The calendar is updated.')).toBeInTheDocument()
  })

  it('moving a booked date lists who is booked, with a way out: Don’t move puts the date back; Move and I’ll tell them confirms', async () => {
    let n = 0
    const f = server({
      post: (b) => (b.confirmMove ? ok({ data: { class: cls({ sessions: b.sessions, updatedAt: 'u3' }), peopleToTell: [{ name: 'Ada Lovelace', email: 'ada@example.com', phone: '(256) 555-0100', sessions: ['Wed Mar 12 10 AM'] }] } })
        : (++n, refuse(409, { error: 'People are booked on the sessions you moved. Confirm the move, then let them know.', peopleToTell: [{ name: 'Ada Lovelace', email: 'ada@example.com', phone: '(256) 555-0100', sessions: ['Wed Mar 12 10 AM'] }] }))),
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<ClassSheet id="cls_1" tab="dates" />)
    await datesLoaded()
    fireEvent.change(within(date1()).getByLabelText('Starts'), { target: { value: '11:00' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save dates' }))
    const ask = await within(footer()).findByRole('group', { name: 'People are booked on the dates you moved' })
    const people = within(ask).getByRole('list', { name: 'People to tell' })
    expect(within(people).getByText(/Ada Lovelace · \(256\) 555-0100 · ada@example.com \(booked Wed Mar 12 10 AM\)/)).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Don’t move' }))
    expect(within(date1()).getByLabelText('Starts')).toHaveValue('10:00')
    expect(within(footer()).getByRole('button', { name: 'Save dates' })).toBeDisabled()
    expect(posts(f, CLASSES)).toHaveLength(1)

    fireEvent.change(within(date1()).getByLabelText('Starts'), { target: { value: '11:00' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save dates' }))
    fireEvent.click(await within(footer()).findByRole('button', { name: 'Move and I’ll tell them' }))
    await waitFor(() => expect(posts(f, CLASSES)).toHaveLength(3))
    expect(posts(f, CLASSES)[2].body).toMatchObject({ confirmMove: true, sessions: [expect.objectContaining({ startIso: at('2031-03-12', '11:00'), endIso: at('2031-03-12', '12:30') })] })
    const moved = await screen.findByRole('group', { name: 'Moved' })
    expect(within(moved).getByText(/Ada Lovelace/)).toBeInTheDocument()
  })

  it('a clash keeps the dates as typed and says why under them', async () => {
    vi.stubGlobal('fetch', server({ post: () => refuse(409, { error: 'Clashes with Party for Sam, Wed Mar 12 1 PM.' }) }))
    renderSheet(<ClassSheet id="cls_1" tab="dates" />)
    await datesLoaded()
    fireEvent.change(within(date1()).getByLabelText('Starts'), { target: { value: '13:00' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save dates' }))
    expect(await screen.findByText('Clashes with Party for Sam, Wed Mar 12 1 PM.')).toBeInTheDocument()
    expect(within(date1()).getByLabelText('Starts')).toHaveValue('13:00')
  })

  it('Run it again opens New class from this class', async () => {
    vi.stubGlobal('fetch', server())
    const { sheet } = renderSheet(<ClassSheet id="cls_1" tab="dates" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Run it again on new dates' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'again', id: 'cls_1' })
  })

  it('the tabs keep their own unsaved changes, and either one counts as unsaved', async () => {
    vi.stubGlobal('fetch', server())
    const { dirty } = renderSheet(<ClassSheet id="cls_1" tab="dates" />)
    await datesLoaded()
    fireEvent.change(within(date1()).getByLabelText('Seats'), { target: { value: '14' } })
    expect(dirty()).toBe(true)
    await tabTo('Details')
    await tabTo('Dates')
    expect(within(date1()).getByLabelText('Seats')).toHaveValue('14')
    await act(async () => {})
  })
})
