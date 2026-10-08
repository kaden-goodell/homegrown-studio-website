import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import KitModal from '@components/kits/KitModal'

// Stand-in for the real form: it tokenizes and reports itself ready.
vi.mock('@components/checkout/PaymentForm', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_props: unknown, ref: any) => {
      useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'cnon:test-token', kind: 'card' }) }))
      return <div data-testid="payment-form" />
    }),
  }
})

const info = {
  crafts: [{ id: 'c1', name: 'Keychains', perHeadCents: 2000 }],
  themes: [],
  assemblyFeeCents: 5000,
  minGuests: 10,
  maxGuests: 30,
  tierSizes: [10],
  leadTimeDays: 7,
  returnWindow: 'by noon',
}
const weeks = { dates: [{ partyDate: '2026-11-07', pickupDate: '2026-11-05', returnBy: '2026-11-09', themes: {} }] }

describe('KitModal payment', () => {
  it('tells the server which kind of payment source it got', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const u = String(url)
      const data = u.includes('service-info') ? info : u.includes('weeks') ? weeks : { pickupDate: '2026-11-05', returnBy: '2026-11-09', returnWindow: 'by noon', totalChargedCents: 5000 }
      return { ok: true, status: 200, json: async () => ({ data }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    render(<KitModal onClose={vi.fn()} initialCraftId="c1" />)
    fireEvent.click(await screen.findByText('No themed table — just crafts'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(await screen.findByRole('button', { name: /^7 / }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByTestId('payment-form')
    for (const [label, value] of [['First Name *', 'Ada'], ['Last Name *', 'Lovelace'], ['Email *', 'ada@example.com'], ['Phone *', '(256) 555-0123']] as const) {
      fireEvent.change(screen.getByText(label).parentElement!.querySelector('input')!, { target: { value } })
    }
    fireEvent.change(screen.getByPlaceholderText(/Where the party/), { target: { value: '12 Main Street, Madison' } })
    fireEvent.click(screen.getByRole('button', { name: /Pay \$50\.00 deposit/ }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/kits/order.json'))).toBe(true))
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/kits/order.json'))!
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ paymentToken: 'cnon:test-token', sourceKind: 'card' })
    vi.unstubAllGlobals()
  })
})
