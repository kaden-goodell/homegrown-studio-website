import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { PartySheet } from '@components/admin/parties/PartySheet'
import { renderSheet, posts, at } from '../sheets/harness'
import { CRAFTS, DAY, paid, party, partyServer, settings, T1 } from './fixtures'

vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: any, ref: any) => {
      useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'cnon:card-ok', kind: 'card' }) }))
      useEffect(() => { props.onReadyChange?.(true) }, [])
      return <div data-testid="square-card-box">Square card box</div>
    }),
  }
})
afterEach(() => vi.unstubAllGlobals())

const ID = 'pty_0123456789abcdef'
const ACT = '/api/admin/parties/actions.json'
const REFUND = '/api/admin/parties/refund.json'
const NEW = at('2031-03-16', '13:00')
const tell = { name: 'Stefanie Justice', phone: '(256) 555-0199', email: 'stef@example.com' }

function server(p: any = party(), routes: Record<string, any> = {}) {
  return partyServer({
    '/api/admin/party.json': { body: { data: { party: p, guests: [{ name: 'Ann Guest', kids: 2, coming: 3, waiver: 'current' }] } } },
    '/api/admin/parties/settings.json': { body: { data: { settings: settings(), legacyRemaining: { count: 0, lastIso: null } } } },
    '/api/party/service-info.json': { body: { data: { crafts: CRAFTS } } },
    '/api/admin/parties/times.json': { body: { data: { minutes: 90, offered: [T1, NEW], open: [T1, NEW] } } },
    ...routes,
  })
}
const open = () => renderSheet(<PartySheet day={DAY} id={ID} />)

describe('Party sheet', () => {
  it('shows when, who, guests, craft and what is due; Details · Guests · Payments', async () => {
    server()
    open()
    expect(await screen.findByRole('heading', { name: 'The Justice party' })).toBeInTheDocument()
    expect(screen.getAllByText('Waiting on payment').length).toBeGreaterThan(0)
    expect(screen.getByText('Stefanie Justice')).toBeInTheDocument()
    expect(screen.getByText('Beaded Necklace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guests' }))
    expect(screen.getByText('Ann Guest')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy invite link' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Payments · $300 due' }))
    expect(screen.getByText('Studio fee')).toBeInTheDocument()
    expect(screen.getByText('Still due')).toBeInTheDocument()
    expect(screen.getByText(/Crafts \(Beaded Necklace\) are rung up on the POS/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2565550199')
  })

  it('Move opens in the sheet (not the footer), lists only free party times, then keeps a Not told yet reminder with Call, Text, Write and Email', async () => {
    let cur = party()
    const NOT_TOLD = { at: '2031-03-05T15:00:00Z', what: ['time'], message: 'Stefanie hasn’t been told about the new time. Their email and calendar still say Sat, Mar 15 at 2:00 PM.' }
    const f = server(party(), {
      '/api/admin/party.json': () => ({ body: { data: { party: cur, guests: [] } } }),
      [ACT]: (b: any) => {
        if (b.action === 'move') {
          cur = party({ startIso: NEW, notTold: NOT_TOLD, sendDetails: { action: 'send-details', label: 'Email Stefanie the new details' } })
          return { body: { data: { party: cur, hostToTell: tell, message: 'Moved to Sun, Mar 16 at 1:00 PM. Nothing was sent to Stefanie, so let them know.', sendDetails: { action: 'send-details', label: 'Email Stefanie the new details' } } } }
        }
        cur = party({ startIso: NEW, told: { at: '2031-03-05T15:01:00Z', by: { id: 'o', name: 'Catherine' }, how: 'email' } })
        return { body: { data: { party: cur, sent: true, message: 'Emailed Stefanie the party details for Sun, Mar 16 at 1:00 PM, with a new calendar invite.' } } }
      },
    })
    const { container } = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
    const panel = screen.getByRole('group', { name: 'Move Stefanie’s party' })
    // I7: the Move panel is in the body, not the pinned footer (a phone keyboard can't push it off), and its heading has focus (I4).
    expect(container.querySelector('.adm-sheet-foot')?.contains(panel)).toBe(false)
    expect(within(panel).getByRole('heading', { name: 'Move Stefanie’s party' })).toHaveFocus()
    expect(container.querySelector('.adm-sheet-foot')!.textContent).not.toMatch(/Cancel party/)
    const select = await screen.findByLabelText('New day and time') as HTMLSelectElement
    const values = [...select.options].map((o) => o.value).filter(Boolean)
    expect(values).toEqual([NEW])
    fireEvent.change(select, { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Move party' }))
    // The result is kept on the sheet and its heading takes focus (read out with the text), not just a toast.
    const done = await screen.findByRole('heading', { name: 'Moved Stefanie’s party' })
    await waitFor(() => expect(done).toHaveFocus())
    expect(done).toHaveAccessibleDescription(/Nothing was sent to Stefanie, so let them know/)
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'move', startIso: NEW, fromIso: T1 })
    // I3: the reminder stays after Done, until the host is told.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    const remind = await screen.findByRole('group', { name: 'Not told yet · let Stefanie know' })
    expect(within(remind).getByText(/Their email and calendar still say Sat, Mar 15 at 2:00 PM/)).toBeInTheDocument()
    expect(within(remind).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2565550199')
    expect(within(remind).getByRole('link', { name: 'Text' })).toHaveAttribute('href', 'sms:2565550199')
    expect(within(remind).getByRole('link', { name: 'Write to Stefanie' })).toHaveAttribute('href', 'mailto:stef@example.com')
    fireEvent.click(within(remind).getByRole('button', { name: 'Email Stefanie the new details' }))
    await waitFor(() => expect(posts(f, ACT)).toHaveLength(2))
    expect(posts(f, ACT)[1].body).toEqual({ id: ID, action: 'send-details', createKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,80}$/) })
    // Told: the reminder goes, and Details says who told them and how.
    await waitFor(() => expect(screen.queryByRole('group', { name: /Not told yet/ })).toBeNull())
    expect(screen.getByText(/Emailed the details · .* · Catherine/)).toBeInTheDocument()
  })

  it('I told them: records it with the reminder the screen showed; the reminder goes', async () => {
    let cur = party({ notTold: { at: '2031-03-05T15:00:00Z', what: ['details'], message: 'Stefanie hasn’t been told about the changed details.' } })
    const f = server(party(), {
      '/api/admin/party.json': () => ({ body: { data: { party: cur, guests: [] } } }),
      [ACT]: () => { cur = party({ told: { at: '2031-03-05T15:02:00Z', by: { id: 'o', name: 'Catherine' }, how: 'owner' } }); return { body: { data: { party: cur, message: 'Noted that Stefanie has been told.' } } } },
    })
    open()
    const remind = await screen.findByRole('group', { name: 'Not told yet · let Stefanie know' })
    fireEvent.click(within(remind).getByRole('button', { name: 'I told them' }))
    expect(await screen.findByRole('heading', { name: 'Noted' })).toBeInTheDocument()
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'mark-told', notToldAt: '2031-03-05T15:00:00Z' })
    await waitFor(() => expect(screen.queryByRole('group', { name: /Not told yet/ })).toBeNull())
    expect(screen.getByText(/Told by phone or text · .* · Catherine/)).toBeInTheDocument()
  })

  it('a cancelled party not told yet: only I told them (no email), and the refund confirm never says it stays booked (I5)', async () => {
    server(paid({ status: 'cancelled', paymentState: 'cancelled', dueCents: 0, sendDetails: null, cancelled: { at: '2031-03-03T15:00:00Z', by: { id: 'o', name: 'Catherine' }, note: '' }, notTold: { at: '2031-03-03T15:00:00Z', what: ['cancelled'], message: 'Stefanie hasn’t been told the party is cancelled. Call or text them, then tap I told them.' } }))
    open()
    const remind = await screen.findByRole('group', { name: 'Not told yet · let Stefanie know' })
    expect(within(remind).queryByRole('button', { name: /Email/ })).toBeNull()
    expect(within(remind).getByRole('button', { name: 'I told them' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    expect(screen.getByText('Refund $300 to Stefanie Justice? This sends money back to their card. The party stays cancelled.')).toBeInTheDocument()
    expect(screen.queryByText(/stays booked/)).toBeNull()
  })


  it('a move refused shows the server’s sentence in the panel', async () => {
    server(party(), { [ACT]: { status: 409, body: { error: 'Stefanie’s $300 payment by link is going through right now. Wait 10 minutes, then check Payments on this party and try again.' } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
    fireEvent.change(await screen.findByLabelText('New day and time'), { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Move party' }))
    expect(await screen.findByText(/payment by link is going through right now/)).toBeInTheDocument()
  })

  it('a move that may not have finished (both times held) offers Finish the move, which sends the times the server named', async () => {
    const OLD = T1
    const f = server(party(), {
      [ACT]: [
        { status: 503, body: { error: 'The move may not have finished, and the party couldn’t be checked just now. For now both Sun, Mar 9 at 1:00 PM and Sun, Mar 16 at 1:00 PM are held for it, so nobody else can book either. In a minute, tap Finish the move. That finishes it either way.', both: { from: OLD, to: NEW } } },
        { body: { data: { party: party({ startIso: NEW }), hostToTell: tell, message: 'Moved to Sun, Mar 16 at 1:00 PM. Nothing was sent to Stefanie, so let them know.', sendDetails: { action: 'send-details', label: 'Email Stefanie the new details' } } } },
      ],
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
    fireEvent.change(await screen.findByLabelText('New day and time'), { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Move party' }))
    expect(await screen.findByText(/tap Finish the move/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish the move' }))
    await screen.findByRole('heading', { name: 'Moved Stefanie’s party' })
    expect(posts(f, ACT)[1].body).toEqual({ id: ID, action: 'move', startIso: NEW, fromIso: OLD })
  })

  it('Another time on Move says any day, 8 AM to 8 PM', async () => {
    server()
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Another time' }))
    expect(screen.getByText('Any day, starting between 8 AM and 8 PM. It’s checked against classes, other parties, the café and blocked time when you book.')).toBeInTheDocument()
    const time = screen.getByLabelText('Start time')
    expect(time).toHaveAttribute('min', '08:00')
    expect(time).toHaveAttribute('max', '20:00')
  })

  it('Email the details: off while it sends, a new key for each tap, and a send that failed can be tapped again', async () => {
    const f = server()
    const base = f.getMockImplementation()!
    const sends: any[] = []
    let finish!: (v: any) => void
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const body = init?.method === 'POST' ? JSON.parse(init.body) : null
      if (body?.action === 'send-details') {
        sends.push(body)
        return new Promise((r) => { finish = r })
      }
      return base(url, init)
    }))
    const answer = (data: any, warning?: string) => ({ ok: true, status: 200, json: async () => ({ data, ...(warning ? { warning } : {}) }) })
    open()
    const button = await screen.findByRole('button', { name: 'Email Stefanie the details' })
    fireEvent.click(button)
    fireEvent.click(button) // a double tap while the first is going
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    expect(sends).toHaveLength(1)
    const failed = 'The email to Stefanie didn’t go out. Check the email address on the party, then tap Email Stefanie the details again.'
    finish(answer({ party: party(), sent: false, message: failed }, failed))
    // m3: the result stays on the sheet, and the button stays to tap again
    expect(await screen.findByRole('heading', { name: 'Email' })).toHaveAccessibleDescription(failed)
    fireEvent.click(await screen.findByRole('button', { name: 'Email Stefanie the details' }))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].createKey).not.toBe(sends[0].createKey)
    finish(answer({ party: party(), sent: true, message: 'Emailed Stefanie the party details for Sun, Mar 9 at 1:00 PM, with a new calendar invite.' }))
    expect(await screen.findByRole('heading', { name: 'Email' })).toHaveAccessibleDescription(/^Emailed Stefanie the party details/)
  })

  it('Email the details failing outright (an error answer) is kept on the sheet, not only a toast (m3)', async () => {
    server(party(), { [ACT]: { status: 503, body: { error: 'The party couldn’t be reached. Try again.' } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Email Stefanie the details' }))
    expect(await screen.findByRole('heading', { name: 'Email' })).toHaveAccessibleDescription('The party couldn’t be reached. Try again.')
    expect(screen.getByRole('button', { name: 'Email Stefanie the details' })).toBeEnabled()
  })

  it('Email the details: the network drops → one automatic retry with the same key (never a second email for one tap)', async () => {
    const f = server()
    const base = f.getMockImplementation()!
    const sends: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const body = init?.method === 'POST' ? JSON.parse(init.body) : null
      if (body?.action === 'send-details') {
        sends.push(body)
        if (sends.length === 1) throw new TypeError('Failed to fetch')
        return { ok: true, status: 200, json: async () => ({ data: { party: party(), sent: true, replay: true, message: 'Emailed Stefanie the party details for Sun, Mar 9 at 1:00 PM, with a new calendar invite.' } }) }
      }
      return base(url, init)
    }))
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Email Stefanie the details' }))
    expect(await screen.findByRole('heading', { name: 'Email' }, { timeout: 4000 })).toHaveAccessibleDescription(/^Emailed Stefanie the party details/)
    expect(sends).toHaveLength(2)
    expect(sends[1].createKey).toBe(sends[0].createKey)
  })

  it('Cancel asks first, names the host and the money, and says nothing is refunded', async () => {
    const f = server(paid(), { [ACT]: { body: { data: { party: paid({ status: 'cancelled', paymentState: 'cancelled' }), hostToTell: tell, message: 'Cancelled. Nothing was refunded. Nothing was sent to Stefanie, so let them know. To give money back, use Refund on the Payments tab.' } } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel party' }))
    const ask = screen.getByRole('group', { name: 'Cancel Stefanie’s party?' })
    expect(within(ask).getByText(/Stefanie Justice has paid \$300\./)).toBeInTheDocument()
    expect(within(ask).getByText('The time opens up on the calendar. This does not refund anything, and nothing is sent to Stefanie. Use Refund on the Payments tab if they should get money back.')).toBeInTheDocument()
    expect(within(ask).getByRole('heading', { name: 'Cancel Stefanie’s party?' })).toHaveFocus()
    expect(posts(f, ACT)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel party' }))
    const done = await screen.findByRole('heading', { name: 'Cancelled Stefanie’s party' })
    await waitFor(() => expect(done).toHaveFocus())
    expect(done).toHaveAccessibleDescription(/Cancelled. Nothing was refunded./)
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'cancel' })
  })

  it('Payments: Send payment link, then Send it again with when it last went', async () => {
    const f = server(party({ linkSent: [{ at: '2031-03-02T15:14:00Z', by: null, email: true, text: true }] }), {
      [ACT]: { body: { data: { party: party(), message: 'The payment link for the studio fee ($300) went to Stefanie by email and text.' } } },
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Payments/ }))
    expect(screen.getByText(/Last sent .* by email and text\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send it again' }))
    fireEvent.click(screen.getByRole('button', { name: /Send it again|Sending/ })) // m16: a double tap sends once
    expect(await screen.findByRole('heading', { name: 'Payment link' })).toHaveAccessibleDescription('The payment link for the studio fee ($300) went to Stefanie by email and text.')
    expect(posts(f, ACT)).toHaveLength(1)
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'send-link' })
  })

  it('I2: the payment link is on the sheet with Copy payment link, labelled apart from the guest invite', async () => {
    const url = 'https://ourhometownstudio.com/party/pay/pty_0123456789abcdef?k=pay-key'
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    server(party({ payUrl: url }))
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Payments/ }))
    expect(screen.getByText('The link Stefanie pays $300 with. It isn’t the guest invite.')).toBeInTheDocument()
    expect(screen.getByText(url)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy payment link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url))
    expect(await screen.findByRole('heading', { name: 'Payment link' })).toHaveAccessibleDescription('Copied Stefanie’s payment link. Paste it into a text or email to Stefanie. It isn’t the guest invite.')
  })

  it('the card box open on Payments: the footer shows no Move or Cancel under it (I7)', async () => {
    server()
    const { container } = open()
    fireEvent.click(await screen.findByRole('button', { name: /^Payments/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Take card now' }))
    const foot = container.querySelector('.adm-sheet-foot') as HTMLElement
    expect(foot.textContent).not.toMatch(/Move|Cancel party/)
    expect(within(foot).getByRole('link', { name: 'Call' })).toBeInTheDocument()
  })

  it('a time still held for the party after a move (m8): Free the old time asks first, then frees only that time, with the start and version on screen (N1)', async () => {
    const OLD = at('2031-03-08', '13:00')
    const message = 'Sat, Mar 8 at 1:00 PM is free again. Stefanie’s party stays on Sat, Mar 15 at 2:00 PM. Nothing was sent to Stefanie.'
    const f = server(party({ holdState: { notHeld: null, freeable: [{ startIso: OLD, why: 'leftover' }] } }), {
      [ACT]: { body: { data: { party: { ...party(), holdState: { notHeld: null, freeable: [] } }, released: OLD, message } } },
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Free the old time \(/ }))
    const ask = screen.getByRole('group', { name: /^Free .*\?$/ })
    fireEvent.click(within(ask).getByRole('button', { name: 'Free the old time' }))
    expect(await screen.findByRole('heading', { name: 'Held time' })).toHaveAccessibleDescription(message)
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'free-time', startIso: OLD, shownStartIso: T1, shownVersion: 2 })
    // The held-time panel goes at once (the reply carries what is still held).
    await waitFor(() => expect(screen.queryByRole('group', { name: /still held$/ })).toBeNull())
  })

  it('Free the old time on a stale screen: the refusal is shown plainly, nothing claims it was freed (N1)', async () => {
    const OLD = at('2031-03-08', '13:00')
    const error = 'This party changed since this screen loaded. It’s on Sat, Mar 8 at 1:00 PM now. Nothing was freed. Check it, then try again.'
    server(party({ holdState: { notHeld: null, freeable: [{ startIso: OLD, why: 'leftover' }] } }), { [ACT]: { status: 409, body: { error, startIso: OLD } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Free the old time \(/ }))
    fireEvent.click(within(screen.getByRole('group', { name: /^Free .*\?$/ })).getByRole('button', { name: 'Free the old time' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(error)
    expect(screen.queryByText(/is free again/)).toBeNull()
  })

  it('Not told yet: Call, Text and Write to … sit in a row that stacks on narrow sheets, with no empty slots (I7)', async () => {
    server(party({ hostPhone: '', notTold: { at: '2031-03-05T15:00:00Z', what: ['details'], message: 'Stefanie hasn’t been told about the changed details.' } }))
    open()
    const remind = await screen.findByRole('group', { name: 'Not told yet · let Stefanie know' })
    const write = within(remind).getByRole('link', { name: 'Write to Stefanie' })
    expect(write.parentElement).toHaveClass('adm-contactrow')
    expect(write.parentElement!.children).toHaveLength(1)
    expect(within(remind).queryByRole('link', { name: 'Call' })).toBeNull()
  })

  it('Take card now: Square’s card box, charges what is due', async () => {
    const f = server(party(), { [ACT]: { body: { data: { party: paid(), message: 'Charged $300 for the studio fee. Stefanie got the booking confirmation by email. Crafts are paid at the studio after the party.' } } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Payments/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Take card now' }))
    expect(screen.getByTestId('square-card-box')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Charge $300' }))
    expect(await screen.findAllByText(/Charged \$300 for the studio fee/)).not.toHaveLength(0)
    expect(posts(f, ACT)[0].body).toMatchObject({ id: ID, action: 'take-card', paymentToken: 'cnon:card-ok', expectedCents: 30000 })
  })

  it('a payment going through: says whose and how long, and offers no new payment', async () => {
    const message = 'Stefanie’s $300 payment by link is going through right now. Wait 10 minutes, then check Payments on this party and try again.'
    server(party({ paymentGoingThrough: true, paymentInFlight: { state: 'charging', via: 'link', cents: 30000, until: '2031-03-02T15:24:00Z', message } }))
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Payments/ }))
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send payment link|Send it again|Take card now/ })).toBeNull()
  })

  it('Refund on a paid party names the host and the amount, and posts one charge', async () => {
    const f = server(paid(), { [REFUND]: { body: { data: { cents: 30000, emailed: true, refunds: [], refundable: {} } } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Payments' }))
    expect(screen.getByRole('link', { name: 'Receipt' })).toHaveAttribute('href', 'https://squareup.com/receipt/1')
    fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
    expect(screen.getByText('Refund $300 to Stefanie Justice? This sends money back to their card. The party stays booked.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refund $300' }))
    // m4: a full refund's confirmation stays on the sheet after the refund panel goes
    expect(await screen.findByRole('heading', { name: 'Refund' })).toHaveAccessibleDescription('Refunded $300 to Stefanie Justice. Stefanie got an email about it.')
    expect(posts(f, REFUND)[0].body).toMatchObject({ partyId: ID, chargeId: 'chg_1', cents: 30000, reason: '' })
  })

  it('two parties at once (paid after the time was taken) is said plainly', async () => {
    server(paid({ overlap: true }))
    open()
    expect(await screen.findByText('Two parties at once')).toBeInTheDocument()
  })

  it('a party booked in Square is read only: no Move, Cancel, payment or refund buttons', async () => {
    server(party({ bookingId: 'sq_bk_9', legacy: true, paymentState: 'legacy', items: [], dueCents: 0, sendDetails: null }))
    renderSheet(<PartySheet day={DAY} id="sq_bk_9" />)
    expect(await screen.findByText('Booked in Square. Change it there.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Move|Cancel|Refund|Send|Take card|Add an extra|Change details/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'Call' })).toBeInTheDocument()
  })

  it('a cancelled party says so; refunds stay possible; no Move or Cancel', async () => {
    server(paid({ status: 'cancelled', paymentState: 'cancelled', dueCents: 0, cancelled: { at: '2031-03-03T15:00:00Z', by: { id: 'owner-catherine', name: 'Catherine' }, note: '' }, sendDetails: null }))
    open()
    expect(await screen.findByText(/Nothing was refunded. \$300 is still with us/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
    expect(screen.getByRole('button', { name: 'Refund' })).toBeInTheDocument()
  })

  it('a booking notice handed over by Book a party shows on top', async () => {
    server()
    renderSheet(<PartySheet day={DAY} id={ID} />, { data: { notice: { id: ID, text: 'Booked Stefanie’s party. The payment link went out.' } } })
    expect(await screen.findByText('Booked Stefanie’s party. The payment link went out.')).toBeInTheDocument()
  })

  it('m5: Add extra keeps its key for a retry of the same choice, and gets a new one when the choice changes', async () => {
    const two = settings({ addOns: [...settings().addOns, { id: 'add_bags', label: 'Goodie bags', priceCents: 500, per: 'party', extraMinutes: 0, maxQty: 1, online: false, archived: false }] })
    const f = server(party(), {
      '/api/admin/parties/settings.json': { body: { data: { settings: two, legacyRemaining: { count: 0, lastIso: null } } } },
      [ACT]: [
        { status: 409, body: { error: 'That time is taken right after. Nothing changed.' } },
        { status: 409, body: { error: 'That time is taken right after. Nothing changed.' } },
        { body: { data: { party: party(), message: 'Added Goodie bags ($5). It’s due: send the payment link or take a card on the Payments tab.' } } },
      ],
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Payments/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add an extra' }))
    fireEvent.change(await screen.findByLabelText('Extra'), { target: { value: 'add_half' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    await screen.findByText('That time is taken right after. Nothing changed.')
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    await waitFor(() => expect(posts(f, ACT)).toHaveLength(2))
    fireEvent.change(screen.getByLabelText('Extra'), { target: { value: 'add_bags' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add it' }))
    // The result stays on the sheet, and says nothing was sent to the host.
    expect(await screen.findByRole('heading', { name: 'Extras' })).toHaveAccessibleDescription(/^Added Goodie bags \(\$5\)\. .* Nothing was sent to Stefanie\.$/)
    const keys = posts(f, ACT).map((p: any) => p.body.createKey)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('fix round: "isn’t held on the calendar" shows Hold this time again; it sends hold-again (no move, no host offer)', async () => {
    const f = server(party({ holdState: { notHeld: 'missing', freeable: [] } }), {
      [ACT]: { body: { data: { party: party(), message: 'Sat, Mar 15 at 2:00 PM is held for Stefanie’s party again. Nothing was sent to Stefanie.' } } },
    })
    open()
    const panel = await screen.findByRole('group', { name: 'Not held on the calendar' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Hold this time again' }))
    await waitFor(() => expect(posts(f, ACT)).toHaveLength(1))
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'hold-again' })
    const heading = await screen.findByRole('heading', { name: 'Held time' })
    expect(heading).toHaveAccessibleDescription(/held for Stefanie’s party again/)
    expect(within(heading.closest('[role="group"]') as HTMLElement).queryByRole('button', { name: /Email Stefanie/ })).toBeNull()
  })

  it('fix round: a cancelled party still holding its time: Free this time asks first, naming the time, then sends free-time', async () => {
    const cancelled = party({ status: 'cancelled', paymentState: 'cancelled', cancelled: { at: T1, by: { id: 'k', name: 'Kaden' }, note: '' }, holdState: { notHeld: null, freeable: [{ startIso: T1, why: 'cancelled' }] } })
    const f = server(cancelled, { [ACT]: { body: { data: { party: cancelled, message: 'Sat, Mar 15 at 2:00 PM is free again, so others can book it. Nothing was sent to Stefanie and no money moved.' } } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Free this time' }))
    expect(posts(f, ACT)).toHaveLength(0)
    const ask = screen.getByRole('group', { name: /^Free .*\?$/ })
    expect(within(ask).getByText(/so others can book it\?$/)).toBeInTheDocument()
    expect(within(ask).getByText('Nothing is sent to Stefanie and no money moves.')).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Free this time' }))
    await waitFor(() => expect(posts(f, ACT)).toHaveLength(1))
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'free-time', startIso: T1, shownStartIso: T1, shownVersion: 2 })
  })

  it('held longer than the party (extra time stopped by a lost lease): Put the end time back sends fit-hold, the panel goes at once', async () => {
    const message = 'The calendar now holds Stefanie’s party until it ends, Sat, Mar 15 at 3:30 PM. The time after it is free again. Nothing was sent to Stefanie.'
    const f = server(party({ holdState: { notHeld: null, freeable: [], longer: true } }), {
      [ACT]: { body: { data: { party: { ...party(), holdState: { notHeld: null, freeable: [] } }, message } } },
    })
    open()
    const panel = await screen.findByRole('group', { name: 'Held longer than the party' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Put the end time back' }))
    await waitFor(() => expect(posts(f, ACT)).toHaveLength(1))
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'fit-hold' })
    expect(await screen.findByRole('heading', { name: 'Held time' })).toHaveAccessibleDescription(message)
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Held longer than the party' })).toBeNull())
  })

  it('fix round: a leftover hold after a move: Free the old time names both times', async () => {
    const OLD = at('2031-03-08', '14:00')
    const f = server(party({ holdState: { notHeld: null, freeable: [{ startIso: OLD, why: 'leftover' }] } }), {
      [ACT]: { status: 409, body: { error: 'Stefanie’s $300 payment by link is going through right now.' } },
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /^Free the old time \(/ }))
    const ask = screen.getByRole('group', { name: /^Free .*\?$/ })
    expect(within(ask).getByText(/^Stefanie’s party stays on .*\. Free .*\?$/)).toBeInTheDocument()
    fireEvent.click(within(ask).getByRole('button', { name: 'Free the old time' }))
    await waitFor(() => expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'free-time', startIso: OLD, shownStartIso: T1, shownVersion: 2 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('going through right now')
  })
})

describe('Party sheet › Staff (stage 3)', () => {
  const staffRow = { event: { key: `party:${ID}`, kind: 'party', title: 'Party · 14 guests', startIso: T1, endIso: T1, status: 'on', openHref: '', roster: {}, detail: {} }, entry: null, state: 'none', needed: 1, leftTeam: [], people: [{ staffId: 'TM2', name: 'Jessica', verdict: 'can', asked: true, assigned: false, askNote: '', markNote: '', hours: '' }] }
  it('a staffing line opens the party on Staff; the section reads the party’s key', async () => {
    const f = server(party(), { '/api/admin/staffing.json': { body: { data: { row: staffRow, contacts: {} } } } })
    renderSheet(<PartySheet day={DAY} id={ID} />, { data: { staffKey: `party:${ID}` } })
    expect(await screen.findByRole('button', { name: 'Staff' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/★ Asked/)).toBeInTheDocument()
    expect(f.mock.calls.some((c: any) => String(c[0]).startsWith(`/api/admin/staffing.json?key=party%3A${ID}`))).toBe(true)
  })
})
