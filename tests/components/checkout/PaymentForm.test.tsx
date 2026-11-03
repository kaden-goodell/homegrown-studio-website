import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'
import { TEXT_US } from '@lib/checkout-messages'

/**
 * The payment step is already titled "Payment" by the panel around it, so the
 * form carries no heading of its own. These run the stand-in form used in
 * local development: nothing here loads Square or sends a payment.
 */

function configAnswers(appId: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { appId, locationId: 'loc-1', environment: 'sandbox' } }),
    }),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // A failed assertion must not leave the SDK stub (or its script tag) for the next test.
  delete (window as any).Square
  document.head.querySelectorAll('script[src*="squarecdn.com"]').forEach((s) => s.remove())
})

describe('PaymentForm headings', () => {
  it('has no "Payment" heading while it loads', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    render(<PaymentForm />)
    expect(screen.getByText('Loading payment form...')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('has no "Payment" heading in the stand-in form', async () => {
    configAnswers('mock-app')
    render(<PaymentForm />)
    await screen.findByText(/Card number placeholder/)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText('Payment')).toBeNull()
  })

  it('keeps the test-mode badge, inside the stand-in card field it describes', async () => {
    configAnswers('mock-app')
    render(<PaymentForm />)
    const badge = await screen.findByText('Test mode')
    const field = screen.getByText(/Card number placeholder/).closest('div')!
    expect(field.contains(badge)).toBe(true)
  })

  it('still names the form for screen readers', async () => {
    configAnswers('mock-app')
    render(<PaymentForm />)
    await screen.findByText('Test mode')
    expect(screen.getByRole('group', { name: 'Payment' })).toBeInTheDocument()
  })

  it('reports ready exactly as before', async () => {
    configAnswers('mock-app')
    const onReadyChange = vi.fn()
    render(<PaymentForm onReadyChange={onReadyChange} />)
    await screen.findByText('Test mode')
    expect(onReadyChange).toHaveBeenLastCalledWith(true)
  })
})

describe('PaymentForm with a caller-supplied app id', () => {
  const squareScripts = () => document.head.querySelectorAll('script[src*="squarecdn"]').length

  it('uses the stand-in card when the site config is a mock, whatever the override says', async () => {
    configAnswers('mock-app-id')
    const ref = createRef<PaymentFormRef>()
    const before = squareScripts()
    render(<PaymentForm ref={ref} applicationIdOverride="sq0idp-real" environmentOverride="production" />)
    await screen.findByText(/Card number placeholder/)
    expect(squareScripts()).toBe(before)
    expect(await ref.current!.tokenize()).toEqual({ token: 'mock-payment-token', kind: 'card' })
    // Like a real card form, the next call is a new token (a class sends one per seat).
    expect(await ref.current!.tokenize()).toEqual({ token: 'mock-payment-token-2', kind: 'card' })
  })

  it('does not load the Square SDK while the config is still loading', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const before = squareScripts()
    render(<PaymentForm applicationIdOverride="sq0idp-real" />)
    expect(screen.getByText('Loading payment form...')).toBeInTheDocument()
    expect(squareScripts()).toBe(before)
  })

  it('keeps the real path when the site config is real', async () => {
    configAnswers('sq0idp-site')
    const ref = createRef<PaymentFormRef>()
    render(<PaymentForm ref={ref} applicationIdOverride="sq0idp-real" environmentOverride="production" />)
    await waitFor(() => expect(squareScripts()).toBeGreaterThan(0))
    expect(screen.queryByText(/Card number placeholder/)).toBeNull()
    await expect(ref.current!.tokenize()).rejects.toThrow('Payment card not initialized')
  })
})

describe('PaymentForm gift cards', () => {
  it('offers a gift card toggle by default', async () => {
    configAnswers('mock-app')
    render(<PaymentForm />)
    expect(await screen.findByRole('button', { name: 'Pay with a gift card instead' })).toBeInTheDocument()
    expect(screen.queryByText(/Gift cards can’t be used/)).toBeNull()
  })

  it('says cards only, with no toggle, when gift cards are not accepted', async () => {
    configAnswers('mock-app')
    render(<PaymentForm giftCards="cards-only" />)
    await screen.findByText('Test mode')
    expect(screen.queryByRole('button', { name: /gift card/i })).toBeNull()
    expect(screen.getByText(`Gift cards can’t be used for class seats — ${TEXT_US} and we’ll add you.`)).toBeInTheDocument()
  })

  it('tokenizes a typed gift card number as a gift card', async () => {
    configAnswers('mock-app')
    const ref = createRef<PaymentFormRef>()
    render(<PaymentForm ref={ref} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with a gift card instead' }))
    fireEvent.change(screen.getByLabelText('Gift card number (test)'), { target: { value: '7783000011112222' } })
    expect(await ref.current!.tokenize()).toEqual({ token: 'mock-gift:7783000011112222', kind: 'gift_card' })
    fireEvent.click(screen.getByRole('button', { name: 'Pay with a card instead' }))
    expect(await ref.current!.tokenize()).toEqual({ token: 'mock-payment-token', kind: 'card' })
  })

  it('turns cents:1500 into a short mock gift card', async () => {
    configAnswers('mock-app')
    const ref = createRef<PaymentFormRef>()
    render(<PaymentForm ref={ref} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with a gift card instead' }))
    fireEvent.change(screen.getByLabelText('Gift card number (test)'), { target: { value: 'cents:1500' } })
    expect(await ref.current!.tokenize()).toEqual({ token: 'mock-gift-cents:1500', kind: 'gift_card' })
  })
})

describe('PaymentForm gift card field with the real SDK', () => {
  it('attaches on toggle, destroys on toggle-off, and is not ready until attached', async () => {
    // Pretend Square's script is already on the page so nothing is downloaded.
    const script = document.createElement('script')
    script.src = 'https://sandbox.web.squarecdn.com/v1/square.js'
    document.head.appendChild(script)

    let finishAttach!: () => void
    const cardStub = { attach: vi.fn(async () => {}), destroy: vi.fn(async () => {}), tokenize: vi.fn() }
    const giftStub = {
      attach: vi.fn(() => new Promise<void>((resolve) => { finishAttach = resolve })),
      destroy: vi.fn(async () => {}),
      tokenize: vi.fn(),
    }
    ;(window as any).Square = { payments: () => ({ card: async () => cardStub, giftCard: async () => giftStub }) }

    configAnswers('sq0idp-real')
    const onReadyChange = vi.fn()
    render(<PaymentForm onReadyChange={onReadyChange} environmentOverride="sandbox" />)
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true))

    fireEvent.click(screen.getByRole('button', { name: 'Pay with a gift card instead' }))
    await waitFor(() => expect(giftStub.attach).toHaveBeenCalled())
    // Still attaching: the form must not say it is ready.
    expect(onReadyChange).toHaveBeenLastCalledWith(false)
    finishAttach()
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true))

    fireEvent.click(screen.getByRole('button', { name: 'Pay with a card instead' }))
    await waitFor(() => expect(giftStub.destroy).toHaveBeenCalled())
  })
})

describe('PaymentForm store mode (stage 4: save a card for the waitlist)', () => {
  function realSdk() {
    const script = document.createElement('script')
    script.src = 'https://sandbox.web.squarecdn.com/v1/square.js'
    document.head.appendChild(script)
    const cardStub = { attach: vi.fn(async () => {}), destroy: vi.fn(async () => {}), tokenize: vi.fn(async () => ({ status: 'OK', token: 'cnon:card-nonce-ok' })) }
    const verifyBuyer = vi.fn(async () => ({ token: 'verf:store-1' }))
    const applePay = vi.fn(async () => ({ destroy: vi.fn() }))
    const googlePay = vi.fn(async () => ({ attach: vi.fn(), destroy: vi.fn() }))
    const giftCard = vi.fn()
    ;(window as any).Square = { payments: () => ({ card: async () => cardStub, giftCard, applePay, googlePay, paymentRequest: vi.fn(() => ({})), verifyBuyer }) }
    return { cardStub, verifyBuyer, applePay, googlePay, giftCard }
  }

  it('card only: no wallets even when an amount is given, no gift card toggle, and says Square saves it', async () => {
    const sdk = realSdk()
    configAnswers('sq0idp-real')
    const onReadyChange = vi.fn()
    render(<PaymentForm mode="store" wallet={{ amount: '21.80', label: 'Hometown Studio' }} onWalletToken={vi.fn()} onReadyChange={onReadyChange} environmentOverride="sandbox" />)
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true))
    expect(sdk.applePay).not.toHaveBeenCalled()
    expect(sdk.googlePay).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /gift card/ })).toBeNull()
    expect(screen.queryByText(/Gift cards can’t be used/)).toBeNull()
    expect(screen.getByText('Nothing is charged now. Square saves your card. We never see its number.')).toBeInTheDocument()
  })

  it('verifies the buyer with intent STORE (no amount) and returns the token and the verification token', async () => {
    const sdk = realSdk()
    configAnswers('sq0idp-real')
    const ref = createRef<PaymentFormRef>()
    const onReadyChange = vi.fn()
    render(<PaymentForm ref={ref} mode="store" onReadyChange={onReadyChange} environmentOverride="sandbox" />)
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true))
    const out = await ref.current!.tokenizeAndVerify({ givenName: 'Jane', familyName: 'Doe', email: 'jane@example.com', phone: '4029802907', amount: '21.80' })
    expect(out).toEqual({ token: 'cnon:card-nonce-ok', verificationToken: 'verf:store-1', kind: 'card' })
    expect(sdk.verifyBuyer).toHaveBeenCalledWith('cnon:card-nonce-ok', {
      intent: 'STORE',
      billingContact: { givenName: 'Jane', familyName: 'Doe', email: 'jane@example.com', phone: '4029802907' },
    })
    const details = (sdk.verifyBuyer.mock.calls[0] as any[])[1]
    expect(details).not.toHaveProperty('amount')
  })

  it('charge mode still verifies with CHARGE and the amount', async () => {
    const sdk = realSdk()
    configAnswers('sq0idp-real')
    const ref = createRef<PaymentFormRef>()
    const onReadyChange = vi.fn()
    render(<PaymentForm ref={ref} onReadyChange={onReadyChange} environmentOverride="sandbox" />)
    await waitFor(() => expect(onReadyChange).toHaveBeenLastCalledWith(true))
    await ref.current!.tokenizeAndVerify({ givenName: 'Jane', amount: '21.80' })
    expect((sdk.verifyBuyer.mock.calls[0] as any[])[1]).toMatchObject({ intent: 'CHARGE', amount: '21.80' })
  })

  it('the stand-in form in store mode: no gift card toggle, the Square line instead', async () => {
    configAnswers('mock-app')
    render(<PaymentForm mode="store" />)
    await screen.findByText('Test mode')
    expect(screen.queryByRole('button', { name: /gift card/ })).toBeNull()
    expect(screen.getByText('Nothing is charged now. Square saves your card. We never see its number.')).toBeInTheDocument()
    // M8: a screen reader hears "Card to save", not "Payment".
    expect(screen.getByRole('group', { name: 'Card to save' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Payment' })).toBeNull()
  })
})

describe('PaymentForm wallets show the current total (final review I1, I19)', () => {
  function walletSdk(tokenizeResult: { status: string; token?: string; errors?: { message: string }[] }) {
    const script = document.createElement('script')
    script.src = 'https://sandbox.web.squarecdn.com/v1/square.js'
    document.head.appendChild(script)
    // The Apple Pay JS SDK tag counts as already loaded, so nothing is downloaded.
    const apple = document.createElement('script')
    apple.src = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js'
    document.head.appendChild(apple)
    const update = vi.fn(() => true)
    const request = { update }
    const cardStub = { attach: vi.fn(async () => {}), destroy: vi.fn(async () => {}), tokenize: vi.fn() }
    const applePayStub = { tokenize: vi.fn(async () => tokenizeResult), destroy: vi.fn(async () => {}) }
    const paymentRequest = vi.fn(() => request)
    ;(window as any).Square = {
      payments: () => ({ card: async () => cardStub, applePay: vi.fn(async () => applePayStub), googlePay: vi.fn(async () => { throw new Error('no') }), paymentRequest }),
    }
    return { update, paymentRequest, applePayStub }
  }

  it('updates the Apple Pay / Google Pay request when the amount changes (a code applied)', async () => {
    const sdk = walletSdk({ status: 'OK', token: 'wallet-1' })
    configAnswers('sq0idp-real')
    const onReady = vi.fn()
    const view = render(<PaymentForm wallet={{ amount: '98.10', label: 'Hometown Studio' }} onWalletToken={vi.fn()} onReadyChange={onReady} environmentOverride="sandbox" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pay with Apple Pay' })).toBeInTheDocument())
    expect(sdk.paymentRequest).toHaveBeenCalledWith(expect.objectContaining({ total: { amount: '98.10', label: 'Hometown Studio' } }))
    view.rerender(<PaymentForm wallet={{ amount: '78.48', label: 'Hometown Studio' }} onWalletToken={vi.fn()} onReadyChange={onReady} environmentOverride="sandbox" />)
    await waitFor(() => expect(sdk.update).toHaveBeenLastCalledWith({ total: { amount: '78.48', label: 'Hometown Studio' } }))
  })

  it('a failed wallet sheet says a plain sentence in an alert, never Square’s error text', async () => {
    walletSdk({ status: 'Invalid', errors: [{ message: 'PaymentRequest total amount must be valid string' }] })
    configAnswers('sq0idp-real')
    render(<PaymentForm wallet={{ amount: '98.10', label: 'Hometown Studio' }} onWalletToken={vi.fn()} environmentOverride="sandbox" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with Apple Pay' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Apple Pay didn’t go through. Nothing was charged. Try again, or pay with a card.')
    expect(alert).not.toHaveTextContent(/PaymentRequest/)
  })
})
