import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import CorkyDeposit, { BUTTON_LABEL, TITLE, SUBLINE, DONE_TITLE, DONE_LINE, UNCLEAR_LINE } from '@components/quote/CorkyDeposit'

// The real form loads Square's Web Payments SDK; stand in a ref that tokenizes and reports itself ready.
const formProps: any[] = []
const tokenizeAndVerify = vi.fn(async () => ({ token: 'cnon:test-token', verificationToken: 'verf-1', kind: 'card' as const }))
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle, useEffect } = await import('react')
  return {
    default: forwardRef((props: any, ref: any) => {
      formProps.push(props)
      useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'cnon:test-token', kind: 'card' }), tokenizeAndVerify }))
      useEffect(() => { props.onReadyChange?.(true) }, [])
      return <div data-testid="payment-form" />
    }),
  }
})

let answer: { status: number; body: unknown } | 'throw'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  formProps.length = 0
  tokenizeAndVerify.mockClear()
  answer = { status: 200, body: { data: { paid: true, receiptUrl: 'https://squareup.com/receipt/1' } } }
  fetchMock = vi.fn(async (url: string) => {
    if (url !== '/api/quote/corky-deposit.json') throw new Error(`unexpected ${url}`)
    if (answer === 'throw') throw new TypeError('Failed to fetch')
    const a = answer
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

async function openIt() {
  render(<CorkyDeposit />)
  fireEvent.click(screen.getByRole('button', { name: BUTTON_LABEL }))
  return screen.findByRole('dialog')
}

function fill() {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jessyca' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Test' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jessyca@example.com' } })
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '256-555-0100' } })
}

async function pay() {
  const button = await screen.findByRole('button', { name: 'Pay $1,500 deposit' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('CorkyDeposit', () => {
  it('opens a sheet with the title, the deposit line, the fields and the payment form', async () => {
    const dialog = await openIt()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(SUBLINE)).toBeInTheDocument()
    for (const label of ['First name', 'Last name', 'Email', 'Phone']) expect(screen.getByLabelText(label)).toBeInTheDocument()
    expect(screen.getByTestId('payment-form')).toBeInTheDocument()
    expect(formProps.at(-1)).toMatchObject({ wallet: { amount: '1500.00', label: 'Hometown Studio deposit' }, giftCards: 'none' })
    expect(formProps.at(-1).applicationIdOverride).toBeUndefined()
  })

  it('needs every field before it pays, and blocks the wallet until they are filled', async () => {
    await openIt()
    await pay()
    expect(await screen.findByText('Add your first name.')).toBeInTheDocument()
    expect(screen.getByText('Add your last name.')).toBeInTheDocument()
    expect(screen.getByText('Add an email we can send the receipt to.')).toBeInTheDocument()
    expect(screen.getByText('Add a 10-digit phone number.')).toBeInTheDocument()
    expect(tokenizeAndVerify).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(formProps.at(-1).canPayWithWallet()).toBe('Add your name, email and phone first.')
  })

  it('pays and shows the all-set screen with the receipt', async () => {
    await openIt()
    fill()
    await pay()
    expect(await screen.findByRole('heading', { name: DONE_TITLE })).toBeInTheDocument()
    expect(screen.getByText(DONE_LINE)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See your receipt' })).toHaveAttribute('href', 'https://squareup.com/receipt/1')
    expect(tokenizeAndVerify).toHaveBeenCalledWith(expect.objectContaining({ givenName: 'Jessyca', familyName: 'Test', email: 'jessyca@example.com', amount: '1500.00' }))
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent).toMatchObject({ paymentToken: 'cnon:test-token', verificationToken: 'verf-1', sourceKind: 'card', firstName: 'Jessyca', lastName: 'Test', email: 'jessyca@example.com', phone: '256-555-0100' })
    expect(sent.attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(sent).not.toHaveProperty('amount')
  })

  it('sends the night she picked on the page and this browser’s visitor id; nothing picked → null', async () => {
    const store = new Map([['hts-corky-visitor', 'aaaa1111-0000-0000-0000-000000000001']])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), clear: () => store.clear() })
    document.body.dataset.pick = 'Tote & Keychain Bar'
    const seen: string[] = []
    const listen = (e: Event) => seen.push((e as CustomEvent).detail.type)
    window.addEventListener('corky-visit', listen)
    try {
      await openIt()
      fill()
      await pay()
      await screen.findByRole('heading', { name: DONE_TITLE })
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ night: 'Tote & Keychain Bar', visitorId: 'aaaa1111-0000-0000-0000-000000000001' })
      expect(seen).toEqual(['sheet', 'pay', 'paid'])
    } finally {
      window.removeEventListener('corky-visit', listen)
      delete document.body.dataset.pick
      localStorage.clear()
    }
    cleanup()
    await openIt()
    fill()
    await pay()
    await screen.findByRole('heading', { name: DONE_TITLE })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ night: null, visitorId: null })
  })

  it('a wallet token pays straight away', async () => {
    await openIt()
    fill()
    await waitFor(() => expect(formProps.at(-1).canPayWithWallet()).toBeNull())
    await act(async () => { formProps.at(-1).onWalletToken('wallet-token') })
    expect(await screen.findByRole('heading', { name: DONE_TITLE })).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ paymentToken: 'wallet-token', sourceKind: 'wallet' })
  })

  it('declined: shows the server’s line, and a retry uses a new attempt', async () => {
    answer = { status: 402, body: { code: 'card_declined', detail: 'Your card was declined. Nothing was charged. Try another card.' } }
    await openIt()
    fill()
    await pay()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your card was declined. Nothing was charged. Try another card.')
    answer = { status: 200, body: { data: { paid: true } } }
    await pay()
    expect(await screen.findByRole('heading', { name: DONE_TITLE })).toBeInTheDocument()
    const [a, b] = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).attemptId)
    expect(a).not.toBe(b)
  })

  it('unclear (202 or no answer): says we are checking, never that nothing was charged', async () => {
    answer = { status: 202, body: { why: 'checking', code: 'unknown_outcome' } }
    await openIt()
    fill()
    await pay()
    expect(await screen.findByText(UNCLEAR_LINE)).toBeInTheDocument()
    expect(screen.queryByText(/nothing was charged/i)).toBeNull()
  })

  it('a dropped connection is unclear too', async () => {
    answer = 'throw'
    await openIt()
    fill()
    await pay()
    expect(await screen.findByText(UNCLEAR_LINE)).toBeInTheDocument()
  })

  it('Escape and the close button close it', async () => {
    const dialog = await openIt()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: BUTTON_LABEL }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
