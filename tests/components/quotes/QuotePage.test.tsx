/**
 * Task 14: the customer's quote page (/quote/<token>), Invitation style.
 * Spec §3 Public, §7 Customer page, §8; S-52..S-54.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import QuotePage, { CLOSED_LINE, CANCELLED_LINE, CHECKING_LINE } from '@components/quote/QuotePage'
import { isPrivatePartyPage } from '@lib/page-key'

// The real form loads Square's Web Payments SDK: a stand-in that tokenizes and says it is ready.
const formProps: any[] = []
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: any, ref: any) => {
      formProps.push(props)
      useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'cnon:test-token', kind: 'card' }) }))
      useEffect(() => { props.onReadyChange?.(true) }, [])
      return <div data-testid="payment-form" />
    }),
  }
})

const tier = (id: string, key: string, name: string, price: number, normal: number, extra: Record<string, unknown> = {}) => ({
  id, key, name, photoUrl: `https://img.example/${id}.jpg`,
  lines: [
    { label: 'Monogrammed tote', photoUrl: null, per: 'person', cents: 3500 },
    { label: 'Travel', photoUrl: null, per: 'event', cents: 5000 },
  ],
  normalPerPersonCents: normal, priceCents: price, totalCents: price * 20, depositCents: (price * 20) / 2, offPct: 15,
  ...extra,
})

const OPEN = {
  state: 'open',
  firstName: 'Jessyca',
  event: { startIso: '2026-12-12T23:30:00.000Z', endIso: '2026-12-13T02:30:00.000Z', guests: 20, place: 'studio' },
  note: 'You take care of everyone all year.',
  expiresAt: '2026-11-24T23:00:00.000Z',
  depositPct: 50,
  tiers: [
    tier('t1', 'simple', 'Simple', 3000, 3750),
    tier('t2', 'pick', 'Our pick', 4500, 5250),
    tier('t3', 'all', 'Everything', 6000, 7000),
  ],
  priceKey: 'pk_1',
}

type Answer = { status?: number; body: unknown } | (() => never)
let answers: { view: Answer[]; pick: Answer[]; pay: Answer[] }
let fetchMock: ReturnType<typeof vi.fn>
const respond = (a: Answer) => {
  if (typeof a === 'function') return a()
  const status = a.status ?? 200
  return { ok: status >= 200 && status < 300, status, json: async () => a.body }
}

beforeEach(() => {
  formProps.length = 0
  answers = { view: [{ body: { data: OPEN } }], pick: [], pay: [] }
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/quote/view.json')) return respond(answers.view.length > 1 ? answers.view.shift()! : answers.view[0])
    if (url === '/api/quote/pick.json') return respond(answers.pick.shift() ?? { body: { data: { ok: true } } })
    if (url === '/api/quote/pay.json') return respond(answers.pay.shift() ?? { status: 500, body: null })
    throw new Error(`unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const calls = (u: string) => fetchMock.mock.calls.filter(([url]) => url === u).map(([, init]) => JSON.parse(init.body))

async function clickHold() {
  const button = await screen.findByRole('button', { name: /^Hold my date/ })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('QuotePage: open', () => {
  it('shows the invitation: facts, tiers with prices, Our pick preselected, menu, prices, deposit, reply-by and text line', async () => {
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByRole('heading', { name: 'An Evening of Making' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/quote/view.json?t=tok_1')
    expect(screen.getByText('Hometown Studio presents')).toBeInTheDocument()
    expect(screen.getByText(/Saturday, December twelfth/)).toBeInTheDocument()
    expect(screen.getByText(/half past five to half past eight/)).toBeInTheDocument()
    expect(screen.getByText(/20 guests · at the studio/)).toBeInTheDocument()
    expect(screen.getByText('You take care of everyone all year.')).toBeInTheDocument()

    const tickets = screen.getByRole('radiogroup', { name: 'Choose your evening' })
    const buttons = within(tickets).getAllByRole('radio')
    expect(buttons).toHaveLength(3)
    expect(buttons[0]).toHaveTextContent('$30')
    expect(buttons[2]).toHaveTextContent('$60')
    expect(buttons[1]).toHaveAttribute('aria-checked', 'true')
    expect(buttons[0]).toHaveAttribute('aria-checked', 'false')

    const menu = screen.getByTestId('menu')
    expect(within(menu).getByText('Monogrammed tote')).toBeInTheDocument()
    expect(within(menu).getByText('$35')).toBeInTheDocument()
    expect(within(menu).getByText('$50')).toBeInTheDocument()
    expect(menu.querySelectorAll('.leader').length).toBe(2)
    expect(screen.getByTestId('normal-price')).toHaveTextContent('$52.50')
    expect(screen.getByTestId('normal-price').tagName).toBe('S')
    expect(screen.getByTestId('your-price')).toHaveTextContent('$45')
    expect(screen.getByTestId('total')).toHaveTextContent('$900')
    expect(screen.getByTestId('deposit')).toHaveTextContent('$450')
    expect(screen.getByText(/Kindly reply by Tuesday, November 24/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Text us at (256) 464-1710' })).toHaveAttribute('href', 'sms:+12564641710')
    expect(screen.getByText(/Questions\?/)).toBeInTheDocument()
    expect(screen.getByText(/with love, Catherine & Kaden/)).toBeInTheDocument()
    expect(screen.queryByText(/Updated/)).toBeNull()

    const props = formProps.at(-1)
    expect(props.wallet).toMatchObject({ amount: '450.00' })
    expect(typeof props.onWalletToken).toBe('function')
    // Nothing picked on load: the preselect is ours, not theirs.
    expect(calls('/api/quote/pick.json')).toHaveLength(0)
  })

  it('preselects the customer’s last pick over Our pick', async () => {
    answers.view = [{ body: { data: { ...OPEN, pickedTierId: 't3' } } }]
    render(<QuotePage token="tok_1" />)
    const buttons = await screen.findAllByRole('radio')
    expect(buttons[2]).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('deposit')).toHaveTextContent('$600')
  })

  it('picking another ticket calls pick.json once and moves the deposit', async () => {
    render(<QuotePage token="tok_1" />)
    const buttons = await screen.findAllByRole('radio')
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[0])
    await waitFor(() => expect(calls('/api/quote/pick.json')).toHaveLength(1))
    expect(calls('/api/quote/pick.json')[0]).toEqual({ t: 'tok_1', tierId: 't1' })
    expect(buttons[0]).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('deposit')).toHaveTextContent('$300')
    expect(formProps.at(-1).wallet).toMatchObject({ amount: '300.00' })
  })

  it('shows Updated <date> when the quote changed after it was sent', async () => {
    answers.view = [{ body: { data: { ...OPEN, updatedAt: '2026-11-18T16:00:00.000Z' } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText('Updated November 18')).toBeInTheDocument()
  })

  it('one tier: no picker, just the menu', async () => {
    answers.view = [{ body: { data: { ...OPEN, tiers: [OPEN.tiers[1]] } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByTestId('menu')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('an away event says where', async () => {
    answers.view = [{ body: { data: { ...OPEN, event: { ...OPEN.event, place: 'away', address: '12 Oak St, Madison' } } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText(/20 guests · at 12 Oak St, Madison/)).toBeInTheDocument()
  })
})

describe('QuotePage: paying', () => {
  it('pays the deposit with the tier, priceKey, an attempt id and the card token, then shows the receipt', async () => {
    answers.view = [
      { body: { data: OPEN } },
      { body: { data: { state: 'paid', date: OPEN.event.startIso, tierName: 'Our pick', paidCents: 45000, dueCents: 45000, payUrl: 'https://x/party/pay/p1?k=a', hostUrl: 'https://x/party/p1?key=b' } } },
    ]
    answers.pay = [{ body: { data: { partyId: 'pty_q1' } } }]
    render(<QuotePage token="tok_1" />)
    await clickHold()
    expect(await screen.findByRole('link', { name: 'Pay the rest' })).toHaveAttribute('href', 'https://x/party/pay/p1?k=a')
    const [body] = calls('/api/quote/pay.json')
    expect(body).toMatchObject({ t: 'tok_1', tierId: 't2', priceKey: 'pk_1', pay: { paymentToken: 'cnon:test-token', sourceKind: 'card' } })
    expect(body.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })

  it('a wallet token pays the same way', async () => {
    answers.pay = [{ body: { data: { partyId: 'pty_q1' } } }]
    render(<QuotePage token="tok_1" />)
    await screen.findByTestId('payment-form')
    formProps.at(-1).onWalletToken('wallet-token')
    await waitFor(() => expect(calls('/api/quote/pay.json')).toHaveLength(1))
    expect(calls('/api/quote/pay.json')[0].pay).toMatchObject({ paymentToken: 'wallet-token' })
  })

  it('declined (402): says so inline, keeps the tiers, and the retry is a new attempt', async () => {
    answers.pay = [
      { status: 402, body: { error: 'Your card was declined. Nothing was charged.', why: 'declined' } },
      { status: 402, body: { error: 'Your card was declined. Nothing was charged.', why: 'declined' } },
    ]
    render(<QuotePage token="tok_1" />)
    await clickHold()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined. Nothing was charged.')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    await clickHold()
    await waitFor(() => expect(calls('/api/quote/pay.json')).toHaveLength(2))
    const [a, b] = calls('/api/quote/pay.json')
    expect(a.attemptId).not.toBe(b.attemptId)
  })

  it('checking (202): one sentence, tiers kept, and a retry reuses the same attempt', async () => {
    answers.pay = [
      { status: 202, body: { error: 'We’re checking your payment. We’ll text you.', why: 'checking' } },
      { status: 202, body: { error: 'We’re checking your payment. We’ll text you.', why: 'checking' } },
    ]
    render(<QuotePage token="tok_1" />)
    await clickHold()
    expect(await screen.findByRole('alert')).toHaveTextContent(CHECKING_LINE)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    await clickHold()
    await waitFor(() => expect(calls('/api/quote/pay.json')).toHaveLength(2))
    const [a, b] = calls('/api/quote/pay.json')
    expect(a.attemptId).toBe(b.attemptId)
  })

  it('price changed (409): asks to reload, tiers kept', async () => {
    answers.pay = [{ status: 409, body: { error: 'This quote just changed. Reload to see it.', why: 'price_changed' } }]
    render(<QuotePage token="tok_1" />)
    await clickHold()
    expect(await screen.findByRole('alert')).toHaveTextContent('This quote just changed. Reload to see it.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('time taken (409): its sentence, tiers kept', async () => {
    const msg = 'That time was just taken, so nothing was charged. Text us at (256) 464-1710 and we’ll find another.'
    answers.pay = [{ status: 409, body: { error: msg, why: 'time_taken' } }]
    render(<QuotePage token="tok_1" />)
    await clickHold()
    expect(await screen.findByRole('alert')).toHaveTextContent(msg)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('closed (410) while paying: shows only the closed message', async () => {
    answers.pay = [{ status: 410, body: { error: CLOSED_LINE, why: 'closed' } }]
    render(<QuotePage token="tok_1" />)
    await clickHold()
    expect(await screen.findByText(CLOSED_LINE)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
  })
})

describe('QuotePage: other states', () => {
  it('paid: the receipt with Pay the rest, the date and the host page, no pay form', async () => {
    answers.view = [{ body: { data: { state: 'paid', date: OPEN.event.startIso, tierName: 'Everything', paidCents: 60000, dueCents: 60000, payUrl: 'https://x/pay', hostUrl: 'https://x/host' } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText('Everything')).toBeInTheDocument()
    expect(screen.getByTestId('paid')).toHaveTextContent('$600')
    expect(screen.getByTestId('due')).toHaveTextContent('$600')
    expect(screen.getByRole('link', { name: 'Pay the rest' })).toHaveAttribute('href', 'https://x/pay')
    expect(screen.getByRole('link', { name: 'Your event page' })).toHaveAttribute('href', 'https://x/host')
    expect(screen.getByText(/Saturday, December twelfth/)).toBeInTheDocument()
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })

  it('paid in full: no Pay the rest', async () => {
    answers.view = [{ body: { data: { state: 'paid', date: OPEN.event.startIso, tierName: 'Everything', paidCents: 120000, dueCents: 0, hostUrl: 'https://x/host' } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText('Everything')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pay the rest' })).toBeNull()
  })

  it('paying: the checking sentence', async () => {
    answers.view = [{ body: { data: { state: 'paying' } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText(CHECKING_LINE)).toBeInTheDocument()
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })

  it('closed: only its message, with tap-to-text', async () => {
    answers.view = [{ body: { data: { state: 'closed' } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText(CLOSED_LINE)).toBeInTheDocument()
    expect(CLOSED_LINE).toBe('This quote is no longer available. Text us at (256) 464-1710.')
    expect(screen.getByRole('link', { name: /Text us/ })).toHaveAttribute('href', 'sms:+12564641710')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })

  it('cancelled: only its message', async () => {
    answers.view = [{ body: { data: { state: 'cancelled' } } }]
    render(<QuotePage token="tok_1" />)
    expect(await screen.findByText(CANCELLED_LINE)).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })
})

describe('private page', () => {
  it('/quote/<token> is a private page (no analytics, key scrubbed)', () => {
    expect(isPrivatePartyPage('/quote/abc')).toBe(true)
    expect(isPrivatePartyPage('/quotes')).toBe(false)
  })
})
