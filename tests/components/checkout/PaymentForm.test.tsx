import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import PaymentForm, { type PaymentFormRef } from '@components/checkout/PaymentForm'

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
    expect(await ref.current!.tokenize()).toBe('mock-payment-token')
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
