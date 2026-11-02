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

  it('Move lists only free party times (not its own), sends where it was, then says to let the host know', async () => {
    const f = server(party(), {
      [ACT]: (b: any) => b.action === 'move'
        ? { body: { data: { party: party({ startIso: NEW }), hostToTell: tell, message: 'Moved to Sun, Mar 16 at 1:00 PM. Nothing was sent to Stefanie, so let them know.', sendDetails: { action: 'send-details', label: 'Email Stefanie the new details' } } } }
        : { body: { data: { party: party(), sent: true, message: 'Emailed Stefanie the party details for Sun, Mar 16 at 1:00 PM, with a new calendar invite.' } } },
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Move' }))
    const select = await screen.findByLabelText('New day and time') as HTMLSelectElement
    const values = [...select.options].map((o) => o.value).filter(Boolean)
    expect(values).toEqual([NEW])
    fireEvent.change(select, { target: { value: NEW } })
    fireEvent.click(screen.getByRole('button', { name: 'Move party' }))
    const told = await screen.findByRole('status', { name: 'Let Stefanie know' })
    expect(within(told).getByText(/Nothing was sent to Stefanie, so let them know/)).toBeInTheDocument()
    expect(within(told).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:2565550199')
    expect(within(told).getByRole('link', { name: 'Text' })).toHaveAttribute('href', 'sms:2565550199')
    expect(within(told).getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:stef@example.com')
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'move', startIso: NEW, fromIso: T1 })
    fireEvent.click(within(told).getByRole('button', { name: 'Email Stefanie the new details' }))
    await waitFor(() => expect(posts(f, ACT)).toHaveLength(2))
    expect(posts(f, ACT)[1].body).toEqual({ id: ID, action: 'send-details', createKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,80}$/) })
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
    await screen.findByRole('status', { name: 'Let Stefanie know' })
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
    expect(await screen.findByText(failed)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Email Stefanie the details' }))
    await waitFor(() => expect(sends).toHaveLength(2))
    expect(sends[1].createKey).not.toBe(sends[0].createKey)
    finish(answer({ party: party(), sent: true, message: 'Emailed Stefanie the party details for Sun, Mar 9 at 1:00 PM, with a new calendar invite.' }))
    expect(await screen.findByText(/^Emailed Stefanie the party details/)).toBeInTheDocument()
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
    expect(await screen.findByText(/^Emailed Stefanie the party details/, {}, { timeout: 4000 })).toBeInTheDocument()
    expect(sends).toHaveLength(2)
    expect(sends[1].createKey).toBe(sends[0].createKey)
  })

  it('Cancel asks first, names the host and the money, and says nothing is refunded', async () => {
    const f = server(paid(), { [ACT]: { body: { data: { party: paid({ status: 'cancelled', paymentState: 'cancelled' }), hostToTell: tell, message: 'Cancelled. Nothing was refunded. Nothing was sent to Stefanie, so let them know. To give money back, use Refund on the Payments tab.' } } } })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel party' }))
    const ask = screen.getByRole('group', { name: 'Cancel Stefanie’s party?' })
    expect(within(ask).getByText(/Stefanie Justice has paid \$300\./)).toBeInTheDocument()
    expect(within(ask).getByText('The time opens up on the calendar. This does not refund anything. Use Refund on the Payments tab if they should get money back.')).toBeInTheDocument()
    expect(posts(f, ACT)).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel party' }))
    const told = await screen.findByRole('status', { name: 'Let Stefanie know' })
    expect(within(told).getByText(/Cancelled. Nothing was refunded./)).toBeInTheDocument()
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
    expect(await screen.findByText('The payment link for the studio fee ($300) went to Stefanie by email and text.')).toBeInTheDocument()
    expect(posts(f, ACT)[0].body).toEqual({ id: ID, action: 'send-link' })
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
    expect(await screen.findByText(/Refunded \$300 to Stefanie Justice\. Stefanie got an email about it\./)).toBeInTheDocument()
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
})
