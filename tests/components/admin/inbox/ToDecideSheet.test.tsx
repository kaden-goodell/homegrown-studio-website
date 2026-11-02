import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { screen, fireEvent, within, waitFor, configure } from '@testing-library/react'
import { InboxProvider } from '@components/admin/inbox/InboxData'
import { ToDecideSheet } from '@components/admin/inbox/ToDecideSheet'
import { at, booking, cls, content, ok, posts, refuse, renderSheet } from '../sheets/harness'

// These sheets load, save, then reload; under a full parallel run that can take more than the default second.
configure({ asyncUtilTimeout: 5000 })

const TO_DECIDE = '/api/admin/to-decide.json'
afterEach(() => vi.unstubAllGlobals())

const item = (over: any) => ({ id: 'td_1', title: 'Title', head: 'What happened.', hint: 'Do it', at: '2026-10-18T16:42:00.000Z', detail: {}, ...over })

/** The routes the sheet and the inbox use. A decision marks the item done (as the server's list then shows it). */
function server(items: any[], o: { decide?: (b: any) => any; amount?: number | null; classes?: any[]; bookings?: any[] } = {}) {
  let list = items
  return vi.fn(async (url: string, init?: any) => {
    const path = url.split('?')[0]
    const post = init?.method === 'POST' ? JSON.parse(init.body) : null
    switch (path) {
      case '/api/admin/event-requests.json': return ok({ data: { requests: [] } })
      case '/api/admin/messages.json': return ok({ data: { messages: [] } })
      case '/api/admin/applications.json': return ok({ data: { applications: [] } })
      case '/api/admin/classes/classes.json': return ok({ data: { classes: o.classes ?? [], seatsTaken: {} } })
      case '/api/admin/classes/bookings.json': return ok({ data: { class: cls(), bookings: o.bookings ?? [] } })
      case TO_DECIDE:
        if (!post) {
          if (url.includes('?id=')) return ok({ data: { item: list[0], amountCents: o.amount ?? null } })
          return ok({ data: { items: list } })
        }
        if (post.action === 'names') return ok({ data: { named: post.names.filter((x: any) => x.name.trim()).length } })
        if (post.action === 'texted') {
          // R40: a note; the item keeps waiting.
          list = list.map((i) => (i.id === post.id ? { ...i, detail: { ...i.detail, note: { what: 'Texted the people booked', by: 'Catherine', at: '2026-10-19T15:00:00.000Z' } } } : i))
          return ok({ data: { decided: { what: 'Texted the people booked' }, noted: true } })
        }
        if (post.action === 'undo') {
          list = list.map((i) => (i.id === post.id ? { ...i, done: undefined } : i))
          return ok({ data: { undone: post.id } })
        }
        {
          const answer = o.decide?.(post)
          // Like the real server: a decision that went through comes back Done in the list.
          const what = answer ? (answer.ok ? (answer as any).what ?? `did ${post.action}` : '') : `did ${post.action}`
          if (!answer || answer.ok) list = list.map((i) => (i.id === post.id ? { ...i, done: what, doneBy: 'Catherine', doneAt: '2026-10-19T15:00:00.000Z' } : i))
          if (answer) return answer
          // A seat freed by this decision can be taken back (the server sends what to undo).
          return ok({ data: { decided: { what, ...(post.action === 'free' ? { undo: { classId: 'cls_1', entries: [{ lineId: 'led_b', entryId: 'rfe_1' }] } } : {}) } } })
        }
    }
    throw new Error(`unexpected ${url}`)
  })
}
function show(items: any[], o: Parameters<typeof server>[1] = {}, id = 'td_1') {
  const f = server(items, o)
  vi.stubGlobal('fetch', f)
  const r = renderSheet(<InboxProvider><ToDecideSheet id={id} /></InboxProvider>)
  return { f, ...r }
}
const footer = () => document.querySelector('.adm-sheet-foot') as HTMLElement
const decisions = (f: any) => posts(f, TO_DECIDE).map((p: { body: any }) => p.body)

describe('To decide sheets', () => {
  it('a counter sale: when, amount and item; the guessed class; a pick-a-day class asks for its date; Match, then names', async () => {
    const camp = cls({ id: 'cls_camp', content: content({ name: 'Camp', passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }, { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }] }),
      sessions: [{ id: 'ses_a', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '12:00'), capacity: 8 }, { id: 'ses_b', startIso: at('2031-03-13', '10:00'), endIso: at('2031-03-13', '12:00'), capacity: 8 }] })
    const t = item({ kind: 'pos-unmatched', title: 'Counter sale to match', head: '2 × Camp rung up at the counter', detail: { orderId: 'O1', lineUid: 'L1', name: 'Camp', qty: 2, at: '2026-10-18T16:42:00.000Z', guessClassId: 'cls_camp' } })
    const { f } = show([t], {
      amount: 6540, classes: [camp],
      decide: (b) => (b.action === 'match' ? { ...ok({ data: { decided: { what: 'Added 2 seats to Camp · Thu Mar 13' }, classId: 'cls_camp', seats: [{ lineId: 'led_1', seat: 1, named: false }, { lineId: 'led_2', seat: 2, named: false }] } }), what: 'Added 2 seats to Camp · Thu Mar 13' } : null),
    })
    expect(await screen.findByText('$65.40')).toBeInTheDocument()
    expect(screen.getByText('Sun Oct 18 · 11:42 AM')).toBeInTheDocument()
    expect(screen.getByText('2 × Camp')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Which class?')).toHaveValue('cls_camp'))
    fireEvent.change(screen.getByLabelText('Which seat?'), { target: { value: 'day:person' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Match to this class' }))
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent('Pick the date.')
    fireEvent.click(screen.getByLabelText(/Thu Mar 13/))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Match to this class' }))
    expect(await screen.findByRole('heading', { name: 'Who are the seats for?' })).toBeInTheDocument()
    expect(decisions(f)[0]).toEqual({ id: 'td_1', action: 'match', classId: 'cls_camp', passId: 'day', ticketTypeId: 'person', sessionIds: ['ses_b'] })
    expect(screen.getByText('Done. Added 2 seats to Camp · Thu Mar 13.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Seat 1'), { target: { value: 'Erin Smith' } })
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add names' }))
    await waitFor(() => expect(decisions(f)[1]).toEqual({ action: 'names', classId: 'cls_camp', names: [{ lineId: 'led_1', name: 'Erin Smith' }, { lineId: 'led_2', name: '' }] }))
    expect(await screen.findByText('Added a name.')).toBeInTheDocument()
    // Then, and only then, the list reloads and the item reads Done.
    expect(await screen.findByText('Done · Added 2 seats to Camp · Thu Mar 13')).toBeInTheDocument()
  })

  it('N3: leaving during "Who are the seats for?" still reloads the list', async () => {
    const camp = cls({ id: 'cls_camp', content: content({ name: 'Camp' }) })
    const t = item({ kind: 'pos-unmatched', title: 'Counter sale to match', detail: { orderId: 'O1', lineUid: 'L1', name: 'Camp', qty: 1, at: '2026-10-18T16:42:00.000Z', guessClassId: 'cls_camp', guessKey: null } })
    const f = server([t], {
      classes: [camp],
      decide: (b) => (b.action === 'match' ? ok({ data: { decided: { what: 'Added 1 seat to Camp' }, classId: 'cls_camp', seats: [{ lineId: 'led_1', seat: 1, named: false }] } }) : null),
    })
    vi.stubGlobal('fetch', f)
    // The shell closing the sheet: the sheet goes, the inbox stays.
    function Shell() {
      const [open, setOpen] = useState(true)
      return <>{open && <ToDecideSheet id="td_1" />}<button type="button" onClick={() => setOpen(false)}>Close the sheet</button></>
    }
    renderSheet(<InboxProvider><Shell /></InboxProvider>)
    await waitFor(() => expect(screen.getByLabelText('Which class?')).toHaveValue('cls_camp'))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Match to this class' }))
    expect(await screen.findByRole('heading', { name: 'Who are the seats for?' })).toBeInTheDocument()
    const lists = () => f.mock.calls.filter((c: any[]) => String(c[0]) === TO_DECIDE && !c[1]?.method).length
    const before = lists()
    fireEvent.click(screen.getByRole('button', { name: 'Close the sheet' }))
    await waitFor(() => expect(lists()).toBe(before + 1))
  })

  it('a counter sale that was not for a class: Not for a class, then Done', async () => {
    const t = item({ kind: 'pos-unmatched', title: 'Counter sale to match', detail: { orderId: 'O1', lineUid: 'L1', name: 'Gift', qty: 1, at: '2026-10-18T16:42:00.000Z', guessClassId: null } })
    const { f } = show([t])
    expect(await screen.findByText('See Square')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Not for a class' }))
    expect(await screen.findByText('Done · did dismiss')).toBeInTheDocument()
    expect(screen.getByText('Catherine, Mon Oct 19 · 10 AM')).toBeInTheDocument()
    expect(decisions(f)).toEqual([{ id: 'td_1', action: 'dismiss' }])
  })

  it('a refund done in Square: Free a seat asks which when several are held; Keep their seat', async () => {
    const t = item({ kind: 'refund-plain', title: 'Refund done in Square', className: 'Looms', detail: { name: 'Tori B.', refundCents: 1635, seats: [{ lineId: 'led_a', seat: 1, label: 'Person' }, { lineId: 'led_b', seat: 2, label: 'Person' }] } })
    const { f } = show([t])
    expect(await screen.findByText('Tori B. · 2 seats · Looms')).toBeInTheDocument()
    expect(screen.getByText('$16.35')).toBeInTheDocument()
    expect(screen.getByText('Freeing a seat puts it back on sale. It moves no money: the refund already happened in Square.')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Free a seat' }))
    expect(decisions(f)).toEqual([])
    expect(within(footer()).getByRole('button', { name: 'Free this seat' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Seat 2 · Person'))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Free this seat' }))
    // Asks first, naming the person; Keep it sends nothing.
    const ask = within(footer()).getByRole('group', { name: 'Free Tori B.’s seat?' })
    expect(within(ask).getByText(/Tori B\. comes off the class list/)).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }))
    expect(decisions(f)).toEqual([])
    fireEvent.click(within(footer()).getByRole('button', { name: 'Free this seat' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Free it' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'free', lineIds: ['led_b'] }]))
    expect(await screen.findByText('Done · did free')).toBeInTheDocument()
    expect(screen.getByText('Freed Tori B.’s seat. It’s back on sale.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(decisions(f).at(-1)).toEqual({ id: 'td_1', action: 'undo' }))
    expect(await screen.findByText('Undone. The seat is theirs again.')).toBeInTheDocument()
  })

  it('keep their seat', async () => {
    const t = item({ kind: 'refund-plain', title: 'Refund done in Square', className: 'Looms', detail: { name: 'Tori B.', refundCents: 1635, seats: [{ lineId: 'led_a', seat: 1, label: 'Person' }] } })
    const { f } = show([t])
    fireEvent.click(await screen.findByRole('button', { name: 'Keep their seat' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'keep' }]))
  })

  it('refund kinds: Square couldn’t finish it (Mark as handled), half finished (Finish it), no answer (went through / didn’t)', async () => {
    const failed = item({ id: 'td_f', kind: 'refund-failed', title: 'Refund didn’t go through', detail: { refundCents: 500 } })
    const unfinished = item({ id: 'td_u', kind: 'refund-unfinished', title: 'Refund half finished', detail: { refundCents: 500 } })
    const unconfirmed = item({ id: 'td_n', kind: 'refund-unconfirmed', title: 'Refund with no answer', detail: { refundCents: 500 } })
    const one = show([failed, unfinished, unconfirmed], {}, 'td_f')
    expect(await screen.findByText('Square couldn’t finish this refund. Check it in Square, then mark it handled.')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Mark as handled' }))
    await waitFor(() => expect(decisions(one.f)).toEqual([{ id: 'td_f', action: 'handled' }]))
    one.unmount()

    const two = show([failed, unfinished, unconfirmed], {}, 'td_u')
    fireEvent.click(await screen.findByRole('button', { name: 'Finish it' }))
    await waitFor(() => expect(decisions(two.f)).toEqual([{ id: 'td_u', action: 'finish' }]))
    two.unmount()

    const three = show([failed, unfinished, unconfirmed], {}, 'td_n')
    expect(await screen.findByText(/Look it up in Square, then say what you saw/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'It didn’t go through' }))
    await waitFor(() => expect(decisions(three.f)).toEqual([{ id: 'td_n', action: 'did-not-go-through' }]))
  })

  it('a refund on a party: Open the party opens its sheet; a class refund has no such button', async () => {
    const t = item({ id: 'td_p', kind: 'refund-failed', title: 'Refund didn’t go through', head: 'Square couldn’t finish a $50 refund on the Justice party.', className: 'the Justice party', detail: { refundCents: 5000, partyId: 'pty_abc123', partyDay: '2026-11-14' } })
    const one = show([t], {}, 'td_p')
    expect(await screen.findByText('Square couldn’t finish a $50 refund on the Justice party.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the party' }))
    expect(one.sheet.open).toHaveBeenCalledWith({ kind: 'party', day: '2026-11-14', id: 'pty_abc123' })
    one.unmount()
    show([item({ kind: 'refund-failed', title: 'Refund didn’t go through', detail: { refundCents: 500 } })])
    expect(await screen.findByText('Square couldn’t finish this refund. Check it in Square, then mark it handled.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open the party' })).toBeNull()
  })

  it('a counter seat that needs its day: pick one, Save the day', async () => {
    const t = item({ kind: 'pos-needs-days', title: 'Counter seat needs its day', className: 'Camp', detail: { count: 1, current: ['ses_a'], sessions: [{ id: 'ses_a', startIso: at('2031-03-12', '10:00'), endIso: at('2031-03-12', '12:00') }, { id: 'ses_b', startIso: at('2031-03-13', '10:00'), endIso: at('2031-03-13', '12:00') }] } })
    const { f } = show([t])
    expect(await screen.findByLabelText(/Wed Mar 12/)).toBeChecked()
    fireEvent.click(screen.getByLabelText(/Thu Mar 13/))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Save the day' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'set-days', sessionIds: ['ses_b'] }]))
  })

  it('short of its minimum: N of M and who is booked; Text the N booked shows the numbers and records it; never cancels', async () => {
    const t = item({ kind: 'below-minimum', title: 'Short of its minimum', classId: 'cls_1', className: 'Needlepoint 101', detail: { booked: 4, count: 6, decideByIso: at('2026-10-22', '17:00'), firstStartIso: at('2026-10-25', '18:00') } })
    const { f, sheet } = show([t], { bookings: [booking({ seats: { person: 2 } }), booking({ bookingId: 'bkg_2', customer: { givenName: 'Nora', familyName: 'F.', email: 'n@x.test', phone: '(256) 555-0111' }, seats: { person: 2 } })] })
    expect(await screen.findByText('4 of 6')).toBeInTheDocument()
    expect(screen.getByText('Thu Oct 22 · 5 PM')).toBeInTheDocument()
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('Nothing cancels on its own. If you do cancel, do it from the class.')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Text the 2 people booked' }))
    const panel = screen.getByRole('group', { name: 'Text the people booked' })
    expect(within(panel).getByLabelText('Phone numbers')).toHaveTextContent('(256) 555-0100, (256) 555-0111')
    const link = within(panel).getByRole('link', { name: 'Open Messages' })
    expect(link).toHaveAttribute('href', 'sms:/open?addresses=2565550100,2565550111')
    link.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(link)
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'texted' }]))
    // R40: noted, still waiting, with the note on the item.
    expect(await screen.findByText('Noted: you texted the people booked. It stays here until you decide.')).toBeInTheDocument()
    expect(await screen.findByText('Texted the people booked · Catherine, Mon Oct 19 · 10 AM')).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Keep it running' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the class' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'class', id: 'cls_1' })
  })

  it('N1 (R43): Text the people booked includes a refund that kept the seat, not a booking whose seats were all freed', async () => {
    const t = item({ kind: 'below-minimum', title: 'Short of its minimum', classId: 'cls_1', className: 'Needlepoint 101', detail: { booked: 1, count: 6, decideByIso: at('2026-10-22', '17:00') } })
    const kept = booking({
      bookingId: 'bkg_kept', customer: { givenName: 'Kay', familyName: 'Kept', email: 'k@x.test', phone: '(256) 555-0122' },
      seats: { person: 1 }, state: 'refunded', refundedCents: 3270, lineIds: ['led_k'],
      refundable: [{ id: 'led_k', seat: 1, ticketTypeId: 'person', sessions: 1, remainingCents: 0, sessionCents: 0, freed: false }],
    })
    const gone = booking({
      bookingId: 'bkg_gone', customer: { givenName: 'Gus', familyName: 'Gone', email: 'g@x.test', phone: '(256) 555-0133' },
      seats: { person: 1 }, state: 'refunded', refundedCents: 3270, lineIds: ['led_g'],
      refundable: [{ id: 'led_g', seat: 1, ticketTypeId: 'person', sessions: 1, remainingCents: 0, sessionCents: 0, freed: true }],
    })
    show([t], { bookings: [kept, gone] })
    expect(await screen.findByText('Kay Kept')).toBeInTheDocument()
    expect(screen.queryByText('Gus Gone')).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Text the 1 person booked' }))
    expect(within(screen.getByRole('group', { name: 'Text the people booked' })).getByLabelText('Phone numbers')).toHaveTextContent('(256) 555-0122')
  })

  it('keep a short class running', async () => {
    const t = item({ kind: 'below-minimum', title: 'Short of its minimum', classId: 'cls_1', className: 'Needlepoint 101', detail: { booked: 4, count: 6, decideByIso: at('2026-10-22', '17:00') } })
    const { f } = show([t])
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it running' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'keep-running' }]))
  })

  it('a door seat never rung up: Mark paid at the counter, or Free the seat', async () => {
    const t = item({ kind: 'door-unpaid', title: 'Not paid at the counter', className: 'Looms', detail: { name: 'Dora Door', day: '2026-10-18', seats: 1 } })
    const { f } = show([t])
    expect(await screen.findByText('Dora Door')).toBeInTheDocument()
    expect(screen.getByText('Looms · Sun Oct 18')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Mark paid at the counter' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'paid' }]))
  })

  it('a door seat: Free the seat asks first naming the person, then frees with Undo; a related counter sale is mentioned', async () => {
    const t = item({ kind: 'door-unpaid', title: 'Not paid at the counter', className: 'Looms', detail: { name: 'Dora Door', day: '2026-10-18', seats: 1, related: 'A counter sale that day was matched to Cara One. It may have been Dora Door: see “Check a counter sale”.' } })
    const { f } = show([t])
    expect(await screen.findByText(/It may have been Dora Door/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Free the seat' }))
    expect(screen.getByRole('group', { name: 'Free Dora Door’s seat?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Free it' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'free' }]))
    expect(await screen.findByText('Freed Dora Door’s seat.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('a counter sale starts on the seat its item maps to; with no clue it asks which seat', async () => {
    const camp = cls({ id: 'cls_camp', content: content({ name: 'Camp', passes: [{ id: 'all', label: 'Full series', covers: { kind: 'all' } }, { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } }] }) })
    const guessed = item({ kind: 'pos-unmatched', title: 'Counter sale to match', detail: { orderId: 'O1', lineUid: 'L1', name: 'Camp · One day', qty: 1, at: '2026-10-18T16:42:00.000Z', guessClassId: 'cls_camp', guessKey: 'day:person' } })
    const one = show([guessed], { classes: [camp] })
    await waitFor(() => expect(screen.getByLabelText('Which seat?')).toHaveValue('day:person'))
    one.unmount()
    const plain = item({ kind: 'pos-unmatched', title: 'Counter sale to match', detail: { orderId: 'O1', lineUid: 'L1', name: 'Camp', qty: 1, at: '2026-10-18T16:42:00.000Z', guessClassId: 'cls_camp', guessKey: null } })
    const two = show([plain], { classes: [camp] })
    await waitFor(() => expect(screen.getByLabelText('Which seat?')).toHaveValue(''))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Match to this class' }))
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent('Pick which seat it was.')
    expect(decisions(two.f)).toEqual([])
  })

  it('a counter sale matched to one of several door seats: Yes, or pick who it was', async () => {
    const t = item({ kind: 'counter-match-check', title: 'Check a counter sale', className: 'Looms', detail: { name: 'Cara One', lineId: 'led_c', others: [{ lineId: 'led_d', name: 'Dee Two', seat: 1 }] } })
    const { f } = show([t])
    expect(await screen.findByRole('button', { name: 'Pick who it was' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Yes, it was Cara One' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dee Two'))
    fireEvent.click(screen.getByRole('button', { name: 'It was Dee Two' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'move', toLineId: 'led_d' }]))
  })

  it('R42: paid online with no seat: Give them their seat, or say it was sorted out in Square', async () => {
    const t = item({ kind: 'paid-not-seated', title: 'Paid, no seat', className: 'Looms', classId: 'cls_1', head: 'Square shows $32.70 paid for 1 seat of Looms, but the seats were let go before the booking finished. Nothing was refunded.', detail: { paidId: 'pns-O1', orderId: 'O1', why: 'no-seats', cents: 3270, seats: 1, canSeat: true } })
    const { f } = show([t])
    expect(await screen.findByText('$32.70')).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'It’s already sorted' })).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Give them their seat' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'seat' }]))
  })

  it('R42: a second payment can only be sorted out in Square', async () => {
    const t = item({ kind: 'paid-not-seated', title: 'Paid, no seat', className: 'Looms', detail: { paidId: 'pns-O2', orderId: 'O2', why: 'other-order', cents: 3270, seats: 1, canSeat: false } })
    const { f } = show([t])
    const sorted = await screen.findByRole('button', { name: 'It’s already sorted' })
    expect(within(footer()).queryByRole('button', { name: /Give them/ })).toBeNull()
    fireEvent.click(sorted)
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'sorted' }]))
  })

  it('T15: no Undo when the decision wrote nothing to take back (the seat was already free)', async () => {
    const t = item({ kind: 'door-unpaid', title: 'Not paid at the counter', className: 'Looms', detail: { name: 'Dora Door', day: '2026-10-18', seats: 1 } })
    show([t], { decide: (b) => (b.action === 'free' ? { ...ok({ data: { decided: { what: 'Freed 1 seat' } } }), what: 'Freed 1 seat' } : null) })
    fireEvent.click(await screen.findByRole('button', { name: 'Free the seat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Free it' }))
    expect(await screen.findByText('Freed Dora Door’s seat.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('a refusal shows in the sheet; a failed save says Didn’t save', async () => {
    const t = item({ kind: 'door-unpaid', title: 'Not paid at the counter', className: 'Looms', detail: { name: 'Dora Door', day: '2026-10-18', seats: 1 } })
    show([t], { decide: () => refuse(503, { error: 'Didn’t save. Try again.' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Free the seat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Free it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Didn’t save. Try again.')
    expect(screen.getAllByText("Didn't save. Try again.").length).toBeGreaterThan(0)
  })
})

// ── Stage 4 waitlist sheets (waitlist fix round: I5, M2, M5) ────────────────
describe('To decide › waitlist', () => {
  const WL = '/api/admin/classes/waitlist.json'
  const unclear = item({
    kind: 'waitlist-unknown', title: 'Waitlist charge unclear', classId: 'cls_1', className: 'Potholder Looms',
    head: 'We charged Jane Doe’s saved card (ending 4242) $21.80 from the waitlist for Potholder Looms, and Square didn’t say whether it went through.',
    detail: { entryId: 'wle_1', name: 'Jane Doe', phone: '(402) 980-2907', email: 'jane@example.com', cents: 2180, last4: '4242', state: 'charging' },
  })
  /** The inbox's routes plus the waitlist "ask Square" answers, in order. */
  function showWaitlist(t: any, answers: any[], o: Parameters<typeof server>[1] = {}) {
    const base = server([t], o)
    let i = 0
    const f = vi.fn(async (url: string, init?: any) => {
      if (url.startsWith(WL)) return answers[Math.min(i++, answers.length - 1)]
      return base(url, init)
    })
    vi.stubGlobal('fetch', f)
    renderSheet(<InboxProvider><ToDecideSheet id="td_1" /></InboxProvider>)
    return f
  }
  const answer = (a: any) => ok({ data: { answer: { cents: 2180, decideFrom: null, choices: [], ...a } } })

  it('asks Square on open; paid → only "Add them"; the note says Check again never charges (M2)', async () => {
    const f = showWaitlist(unclear, [answer({ state: 'paid', words: 'Square shows it paid ($21.80, 3:05 PM).', choices: ['add'] })],
      { decide: (b) => (b.action === 'add' ? { ...ok({ data: { decided: { what: 'Square showed it paid. They’re added' } } }), what: 'Square showed it paid. They’re added' } : null) })
    expect(await screen.findByText('Square shows it paid ($21.80, 3:05 PM).')).toBeInTheDocument()
    expect(f.mock.calls.some(([u]: any[]) => u === `${WL}?id=cls_1&ask=wle_1`)).toBe(true)
    expect(screen.getByText(/Check Square again only asks; it never charges anyone\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /already sorted/i })).toBeNull()
    expect(within(footer()).queryByRole('button', { name: 'Keep them waiting' })).toBeNull()
    expect(within(footer()).queryByRole('button', { name: 'Take them off' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Add them' }))
    await waitFor(() => expect(decisions(f)[0]).toEqual({ id: 'td_1', action: 'add' }))
    expect(await screen.findByText('Done. Square showed it paid. They’re added.')).toBeInTheDocument()
  })

  it('no payment yet → only "Check Square again"; asking again later offers Keep / Take off, each asking first', async () => {
    const f = showWaitlist(unclear, [
      answer({ state: 'no-payment', words: 'Square shows no payment for this charge yet. A payment can take a little while to show, so give it until 3:35 PM. Their seat stays held until then.' }),
      answer({ state: 'no-payment', words: 'Square shows no payment for this charge.', choices: ['keep', 'off'] }),
    ])
    expect(await screen.findByText(/give it until 3:35 PM/)).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Add them' })).toBeNull()
    expect(within(footer()).queryByRole('button', { name: 'Keep them waiting' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Check Square again' }))
    expect(await screen.findByText('Square shows no payment for this charge.')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Take them off' }))
    const ask = screen.getByRole('group', { name: 'Take Jane Doe off the waitlist?' })
    expect(ask).toHaveTextContent('Their held seat is let go, their saved card comes off and they get an email saying so. Nothing is charged.')
    expect(decisions(f)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Not yet' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep them waiting' }))
    const keep = screen.getByRole('group', { name: 'Keep Jane Doe waiting?' })
    expect(keep).toHaveTextContent('That charge is never sent again')
    fireEvent.click(within(keep).getByRole('button', { name: 'Keep them waiting' }))
    await waitFor(() => expect(decisions(f)[0]).toEqual({ id: 'td_1', action: 'keep' }))
  })

  it('a refused decision shows the error and asks Square again; Square not answering → only Check again', async () => {
    const f = showWaitlist(unclear, [
      answer({ state: 'paid', words: 'Square shows it paid ($21.80).', choices: ['add'] }),
      answer({ state: 'unreachable', words: 'Square isn’t answering right now. Their seat stays held. Check again in a few minutes.' }),
    ], { decide: () => refuse(409, { error: 'That doesn’t match what Square shows now.' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Add them' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That doesn’t match what Square shows now.')
    expect(await screen.findByText(/Square isn’t answering right now/)).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Add them' })).toBeNull()
    expect(within(footer()).getByRole('button', { name: 'Check Square again' })).toBeInTheDocument()
    expect(f.mock.calls.filter(([u]: any[]) => String(u).startsWith(WL))).toHaveLength(2)
  })

  it('a declined card: "Got it", the head says only what went out (M5), phone and email links', async () => {
    const t = item({ kind: 'waitlist-declined', title: 'Waitlist card didn’t go through', classId: 'cls_1', className: 'Potholder Looms',
      head: 'A seat opened in Potholder Looms, but Jane Doe’s card ending 4242 didn’t go through, so they came off the waitlist and the seat went to the next person. They got an email (no text went out). Nothing was charged.',
      detail: { entryId: 'wle_1', name: 'Jane Doe', phone: '(402) 980-2907', email: 'jane@example.com', state: 'declined' } })
    const f = showWaitlist(t, [])
    expect(await screen.findByText(/They got an email \(no text went out\)\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '(402) 980-2907' })).toHaveAttribute('href', 'tel:4029802907')
    expect(screen.getByRole('link', { name: 'jane@example.com' })).toHaveAttribute('href', 'mailto:jane@example.com')
    fireEvent.click(within(footer()).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(decisions(f)[0]).toEqual({ id: 'td_1', action: 'seen' }))
  })
})

describe('D2: customers’ own cancels', () => {
  const req = (over: any = {}) => item({
    kind: 'cancel-request', title: 'Customer asked to cancel', className: 'Candles', classId: 'cls_1',
    head: 'Ada Lovelace asked to cancel 2 seats of Candles (Sat, Nov 14 · 1:00 PM CT), 30 hours before it starts. Their note: “Sick”',
    detail: { bookingId: 'bkg_1', name: 'Ada Lovelace', email: 'ada@example.com', phone: '(402) 980-2907', lineIds: ['led_a', 'led_b'], seats: 2, note: 'Sick', why: 'Your class is less than 48 hours away…', canRefund: true, refundCents: 6540, inside: true, source: 'online' },
    ...over,
  })

  it('a note: Refund and free the seat asks first, naming who and how much; Not yet sends nothing', async () => {
    const { f } = show([req()])
    expect(await screen.findByText(/asked to cancel 2 seats of Candles/)).toBeInTheDocument()
    expect(screen.getByText('$65.40')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund and free the seat' }))
    const ask = screen.getByRole('group', { name: 'Refund Ada Lovelace?' })
    expect(ask).toHaveTextContent('Refund $65.40 and free Ada Lovelace’s 2 seats?')
    fireEvent.click(within(ask).getByRole('button', { name: 'Not yet' }))
    expect(decisions(f)).toEqual([])
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund and free the seat' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Refund Ada Lovelace?' })).getByRole('button', { name: 'Refund and free the seat' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'refund' }]))
  })

  it('a gift seat offers no refund: Free the seat, no refund (asks first) or Keep their booking', async () => {
    const base = req()
    const { f } = show([{ ...base, detail: { ...base.detail, canRefund: false, refundCents: 0, source: 'comp' } }])
    await screen.findByText(/asked to cancel 2 seats/)
    expect(within(footer()).queryByRole('button', { name: 'Refund and free the seat' })).toBeNull()
    expect(screen.getByText(/This seat was a gift/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep their booking' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'keep' }]))
  })

  it('a refund Square didn’t answer: Ask Square only; a turned-down one adds Got it', async () => {
    const unclear = item({ kind: 'cancel-unclear', title: 'Customer’s cancel, refund unclear', classId: 'cls_1', detail: { bookingId: 'bkg_1', attempt: 'att_1', cents: 3270, state: 'unclear', name: 'Ada Lovelace' } })
    const { f } = show([unclear])
    await screen.findByText('Customer’s cancel, refund unclear')
    expect(within(footer()).queryByRole('button', { name: 'Got it' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ask Square' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'ask' }]))
  })

  it('turned down: Try the refund again or Got it', async () => {
    const turned = item({ kind: 'cancel-unclear', title: 'Customer’s cancel, refund turned down', classId: 'cls_1', detail: { bookingId: 'bkg_1', attempt: 'att_1', cents: 3270, state: 'turned-down', name: 'Ada Lovelace' } })
    const { f } = show([turned])
    await screen.findByText('Customer’s cancel, refund turned down')
    expect(within(footer()).getByRole('button', { name: 'Try the refund again' })).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'seen' }]))
  })
})


describe('To decide › reader payments (fix round 5)', () => {
  const mismatch = (over: any = {}) => item({
    kind: 'reader-waiting', title: 'Reader payment didn’t match', className: 'Clay Camp', classId: 'cls_1',
    head: 'Gia Winner, 1 seat of Clay Camp. Square shows a payment of $30.00 for this sale that doesn’t match the amount asked.',
    detail: { bookingId: 'bkg_1', name: 'Gia Winner', email: 'gia@example.com', cents: 3270, paidCents: 3000, choices: ['keep', 'refund', 'check'], ...over },
  })

  it('R1: a payment that didn’t match offers Keep it, they paid $X and Refund it (no Let the seat go); a shortfall is confirmed by its amount', async () => {
    const { f } = show([mismatch()], {
      decide: (b) => (b.action === 'keep' && b.confirmPaidCents === undefined
        ? refuse(409, { error: 'Square shows $30.00 paid, $2.70 less than the $32.70 seat. Keep it anyway?', short: { paidCents: 3000, askedCents: 3270, shortCents: 270 } })
        : b.action === 'keep' ? { ...ok({ data: { decided: { what: 'Kept. They paid $30 and have their seat' } } }), what: 'Kept. They paid $30 and have their seat' } : null),
    })
    const keep = await screen.findByRole('button', { name: 'Keep it, they paid $30' })
    expect(within(footer()).getByRole('button', { name: 'Refund it and let the seat go' })).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Let the seat go' })).toBeNull()
    fireEvent.click(keep)
    const confirm = await screen.findByRole('button', { name: 'Keep $30' })
    expect(within(footer()).getByText(/\$2\.70 less than the \$32\.70 seat/)).toBeInTheDocument()
    fireEvent.click(confirm)
    await waitFor(() => expect(decisions(f).at(-1)).toEqual({ id: 'td_1', action: 'keep', confirmPaidCents: 3000 }))
  })

  it('R1: Refund it asks first, naming the money, then sends refund', async () => {
    const { f } = show([mismatch()])
    fireEvent.click(await screen.findByRole('button', { name: 'Refund it and let the seat go' }))
    expect(within(footer()).getByText(/The whole payment goes back to their card and they get a refund email/)).toBeInTheDocument()
    expect(decisions(f)).toHaveLength(0)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund it' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'refund' }]))
  })

  it('M-d: a split payment offers only Refund it, and says why', async () => {
    show([mismatch({ choices: ['refund', 'check'] })])
    await screen.findByRole('button', { name: 'Refund it and let the seat go' })
    expect(within(footer()).queryByRole('button', { name: /Keep it/ })).toBeNull()
    expect(screen.getByText(/split between a gift card and a card/)).toBeInTheDocument()
  })

  it('R2: a second reader payment: Refund it / It’s already sorted, each asked first', async () => {
    const t = item({ kind: 'reader-extra', title: 'Second reader payment', className: 'Clay Camp', detail: { bookingId: 'bkg_1', orderId: 'O2', name: 'Gia Winner', cents: 3270, email: 'gia@example.com' } })
    const { f } = show([t])
    fireEvent.click(await screen.findByRole('button', { name: 'It’s already sorted' }))
    expect(within(footer()).getByText(/Nothing is refunded\./)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Not yet' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund it' }))
    expect(within(footer()).getByText(/Their seat stays as it is/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund it' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'refund' }]))
  })

  it('R3: a late payment: Keep them, or Refund and free the seat (asked first)', async () => {
    const t = item({ kind: 'reader-late', title: 'Reader payment came in late', className: 'Clay Camp', detail: { bookingId: 'bkg_1', name: 'Gia Winner', cents: 3270, overCapacity: true } })
    const { f } = show([t])
    fireEvent.click(await screen.findByRole('button', { name: 'Refund and free the seat' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund and free the seat' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'refund' }]))
  })

  it('R4: a waitlist charge on a cancelled class: Refund them (asked first)', async () => {
    const t = item({ kind: 'waitlist-refund', title: 'Waitlist charge on a cancelled class', className: 'Potholder Looms', detail: { entryId: 'wle_1', bookingId: 'bkg_w', name: 'Jane Doe', cents: 2180, last4: '4242' } })
    const { f } = show([t])
    fireEvent.click(await screen.findByRole('button', { name: 'Refund them' }))
    expect(within(footer()).getByText(/card ending 4242/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund them' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'refund' }]))
  })
})
