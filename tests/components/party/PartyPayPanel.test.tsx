import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PartyPayPanel, { CRAFTS_LINE, LINK_BROKEN, PAY_HEADING, CANCELLED_LINE, BUSY_LINE, AMOUNT_CHANGED } from '@components/party/PartyPayPanel'
import { UNKNOWN_OUTCOME_MESSAGE } from '@lib/checkout-messages'

// The real form loads Square's Web Payments SDK; stand in a ref that tokenizes and reports itself ready.
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

const BALANCE = {
  when: 'Sat, Nov 8 at 1:30 PM', hostFirstName: 'Alice', packageName: 'Whole Studio Party',
  items: [{ id: 'itm_1', label: 'Whole Studio Party', qty: 1, cents: 30000 }, { id: 'itm_2', label: 'Extra half hour', qty: 1, cents: 2500 }],
  dueCents: 32500, state: 'waiting', receiptUrl: null,
}

type Answer = { status?: number; body: unknown } | (() => never)
let answers: { balance: Answer; pay: Answer[] }
let fetchMock: ReturnType<typeof vi.fn>
const respond = (a: Answer) => {
  if (typeof a === 'function') return a()
  const status = a.status ?? 200
  return { ok: status >= 200 && status < 300, status, json: async () => a.body }
}

beforeEach(() => {
  formProps.length = 0
  answers = { balance: { body: { data: BALANCE } }, pay: [] }
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/party/balance.json')) return respond(answers.balance)
    if (url === '/api/party/pay.json') return respond(answers.pay.shift() ?? { status: 500, body: null })
    throw new Error(`unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** The Pay button turns on once the card field says it is ready. */
async function clickPay() {
  const button = await screen.findByRole('button', { name: 'Pay $325' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

const payCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/party/pay.json').map(([, init]) => JSON.parse(init.body))

describe('PartyPayPanel', () => {
  it('shows the unpaid items, the total, the crafts line and a Pay button; wallets and gift cards on', async () => {
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    expect(screen.getByRole('heading', { name: PAY_HEADING })).toBeInTheDocument()
    expect(await screen.findByText('Extra half hour')).toBeInTheDocument()
    expect(screen.getByText(/Sat, Nov 8 at 1:30 PM/)).toBeInTheDocument()
    expect(screen.getByText(CRAFTS_LINE)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay $325' })).toBeEnabled())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/party/balance.json?id=pty_1&k=key-1')
    const props = formProps.at(-1)
    expect(props.wallet).toMatchObject({ amount: '325.00' })
    expect(props.giftCards ?? 'allowed').toBe('allowed')
  })

  it('pays with the link key and an attempt id, then shows the paid screen with the receipt', async () => {
    answers.pay = [{ body: { data: { state: 'paid', paidCents: 32500, receiptUrl: 'https://r/1', stillDueCents: 0 } } }]
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    await clickPay()
    expect(await screen.findByText('Thank you! You paid $325.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See your receipt' })).toHaveAttribute('href', 'https://r/1')
    const [call] = payCalls()
    expect(call).toMatchObject({ id: 'pty_1', k: 'key-1', expectedCents: 32500, paymentToken: 'cnon:test-token', sourceKind: 'card' })
    expect(call.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(call).not.toHaveProperty('amount')
  })

  it('keeps the attempt id when the outcome is unknown, and starts a new one after a decline', async () => {
    answers.pay = [
      { status: 502, body: { code: 'unknown_outcome', detail: UNKNOWN_OUTCOME_MESSAGE } },
      { status: 402, body: { code: 'card_declined', detail: 'Your card was declined. Nothing was charged. Try another card.' } },
      { body: { data: { state: 'paid', paidCents: 32500, receiptUrl: null, stillDueCents: 0 } } },
    ]
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    const payNow = async (calls: number) => {
      await clickPay()
      await waitFor(() => expect(payCalls()).toHaveLength(calls))
    }
    await payNow(1)
    expect(await screen.findByText(UNKNOWN_OUTCOME_MESSAGE)).toBeInTheDocument()
    await payNow(2)
    expect(await screen.findByText(/declined/)).toBeInTheDocument()
    await payNow(3)
    await screen.findByText('Thank you! You paid $325.')
    const [a, b, c] = payCalls().map((x) => x.attemptId)
    expect(b).toBe(a)
    expect(c).not.toBe(b)
  })

  it('the amount changed: reloads what is due, says so, and the next try is a new attempt for the new amount', async () => {
    answers.pay = [
      { status: 409, body: { code: 'amount_changed', detail: AMOUNT_CHANGED } },
      { body: { data: { state: 'paid', paidCents: 35000, receiptUrl: null, stillDueCents: 0 } } },
    ]
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    await screen.findByRole('button', { name: 'Pay $325' })
    answers.balance = { body: { data: { ...BALANCE, items: [...BALANCE.items, { id: 'itm_3', label: 'Balloons', qty: 1, cents: 2500 }], dueCents: 35000 } } }
    await clickPay()
    expect(await screen.findByText(AMOUNT_CHANGED)).toBeInTheDocument()
    expect(await screen.findByText('Balloons')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Pay $350' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await screen.findByText('Thank you! You paid $350.')
    const [a, b] = payCalls()
    expect(b.expectedCents).toBe(35000)
    expect(b.attemptId).not.toBe(a.attemptId)
  })

  it('a payment already going through: says so on load, no form', async () => {
    answers.balance = { body: { data: { ...BALANCE, paying: true } } }
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    expect(await screen.findByText(BUSY_LINE)).toBeInTheDocument()
    expect(screen.queryByTestId('payment-form')).toBeNull()
    answers.balance = { body: { data: BALANCE } }
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('payment-form')).toBeInTheDocument()
  })

  it('only extras due: says the party is paid and these extras were added since', async () => {
    answers.balance = { body: { data: { ...BALANCE, items: [BALANCE.items[1]], dueCents: 2500, state: 'partly', extrasOnly: true } } }
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    expect(await screen.findByText(/is paid\. These extras were added since\./)).toBeInTheDocument()
  })

  it('after a refresh (the key left the address bar) it uses the key kept in this tab', async () => {
    window.history.replaceState(null, '', '/party/pay/pty_1')
    sessionStorage.setItem('hs-page-key:/party/pay/pty_1', 'kept-key')
    render(<PartyPayPanel partyId="pty_1" payKey="" />)
    await screen.findByText('Extra half hour')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/party/balance.json?id=pty_1&k=kept-key')
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('a link that does not work says so (no form)', async () => {
    answers.balance = { status: 404, body: { error: 'x' } }
    render(<PartyPayPanel partyId="pty_1" payKey="bad" />)
    expect(await screen.findByText(LINK_BROKEN)).toBeInTheDocument()
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })

  it('an already paid party shows the paid screen', async () => {
    answers.balance = { body: { data: { ...BALANCE, items: [], dueCents: 0, state: 'paid', receiptUrl: 'https://r/9' } } }
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    expect(await screen.findByText('Your party is paid.')).toBeInTheDocument()
    expect(screen.queryByTestId('payment-form')).toBeNull()
  })

  it('a party cancelled while paying shows that nothing is due', async () => {
    answers.pay = [{ status: 410, body: { code: 'cancelled', detail: 'This party was cancelled. Nothing was charged.' } }]
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    await clickPay()
    await waitFor(() => expect(screen.getByText(CANCELLED_LINE)).toBeInTheDocument())
  })

  it('extras added since are named on the paid screen', async () => {
    answers.pay = [{ body: { data: { state: 'paid', paidCents: 30000, receiptUrl: null, stillDueCents: 2500 } } }]
    render(<PartyPayPanel partyId="pty_1" payKey="key-1" />)
    await clickPay()
    expect(await screen.findByText(/still \$25 to pay/)).toBeInTheDocument()
  })
})
