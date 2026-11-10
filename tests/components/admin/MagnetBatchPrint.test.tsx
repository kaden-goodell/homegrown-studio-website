import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MagnetBatchPrint } from '@components/admin/MagnetBatchPrint'
import type { MagnetOrder } from '@lib/magnet-status'

const order = (id: string, n: number, status: MagnetOrder['status'] = 'new'): MagnetOrder => ({
  id, createdAt: '2026-11-09T18:00:00.000Z', status, draftId: '0f8fad5b-d9cb-469f-a165-70867728950e', sets: n / 6,
  magnets: Array(n).fill('1700000000000-deadbeef'), delivery: 'pickup', address: null,
  contact: { name: `Name ${id.slice(-1)}`, email: 'kaden+m@ourhometownstudio.com', phone: '4029802907' },
  amounts: { subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 }, squareOrderId: 's', paymentId: 'p', receiptUrl: null, doneAt: null, photosDeletedAt: null, emailed: {},
})

describe('MagnetBatchPrint', () => {
  it('stays out of the way with fewer than two new orders', () => {
    const { container } = render(<MagnetBatchPrint orders={[order('M-AAAAAA', 6), order('M-BBBBBB', 6, 'made')]} onMarkMade={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
  it('ticks every new order and links them as one batch', () => {
    render(<MagnetBatchPrint orders={[order('M-AAAAAA', 6), order('M-BBBBBB', 6), order('M-CCCCCC', 6, 'made')]} onMarkMade={vi.fn()} />)
    const link = screen.getByRole('link', { name: /print 12 magnets \(1 page\)/i })
    expect(link.getAttribute('href')).toBe('/admin/magnets-print?ids=M-AAAAAA,M-BBBBBB')
  })
  it('leaves out an unticked order and marks only the chosen ones as Made', () => {
    const onMarkMade = vi.fn()
    render(<MagnetBatchPrint orders={[order('M-AAAAAA', 6), order('M-BBBBBB', 18)]} onMarkMade={onMarkMade} />)
    expect(screen.getByRole('link', { name: /24 magnets \(2 pages\)/i })).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/M-AAAAAA/))
    expect(screen.getByRole('link', { name: /18 magnets \(2 pages\)/i }).getAttribute('href')).toBe('/admin/magnets-print?ids=M-BBBBBB')
    fireEvent.click(screen.getByRole('button', { name: /mark these as made/i }))
    expect(onMarkMade).toHaveBeenCalledWith(['M-BBBBBB'])
  })
})

describe('MagnetBatchPrint leaves silhouettes out', () => {
  it('only batches magnet orders', () => {
    const sil = { ...order('M-SSSSSS', 6), product: 'silhouettes' as const, magnets: ['1700000000000-deadbeef'] }
    const { container } = render(<MagnetBatchPrint orders={[order('M-AAAAAA', 6), sil]} onMarkMade={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})
