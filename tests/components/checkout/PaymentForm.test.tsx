import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PaymentForm from '@components/checkout/PaymentForm'

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
