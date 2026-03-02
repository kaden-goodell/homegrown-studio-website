import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CouponInput from '@components/checkout/CouponInput'

describe('CouponInput', () => {
  const mockOnApply = vi.fn()

  beforeEach(() => {
    mockOnApply.mockClear()
    vi.restoreAllMocks()
  })

  it('renders input and Apply button', () => {
    render(<CouponInput onApply={mockOnApply} />)

    expect(screen.getByPlaceholderText('Coupon code')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })

  it('calls onApply with discount on valid code', async () => {
    const discount = { name: '10% Off', type: 'percent' as const, value: 10, scope: 'order' as const }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { valid: true, description: '10% off your order', discount },
      }),
    } as Response)

    render(<CouponInput onApply={mockOnApply} />)

    fireEvent.change(screen.getByPlaceholderText('Coupon code'), {
      target: { value: 'SAVE10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(screen.getByText('10% off your order')).toBeInTheDocument()
    })

    expect(mockOnApply).toHaveBeenCalledWith('SAVE10', discount)
  })

  it('shows error message on invalid code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { valid: false, error: 'Coupon not found' },
      }),
    } as Response)

    render(<CouponInput onApply={mockOnApply} />)

    fireEvent.change(screen.getByPlaceholderText('Coupon code'), {
      target: { value: 'BADCODE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => {
      expect(screen.getByText('Coupon not found')).toBeInTheDocument()
    })

    expect(mockOnApply).not.toHaveBeenCalled()
  })
})
