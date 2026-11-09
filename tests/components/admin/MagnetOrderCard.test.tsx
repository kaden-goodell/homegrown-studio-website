// tests/components/admin/MagnetOrderCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MagnetOrderCard } from '@components/admin/MagnetOrderCard'
import type { MagnetOrder } from '@lib/magnet-status'

const o: MagnetOrder = { id: 'M-ABC234', createdAt: '2026-11-09T18:00:00.000Z', status: 'new', draftId: '0f8fad5b-d9cb-469f-a165-70867728950e', sets: 1,
  magnets: Array(6).fill('1700000000000-deadbeef'), delivery: 'pickup', address: null, contact: { name: 'Test Person', email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 1800, taxCents: 162, shippingCents: 0, totalCents: 1962 }, squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {} }

describe('MagnetOrderCard', () => {
  it('shows the order, a Print link and only the pickup statuses', () => {
    render(<MagnetOrderCard order={o} onMove={vi.fn()} />)
    expect(screen.getByText(/M-ABC234/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /print/i }).getAttribute('href')).toBe('/admin/magnets-print?id=M-ABC234')
    expect(screen.queryByRole('button', { name: 'Shipped' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ready for pickup' })).toBeTruthy()
  })
  it('moves status', () => {
    const onMove = vi.fn()
    render(<MagnetOrderCard order={o} onMove={onMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Made' }))
    expect(onMove).toHaveBeenCalledWith('M-ABC234', 'made')
  })
})
