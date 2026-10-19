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
          return ok({ data: { decided: { what } } })
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

  it('a refusal shows in the sheet; a failed save says Didn’t save', async () => {
    const t = item({ kind: 'door-unpaid', title: 'Not paid at the counter', className: 'Looms', detail: { name: 'Dora Door', day: '2026-10-18', seats: 1 } })
    show([t], { decide: () => refuse(503, { error: 'Didn’t save. Try again.' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Free the seat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Free it' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Didn’t save. Try again.')
    expect(screen.getAllByText("Didn't save. Try again.").length).toBeGreaterThan(0)
  })
})
