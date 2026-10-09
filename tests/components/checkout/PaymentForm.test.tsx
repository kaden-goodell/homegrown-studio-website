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
