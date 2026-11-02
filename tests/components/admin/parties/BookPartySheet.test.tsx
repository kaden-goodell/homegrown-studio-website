import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { BookPartySheet } from '@components/admin/parties/BookPartySheet'
import { renderSheet, posts } from '../sheets/harness'
import { CRAFTS, DAY, party, partyServer, settings, T1, T2 } from './fixtures'
import { at } from '../sheets/harness'

const cardForms: any[] = []
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: any, ref: any) => {
      cardForms.push(props)
      useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'cnon:card-ok', kind: 'card' }) }))
      useEffect(() => { props.onReadyChange?.(true); return () => props.onReadyChange?.(false) }, [])
      return <div data-testid="square-card-box">Square card box</div>
    }),
  }
})
afterEach(() => { vi.unstubAllGlobals(); cardForms.length = 0 })

const BOOK = '/api/admin/parties/book.json'
const booked = { data: { party: party(), message: 'Booked Stefanie’s party for Sun, Mar 15 at 2:00 PM. The payment link for the studio fee ($300) went to Stefanie by email and text.' } }

function server(book: any = { body: booked }, over: any = {}) {
  return partyServer({
    '/api/admin/parties/settings.json': { body: { data: { settings: settings(over.settings), legacyRemaining: { count: 0, lastIso: null } } } },
    '/api/party/service-info.json': { body: { data: { crafts: CRAFTS } } },
    '/api/admin/parties/times.json': (_b, url) => {
      const q = new URL(url, 'http://x').searchParams
      if (q.get('from') === q.get('to')) {
        return q.get('from') === DAY ? { body: { data: { minutes: 90, offered: [T1, T2], open: [T1] } } } : { body: { data: { minutes: 90, offered: [], open: [] } } }
      }
      return { body: { data: { minutes: 90, offered: [T1, T2, at('2031-03-16', '13:00')], open: [T1, at('2031-03-16', '13:00')] } } }
    },
    [BOOK]: book,
    ...over.routes,
  })
}

async function fill(opts: { day?: boolean } = {}) {
  if (opts.day !== false) fireEvent.click(await screen.findByRole('button', { name: /^2\sPM$/ }))
  fireEvent.change(await screen.findByLabelText('Craft'), { target: { value: 'craft_neck' } })
  fireEvent.change(screen.getByLabelText(/^Guests/), { target: { value: '14' } })
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Stefanie' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Justice' } })
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '(256) 555-0199' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'stef@example.com' } })
}

describe('Book a party', () => {
  it('opened on a day: its party times show, a taken one says Taken and can’t be picked', async () => {
    server()
    renderSheet(<BookPartySheet day={DAY} />)
    const times = await screen.findByRole('group', { name: 'Party times on Sat Mar 15' })
    expect(within(times).getByRole('button', { name: /^2\sPM$/ })).toBeEnabled()
    expect(within(times).getByRole('button', { name: /^4:30\sPM, taken$/ })).toBeDisabled()
  })

  it('a day with no party times says so and offers Another time and the next free times', async () => {
    server()
    renderSheet(<BookPartySheet day="2031-03-11" />)
    expect(await screen.findByText('No party times on Tue Mar 11. Pick another day, a time below, or Another time.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Another time on this day' })).toBeInTheDocument()
    const next = await screen.findByRole('group', { name: 'Next free party times' })
    fireEvent.click(within(next).getByRole('button', { name: /^Sun Mar 16 · 1\sPM$/ }))
    expect((screen.getByLabelText('Day') as HTMLInputElement).value).toBe('2031-03-16')
  })

  it('checks guests and the host’s name in place, before anything is sent', async () => {
    const f = server()
    renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.change(screen.getByLabelText(/^Guests/), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    expect(await screen.findByText('Parties are for 10 to 30 guests.')).toBeInTheDocument()
    expect(screen.getByText('Add the host’s name.')).toBeInTheDocument()
    expect(posts(f, BOOK)).toHaveLength(0)
    // m6: one alert (the footer), and focus on the first part marked
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    await waitFor(() => expect(screen.getByLabelText(/^Guests/)).toHaveFocus())
  })

  it('shows what is paid now (studio fee and extras) and what is paid at the studio (crafts, an estimate)', async () => {
    server()
    renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('checkbox', { name: /Extra half hour/ }))
    const sum = screen.getByRole('region', { name: 'What they pay' })
    expect(within(sum).getByText('Studio fee')).toBeInTheDocument()
    expect(within(sum).getByText('$50')).toBeInTheDocument()
    expect(within(sum).getAllByText('$350').length).toBeGreaterThan(0)
    expect(within(sum).getByText(/Beaded Necklace, about 14 guests/)).toBeInTheDocument()
    expect(within(sum).getByText('about $252')).toBeInTheDocument()
  })

  it('send link: posts once with a create key and opens the new party with what happened', async () => {
    const f = server()
    const { sheet, bump } = renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    expect(screen.getByText(/We email and text Stefanie a link to pay \$300 for the studio fee/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    const [body] = posts(f, BOOK).map((p: any) => p.body)
    expect(body).toMatchObject({
      startIso: T1, packageId: 'pkg_whole', guests: 14, craftId: 'craft_neck', addOns: {},
      host: { firstName: 'Stefanie', lastName: 'Justice', phone: '(256) 555-0199', email: 'stef@example.com' }, pay: { kind: 'link' },
      expectedCents: 30000, // I1: what the sheet showed
    })
    expect(body.createKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/)
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'party', day: DAY, id: 'pty_0123456789abcdef' }, { notice: expect.objectContaining({ text: booked.data.message }) })
    expect(await screen.findByText(booked.data.message)).toBeInTheDocument()
    expect(bump).toHaveBeenCalled()
  })

  it('a retried Book (no answer the first time) sends the same create key', async () => {
    const f = server([{ status: 500, body: { error: 'Something on our side didn’t answer, so we can’t tell if the party was booked. Look for it on the calendar before trying again.', code: 'unknown_outcome' } }, { body: booked }])
    const { sheet } = renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    expect(await screen.findByText(/we can’t tell if the party was booked/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    const keys = posts(f, BOOK).map((p: any) => p.body.createKey)
    expect(keys).toHaveLength(2)
    expect(keys[1]).toBe(keys[0])
  })

  it('the server’s clash sentence shows in the sheet, at the time and in the footer', async () => {
    const clash = 'That time is taken by Pottery (2–4 PM). Pick another time.'
    server({ status: 409, body: { error: clash, field: 'startIso' } })
    renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    expect(await screen.findAllByText(clash)).toHaveLength(2)
  })

  it('Take card now: Square’s card box (cards only) and no card field of ours; back to link removes it', async () => {
    server()
    renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Take card now' }))
    expect(screen.getByTestId('square-card-box')).toBeInTheDocument()
    expect(cardForms.at(-1).giftCards).toBe('cards-only')
    expect(cardForms.at(-1).wallet).toBeUndefined()
    expect(screen.queryByLabelText(/card number/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Charge $300 and book' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send payment link' }))
    expect(screen.queryByTestId('square-card-box')).toBeNull()
  })

  it('card: charges with an attempt id; a decline gets a new one next time, an unknown answer keeps it', async () => {
    const f = server([
      { status: 402, body: { error: 'The card was declined, so nothing was charged and the time was let go. Try another card, or book with Send payment link.', code: 'card_declined' } },
      { status: 502, body: { error: 'Square didn’t answer…', code: 'unknown_outcome' } },
      { body: booked },
    ])
    const { sheet } = renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Take card now' }))
    const charge = () => fireEvent.click(screen.getByRole('button', { name: 'Charge $300 and book' }))
    charge()
    expect(await screen.findByText(/The card was declined/)).toBeInTheDocument()
    charge()
    expect(await screen.findByText('Square didn’t answer…')).toBeInTheDocument()
    charge()
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    const pays = posts(f, BOOK).map((p: any) => p.body.pay)
    expect(pays.map((p: any) => p.kind)).toEqual(['card', 'card', 'card'])
    expect(pays[0].paymentToken).toBe('cnon:card-ok')
    expect(pays[1].attemptId).not.toBe(pays[0].attemptId)
    expect(pays[2].attemptId).toBe(pays[1].attemptId)
  })

  it('leaving with something typed asks first', async () => {
    server()
    const { dirty } = renderSheet(<BookPartySheet day={DAY} />)
    await screen.findByLabelText('Craft')
    expect(dirty()).toBe(false)
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'S' } })
    expect(dirty()).toBe(true)
  })

  it('I1: the price changed since the sheet opened: the server’s words with the new amount, Parties setup loads again, and the button shows the new price', async () => {
    let fee = 30000
    const words = 'The price changed to $350 since this opened, so nothing was charged or booked. The sheet now shows the new price. Check it with Stefanie, then book again.'
    const f = server(() => { fee = 35000; return { status: 409, body: { error: words, why: 'price_changed', newCents: 35000, oldCents: 30000, field: 'price' } } }, {
      routes: { '/api/admin/parties/settings.json': () => ({ body: { data: { settings: settings({ packages: [{ ...settings().packages[0], priceCents: fee }] }), legacyRemaining: { count: 0, lastIso: null } } } }) },
    })
    renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Take card now' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Charge $300 and book' }))
    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(posts(f, BOOK)[0].body.expectedCents).toBe(30000)
    expect(await screen.findByRole('button', { name: 'Charge $350 and book' })).toBeInTheDocument()
  })

  it('m7: a plain refusal booked nothing, so the next tap is a new create key', async () => {
    const f = server([{ status: 409, body: { error: 'That time is taken by Pottery (2–4 PM). Pick another time.', field: 'startIso' } }, { body: booked }])
    const { sheet } = renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    expect(await screen.findAllByText(/That time is taken/)).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /^2\sPM$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    const keys = posts(f, BOOK).map((p: any) => p.body.createKey)
    expect(keys[1]).not.toBe(keys[0])
  })

  it('m7: a lost reply then a different time: the replay names the first booking’s own time', async () => {
    const elsewhere = { data: { party: party({ startIso: at('2031-03-16', '13:00') }), replay: true, message: 'Booked Stefanie’s party for Sun, Mar 16 at 1:00 PM.' } }
    server([{ status: 500, body: { error: 'Something on our side didn’t answer, so we can’t tell if the party was booked. Look for it on the calendar before trying again.', code: 'unknown_outcome' } }, { body: elsewhere }])
    const { sheet } = renderSheet(<BookPartySheet day={DAY} />)
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    await screen.findByText(/we can’t tell if the party was booked/)
    fireEvent.click(screen.getByRole('button', { name: 'Book and send link' }))
    await waitFor(() => expect(sheet.open).toHaveBeenCalled())
    expect(sheet.open.mock.calls[0][1].notice.text).toMatch(/^This party was already booked from your first tap, for Sun Mar 16 at 1\sPM\. Nothing new was booked or sent\. Use Move if it should be at another time\.$/)
  })
})
