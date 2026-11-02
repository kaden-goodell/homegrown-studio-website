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
function server(items: any[], o: { decide?: (b: any) => any; ask?: (b: any) => any; amount?: number | null; classes?: any[]; bookings?: any[] } = {}) {
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
        // Ask Square: read only, nothing decided.
        if (post.action === 'ask') return o.ask ? o.ask(post) : refuse(503, { error: 'Square couldn’t be asked just now. Try again in a minute. Nothing was changed.' })
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

  it('refund kinds: Square couldn’t finish it (Ask Square, then Try the refund again or Mark as handled with a reason), half finished (Finish it)', async () => {
    const failed = item({ id: 'td_f', kind: 'refund-failed', title: 'Refund didn’t go through', detail: { refundCents: 500 } })
    const unfinished = item({ id: 'td_u', kind: 'refund-unfinished', title: 'Refund half finished', detail: { refundCents: 500 } })
    const unconfirmed = item({ id: 'td_n', kind: 'refund-unconfirmed', title: 'Refund with no answer', detail: { refundCents: 500 } })
    const failedAnswer = { state: 'failed', cents: 500, refundId: 'RF1', at: null, next: ['retry', 'handled'], message: 'Square shows this $5 refund failed, so the money didn’t go back.' }
    const one = show([failed, unfinished, unconfirmed], { ask: () => ok({ data: { asked: failedAnswer } }) }, 'td_f')
    expect(await screen.findByText(/Tap Ask Square to see what it shows now/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Check it in Square|Look it up in Square/)
    expect(within(footer()).queryByRole('button', { name: 'Try the refund again' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ask Square' }))
    expect(await screen.findByText('Square shows it failed')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Try the refund again' }))
    expect(screen.getByText('Try the $5 refund again?')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep it' }))
    // Mark as handled asks what happened first.
    fireEvent.click(within(footer()).getByRole('button', { name: 'Mark as handled' }))
    const save = within(footer()).getByRole('button', { name: 'Mark as handled' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'Gave cash back' } })
    fireEvent.click(save)
    await waitFor(() => expect(decisions(one.f)).toEqual([{ id: 'td_f', action: 'ask' }, { id: 'td_f', action: 'handled', reason: 'Gave cash back' }]))
    one.unmount()

    const two = show([failed, unfinished, unconfirmed], {}, 'td_u')
    fireEvent.click(await screen.findByRole('button', { name: 'Finish it' }))
    await waitFor(() => expect(decisions(two.f)).toEqual([{ id: 'td_u', action: 'finish' }]))
  })

  it('a refund with no answer: Ask Square first; then only the buttons that fit what Square shows', async () => {
    const t = item({ id: 'td_n', kind: 'refund-unconfirmed', title: 'Refund with no answer', detail: { refundCents: 500 } })
    let answer: any = { state: 'done', cents: 500, refundId: 'RF9', at: null, next: ['went-through'], message: 'Square shows a $5 refund on this payment. Tap It went through to record it here.' }
    const { f } = show([t], { ask: () => ok({ data: { asked: answer } }) }, 'td_n')
    expect(await screen.findByText(/Tap Ask Square: it reads the payment/)).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'It went through' })).toBeNull()
    expect(within(footer()).queryByRole('button', { name: 'It didn’t go through' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ask Square' }))
    expect(await screen.findByText('Square shows it went through')).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Try the refund again' })).toBeNull()
    // Square shows none: Try the refund again (the same request) or It didn’t go through.
    answer = { state: 'none', cents: 500, refundId: null, at: null, next: ['retry', 'did-not-go-through'], message: 'Square shows no $5 refund on this payment, so it didn’t go through.' }
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ask Square again' }))
    expect(await screen.findByText('Square shows no refund')).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'It went through' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Try the refund again' }))
    expect(screen.getByText(/The same request goes to Square again, so it can never refund twice/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Try the refund again' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_n', action: 'ask' }, { id: 'td_n', action: 'ask' }, { id: 'td_n', action: 'retry' }]))
  })

  it('a refund on a party: Open the party opens its sheet; a class refund has no such button', async () => {
    const t = item({ id: 'td_p', kind: 'refund-failed', title: 'Refund didn’t go through', head: 'Square couldn’t finish a $50 refund on the Justice party.', className: 'the Justice party', detail: { refundCents: 5000, partyId: 'pty_abc123', partyDay: '2026-11-14' } })
    const one = show([t], {}, 'td_p')
    expect(await screen.findByText('Square couldn’t finish a $50 refund on the Justice party.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the party' }))
    expect(one.sheet.open).toHaveBeenCalledWith({ kind: 'party', day: '2026-11-14', id: 'pty_abc123' })
    one.unmount()
    show([item({ kind: 'refund-failed', title: 'Refund didn’t go through', detail: { refundCents: 500 } })])
    expect(await screen.findByText(/Tap Ask Square to see what it shows now/)).toBeInTheDocument()
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

  it('R42: paid online with no seat: Give them their seat, Refund it, or It’s already sorted (never “in Square”)', async () => {
    const t = item({ kind: 'paid-not-seated', title: 'Paid, no seat', className: 'Looms', classId: 'cls_1', head: 'Square shows $32.70 paid for 1 seat of Looms, but the seats were let go before the booking finished. Nothing was refunded.', detail: { paidId: 'pns-O1', orderId: 'O1', why: 'no-seats', cents: 3270, seats: 1, canSeat: true, canRefund: true, canSort: true, leftCents: 3270, name: 'Ada Lovelace', email: 'ada@example.com' } })
    const { f } = show([t])
    expect(await screen.findByText('$32.70')).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Refund it' })).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'It’s already sorted' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/in Square/)
    fireEvent.click(within(footer()).getByRole('button', { name: 'Give them their seat' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'seat' }]))
  })

  it('R42: Refund it asks first, naming who and how much; It’s already sorted is confirmed too', async () => {
    const t = item({ kind: 'paid-not-seated', title: 'Paid, no seat', className: 'Looms', detail: { paidId: 'pns-O2', orderId: 'O2', why: 'other-order', cents: 3270, seats: 1, canSeat: false, canRefund: true, canSort: true, leftCents: 3270, name: 'Ada Lovelace', email: 'ada@example.com' } })
    const { f } = show([t])
    const refund = await screen.findByRole('button', { name: 'Refund it' })
    expect(within(footer()).queryByRole('button', { name: /Give them/ })).toBeNull()
    fireEvent.click(refund)
    expect(screen.getByText('Refund $32.70 to Ada Lovelace?')).toBeInTheDocument()
    expect(screen.getByText(/and Ada gets a refund email/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep it' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'It’s already sorted' }))
    expect(screen.getByText('Clear this $32.70 payment?')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep it' }))
    expect(decisions(f)).toEqual([])
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund it' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund $32.70' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'refund', cents: 3270 }]))
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

  it('a host not told yet (DV8): open the party, or I told them, which posts told and shows Done', async () => {
    const t = item({ kind: 'party-not-told', title: 'Host not told yet', head: 'Stefanie hasn’t been told about the new time (Sun Mar 16 1 PM). Nothing is sent to them on its own.', className: 'the Justice party',
      detail: { partyId: 'pty_0123456789abcdef', partyDay: '2031-03-16', notToldAt: '2031-03-05T15:00:00Z', cancelled: false, host: 'Stefanie Justice' } })
    const { f, sheet } = show([t])
    expect(await screen.findByText(t.head)).toBeInTheDocument()
    expect(screen.getByText(/Open the party to email them the new details and a calendar invite/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open the party' }))
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'party', day: '2031-03-16', id: 'pty_0123456789abcdef' })
    fireEvent.click(within(footer()).getByRole('button', { name: 'I told them' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_1', action: 'told' }]))
    expect(await screen.findByText(/^Done · /)).toBeInTheDocument()
  })

  it('Task 13: an unclear payment on a booked party: Ask Square first, then only the buttons that fit; Square’s refusal shows in the sheet; Open the party', async () => {
    const t = item({ id: 'td_pp', kind: 'party-payment-unclear', title: 'Party payment unclear', head: 'Stefanie Justice’s $300 payment (payment link) for their party on Sat Nov 14 2 PM got no answer from Square.',
      detail: { partyId: 'pty_abc123', partyDay: '2026-11-14', cents: 30000, via: 'link', until: '2026-11-03T15:00:00.000Z' } })
    let answer: any = { state: 'done', cents: 30000, refundId: null, at: null, title: 'Square shows it paid', next: ['went-through'], message: 'Square shows this payment went through. Tap It went through, so it’s recorded on the party.' }
    const one = show([t], { ask: () => ok({ data: { asked: answer } }), decide: (b) => (b.action === 'went-through' ? refuse(409, { error: 'Square shows no payment on this order yet, so nothing was recorded.' }) : null) }, 'td_pp')
    expect(await screen.findByText('$300')).toBeInTheDocument()
    expect(screen.getByText(/Nothing is charged or refunded from here\./)).toBeInTheDocument()
    expect(screen.queryByText(/Look for it in Square/)).toBeNull()
    expect(within(footer()).queryByRole('button', { name: 'It went through' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ask Square' }))
    expect(await screen.findByText('Square shows it paid')).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'It didn’t go through' })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'It went through' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Square shows no payment on this order yet, so nothing was recorded.')
    answer = { state: 'none', cents: 0, refundId: null, at: null, title: 'Square has no order for it', next: ['did-not-go-through'], message: 'Square has no order for this payment, so nothing was paid. It clears by itself within a day, or tap It didn’t go through.' }
    fireEvent.click(within(footer()).getByRole('button', { name: 'Ask Square again' }))
    expect(await screen.findByText('Square has no order for it')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'It didn’t go through' }))
    await waitFor(() => expect(decisions(one.f)).toEqual([{ id: 'td_pp', action: 'ask' }, { id: 'td_pp', action: 'went-through' }, { id: 'td_pp', action: 'ask' }, { id: 'td_pp', action: 'did-not-go-through' }]))
    one.unmount()
    const two = show([t], {}, 'td_pp')
    fireEvent.click(await screen.findByRole('button', { name: 'Open the party' }))
    expect(two.sheet.open).toHaveBeenCalledWith({ kind: 'party', day: '2026-11-14', id: 'pty_abc123' })
  })

  it('Task 13: a paid party with no confirmation: open the party to email the details, then Done', async () => {
    const t = item({ id: 'td_nc', kind: 'party-no-confirmation', title: 'Party booked, no confirmation', head: 'Alice Smith’s party is paid and booked, but the booking stopped before their confirmation email went out.', detail: { partyId: 'pty_abc', partyDay: '2026-11-14' } })
    const { f } = show([t], {}, 'td_nc')
    expect(await screen.findByText(/Open the party and tap the button that emails the host the details/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_nc', action: 'sorted' }]))
  })

  it('Task 13: a paid party order from an earlier try the customer changed says so, with Refund it (never “refund it in Square”)', async () => {
    const t = item({ id: 'td_rt', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', orderId: 'O', cents: 30000, elsewhere: true, why: 'retired', name: 'Alice Smith', canApply: false } })
    show([t], {}, 'td_rt')
    expect(await screen.findByText(/paid on an earlier try that Alice changed and started again, so it isn’t booked/)).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Refund it' })).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Put it toward the party' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/refund[^.]*in Square|Sorted it in Square/i)
  })

  it('fix round 2: Refund it asks first, naming who and how much, then sends; Keep it sends nothing', async () => {
    const t = item({ id: 'td_pe', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', orderId: 'O', cents: 30000, elsewhere: true, why: 'retired', name: 'Alice Smith', email: 'alice@example.com', canApply: false } })
    const { f } = show([t], {}, 'td_pe')
    fireEvent.click(await screen.findByRole('button', { name: 'Refund it' }))
    expect(screen.getByText('Refund $300 to Alice Smith?')).toBeInTheDocument()
    expect(screen.getByText(/goes back to their card, and Alice gets a refund email/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep it' }))
    expect(decisions(f)).toEqual([])
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund it' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund $300' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_pe', action: 'refund', cents: 30000 }]))
  })

  it('M6: no email on file: the confirm promises no email', async () => {
    const t = item({ id: 'td_ne', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', orderId: 'O', cents: 30000, elsewhere: true, why: 'no-checkout', name: 'Alice Smith', email: '', canApply: false } })
    show([t], {}, 'td_ne')
    fireEvent.click(await screen.findByRole('button', { name: 'Refund it' }))
    expect(screen.getByText(/no email on file, so nobody is emailed/)).toBeInTheDocument()
    expect(screen.queryByText(/gets a refund email/)).toBeNull()
  })

  it('M1/M2: a refund Square never answered: the note says so, only Refund it (no Put it toward, no It’s already sorted)', async () => {
    const t = item({ id: 'td_rs', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', orderId: 'O', cents: 30000, elsewhere: true, why: 'other-payment', name: 'Stefanie Justice', canApply: false, refundStarted: true, startedCents: 30000, canRefund: true, canSort: false, dueCents: 30000 } })
    show([t], {}, 'td_rs')
    expect(await screen.findByText(/was sent to Square and it never answered/)).toBeInTheDocument()
    expect(within(footer()).getByRole('button', { name: 'Refund it' })).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: 'Put it toward the party' })).toBeNull()
    expect(within(footer()).queryByRole('button', { name: 'It’s already sorted' })).toBeNull()
  })

  it('I2: Square already refunded it: the item says so and offers only It’s already sorted (confirmed)', async () => {
    const t = item({ id: 'td_bk', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', orderId: 'O', cents: 30000, elsewhere: true, why: 'retired', name: 'Alice Smith', canApply: false, backCents: 30000, leftCents: 0, canRefund: false, canSort: true } })
    const { f } = show([t], {}, 'td_bk')
    expect(await screen.findByText('Refunded in Square')).toBeInTheDocument()
    expect(screen.getByText(/Square already refunded this \$300/)).toBeInTheDocument()
    expect(within(footer()).queryByRole('button', { name: /Refund/ })).toBeNull()
    fireEvent.click(within(footer()).getByRole('button', { name: 'It’s already sorted' }))
    expect(screen.getByText(/Square already refunded it. Clearing it notes who cleared it/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Clear it' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_bk', action: 'sorted' }]))
  })

  it('M4: other-payment that can go toward the party: the note says it isn’t on the party yet and what it still owes', async () => {
    const t = item({ id: 'td_m4', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', orderId: 'O', cents: 30000, elsewhere: true, why: 'other-payment', name: 'Stefanie Justice', canApply: true, dueCents: 30000 } })
    show([t], {}, 'td_m4')
    expect(await screen.findByText('Square shows $300 paid on Stefanie’s party from another order (an older link or a second try), so it isn’t on the party yet. The party still owes $300: put it toward that, or refund it.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/already paid by another order/)
  })

  it('fix round 2: a payment the party still owes can go toward it, confirmed first; Square’s refusal shows in the sheet', async () => {
    const t = item({ id: 'td_pa', kind: 'party-paid-unclear', title: 'Party payment to check', detail: { partyId: 'pty_x', partyDay: '2026-11-14', orderId: 'O', cents: 30000, elsewhere: true, why: 'other-payment', name: 'Stefanie Justice', canApply: true, dueCents: 30000 } })
    const { f } = show([t], { decide: (b) => (b.action === 'refund' ? refuse(502, { error: "Square didn't confirm the refund. Try again. It won't refund twice." }) : null) }, 'td_pa')
    expect(await screen.findByText('The party owes')).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund it' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Refund $300' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("It won't refund twice.")
    fireEvent.click(within(footer()).getByRole('button', { name: 'Keep it' }))
    fireEvent.click(within(footer()).getByRole('button', { name: 'Put it toward the party' }))
    expect(screen.getByText('Put $300 toward Stefanie’s party?')).toBeInTheDocument()
    expect(screen.getByText(/No money moves and nothing is sent to Stefanie/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Put it toward the party' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_pa', action: 'refund', cents: 30000 }, { id: 'td_pa', action: 'apply' }]))
  })
  it('fix round: the Square order is its own row with Copy', async () => {
    const t = item({ id: 'td_po', kind: 'party-payment-unclear', title: 'Party payment unclear', detail: { partyId: 'pty_abc123', partyDay: '2026-11-14', cents: 30000, via: 'link', orderId: 'ORD_123' } })
    show([t], {}, 'td_po')
    expect(await screen.findByText('ORD_123')).toBeInTheDocument()
    expect(screen.getByText('Square order')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('fix round: a held time with no party: Free this time asks first, then sends; a refusal shows in the sheet', async () => {
    const t = item({ id: 'td_ho', kind: 'party-hold-orphan', title: 'Party time held, no party', head: 'Sat Nov 14 2 PM is held for a party that isn’t on the books, so nobody can book that time.',
      detail: { partyId: 'pty_orphan', startIso: '2026-11-14T20:00:00.000Z', endIso: '2026-11-14T21:30:00.000Z' } })
    const { f } = show([t], { decide: () => refuse(409, { error: 'This time was held only a few minutes ago, so it may be a booking still being paid.' }) }, 'td_ho')
    fireEvent.click(await screen.findByRole('button', { name: 'Free this time' }))
    expect(decisions(f)).toEqual([])
    expect(screen.getByText(/so nobody is told and no money moves/)).toBeInTheDocument()
    fireEvent.click(within(footer()).getByRole('button', { name: 'Free this time' }))
    await waitFor(() => expect(decisions(f)).toEqual([{ id: 'td_ho', action: 'free' }]))
    expect(await screen.findByRole('alert')).toHaveTextContent('it may be a booking still being paid')
  })
})
