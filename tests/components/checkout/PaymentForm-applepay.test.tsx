import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'

/**
 * Kaden, 16 Nov 2026: tapping Apple Pay on /book did nothing (iPhone Safari and
 * Brave; the Oct 20 customer tapped it 28 times). The tap must reach Square's
 * tokenize exactly once, through a listener on Apple's own button element.
 */
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as any).Square
  delete (window as any).ApplePaySession
  document.head.querySelectorAll('script').forEach((s) => s.remove())
})

describe('Apple Pay on a real-Apple-Pay browser', () => {
  it('a tap on the Apple Pay button asks Square to open the sheet, once, and hands the token on', async () => {
    ;(window as any).ApplePaySession = { canMakePayments: () => true }
    vi.resetModules()
    const { default: PaymentForm } = await import('@components/checkout/PaymentForm')
    for (const src of ['https://sandbox.web.squarecdn.com/v1/square.js', 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js']) {
      const s = document.createElement('script'); s.src = src; document.head.appendChild(s)
    }
    const tokenize = vi.fn(async () => ({ status: 'OK', token: 'apple-tok' }))
    const card = { attach: vi.fn(async () => {}), destroy: vi.fn(async () => {}), tokenize: vi.fn() }
    ;(window as any).Square = {
      payments: () => ({
        card: async () => card,
        paymentRequest: () => ({}),
        applePay: async () => ({ tokenize, destroy: vi.fn(async () => {}) }),
        googlePay: async () => { throw new Error('no') },
        afterpayClearpay: async () => { throw new Error('no') },
      }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { appId: 'sq0idp-real', locationId: 'loc', environment: 'sandbox' } }) }))
    const onWalletToken = vi.fn()
    render(<PaymentForm environmentOverride="sandbox" bookingKind="party" wallet={{ amount: '300.00', label: 'Hometown Studio' }} onWalletToken={onWalletToken} canPayWithWallet={() => null} />)
    const button = await waitFor(() => { const b = document.querySelector('apple-pay-button'); if (!b) throw new Error('no button'); return b })
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await waitFor(() => expect(onWalletToken).toHaveBeenCalledWith('apple-tok'))
    expect(tokenize).toHaveBeenCalledTimes(1)
  })
})

describe('Apple Pay hiccup', () => {
  it('Square\'s catch-all UnexpectedError asks them to tap Apple Pay again, not to switch to a card (17 Nov 2026)', async () => {
    ;(window as any).ApplePaySession = { canMakePayments: () => true }
    vi.resetModules()
    const { default: PaymentForm } = await import('@components/checkout/PaymentForm')
    for (const src of ['https://sandbox.web.squarecdn.com/v1/square.js', 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js']) {
      const s = document.createElement('script'); s.src = src; document.head.appendChild(s)
    }
    const err = Object.assign(new Error('An unexpected error occurred while using Apple Pay.'), { name: 'UnexpectedError' })
    const tokenize = vi.fn(async () => { throw err })
    const card = { attach: vi.fn(async () => {}), destroy: vi.fn(async () => {}), tokenize: vi.fn() }
    ;(window as any).Square = { payments: () => ({ card: async () => card, paymentRequest: () => ({}), applePay: async () => ({ tokenize, destroy: vi.fn(async () => {}) }), googlePay: async () => { throw new Error('no') }, afterpayClearpay: async () => { throw new Error('no') } }) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { appId: 'sq0idp-real', locationId: 'loc', environment: 'sandbox' } }) }))
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: vi.fn() })
    render(<PaymentForm environmentOverride="sandbox" bookingKind="party" wallet={{ amount: '2.00', label: 'Hometown Studio' }} onWalletToken={vi.fn()} />)
    const button = await waitFor(() => { const b = document.querySelector('apple-pay-button'); if (!b) throw new Error('no button'); return b })
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }))
    await waitFor(() => expect(document.body.textContent).toContain('Apple Pay hiccuped. Tap it again. Nothing was charged.'))
  })
})
