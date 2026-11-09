// tests/components/shop/MagnetOrderModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
vi.mock('@components/checkout/PaymentForm', async () => {
  const React = await import('react')
  const PaymentForm = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ tokenize: async () => ({ token: 'tok', kind: 'card' }) }))
    React.useEffect(() => { props.onReadyChange?.(true) }, [])
    return <div>card form</div>
  })
  return { default: PaymentForm }
})
// BookingPanel calls window.matchMedia; jsdom has none (same stub as PartyModal.test.tsx)
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }))
})
import MagnetOrderModal, { canContinueFromPhotos, slotsFor } from '@components/shop/MagnetOrderModal'

describe('MagnetOrderModal helpers', () => {
  it('makes 6 slots per set and keeps existing photos when sets grow', () => {
    const slots = slotsFor(1, [])
    expect(slots).toHaveLength(6)
    expect(slotsFor(2, slots.map((_, i) => ({ photoId: `p${i}`, preview: 'x', quality: 'good' as const })))).toHaveLength(12)
  })
  it('only continues when every slot has a saved photo', () => {
    expect(canContinueFromPhotos(slotsFor(1, []))).toBe(false)
    expect(canContinueFromPhotos(Array(6).fill({ photoId: 'p', preview: 'x', quality: 'good' }))).toBe(true)
    expect(canContinueFromPhotos([...Array(5).fill({ photoId: 'p', preview: 'x', quality: 'good' }), { photoId: null, preview: 'x', quality: 'good' }])).toBe(false)
  })
})

describe('MagnetOrderModal', () => {
  it('opens on the photos step with $18 for one set', () => {
    render(<MagnetOrderModal onClose={vi.fn()} />)
    expect(screen.getByText(/your photos/i)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /add photo/i })).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: /more magnets/i }))
    expect(screen.getAllByRole('button', { name: /add photo/i })).toHaveLength(12)
  })
})

describe('MagnetOrderModal checkout flow', () => {
  const full = Array.from({ length: 6 }, (_, i) => ({ photoId: `p${i}`, preview: 'x', quality: 'good' as const }))
  const btn = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement
  const orderCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).includes('magnet-order')).map((c) => JSON.parse(c[1].body))
  const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }))

  function toPayStep(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock)
    render(<MagnetOrderModal onClose={vi.fn()} initialSlots={full} />)
    fireEvent.click(btn(/continue/i))
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test Person' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kaden+m@ourhometownstudio.com' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '4029802907' } })
    fireEvent.click(btn(/continue/i))
  }
  const pay = () => fireEvent.click(screen.getByRole('button', { name: /^pay /i }))

  it('blocks Continue on the photos step until all 6 slots are saved', () => {
    const partial = [...full.slice(0, 5), { photoId: null, preview: 'x', quality: 'good' as const }]
    const { unmount } = render(<MagnetOrderModal onClose={vi.fn()} initialSlots={partial} />)
    expect(btn(/continue/i).disabled).toBe(true)
    unmount()
    render(<MagnetOrderModal onClose={vi.fn()} initialSlots={full} />)
    expect(btn(/continue/i).disabled).toBe(false)
  })

  it('needs valid contact details, and an address when shipping', () => {
    render(<MagnetOrderModal onClose={vi.fn()} initialSlots={full} />)
    fireEvent.click(btn(/continue/i))
    expect(btn(/continue/i).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Test Person' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '4029802907' } })
    expect(btn(/continue/i).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kaden+m@ourhometownstudio.com' } })
    expect(btn(/continue/i).disabled).toBe(false)
    fireEvent.click(screen.getByLabelText(/ship to me/i))
    expect(btn(/continue/i).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/shipping address/i), { target: { value: '1 Main Street, Madison AL' } })
    expect(btn(/continue/i).disabled).toBe(false)
  })

  it('shows the reference after a successful payment', async () => {
    toPayStep(vi.fn(() => json(200, { data: { reference: 'M-ABC234', emailSent: true } })))
    pay()
    await waitFor(() => expect(screen.getByText(/your magnets are ordered/i)).toBeTruthy())
    expect(screen.getByText(/M-ABC234/)).toBeTruthy()
  })

  it('keeps the attempt id after unknown_outcome, hides Back, and retries with the same id', async () => {
    const f = vi.fn(() => json(502, { code: 'unknown_outcome', detail: 'Check your email before trying again.' }))
    toPayStep(f)
    pay()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/check your email/i))
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull()
    pay()
    await waitFor(() => expect(orderCalls(f)).toHaveLength(2))
    const [a, b] = orderCalls(f)
    expect(a.attemptId).toBe(b.attemptId)
  })

  it('goes back to photos and empties the slot when a photo is missing', async () => {
    toPayStep(vi.fn(() => json(400, { code: 'missing_photos', detail: 'One photo needs to be added again.', missingPhotos: ['p2'] })))
    pay()
    await waitFor(() => expect(screen.getByText(/your photos/i)).toBeTruthy())
    expect(screen.getAllByRole('button', { name: /add photo/i })).toHaveLength(1)
    expect(btn(/continue/i).disabled).toBe(true)
  })

  it('uses a new attempt id after a failed charge', async () => {
    const f = vi.fn(() => json(402, { code: 'card_declined', detail: 'Your card was declined.' }))
    toPayStep(f)
    pay()
    await waitFor(() => expect(orderCalls(f)).toHaveLength(1))
    await waitFor(() => expect((screen.getByRole('button', { name: /^pay /i }) as HTMLButtonElement).disabled).toBe(false))
    pay()
    await waitFor(() => expect(orderCalls(f)).toHaveLength(2))
    const [a, b] = orderCalls(f)
    expect(a.attemptId).not.toBe(b.attemptId)
  })
})
