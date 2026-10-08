import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import OrderSummary from '@components/checkout/OrderSummary'

afterEach(cleanup)

const seats = (quantity: number, pricePerUnit = 4500) => [{ name: 'Candle Making', quantity, pricePerUnit }]

describe('OrderSummary', () => {
  it('is headed "Order summary", in the brand’s dark colour', () => {
    render(<OrderSummary lineItems={seats(1)} total={4500} currency="USD" />)
    const heading = screen.getByRole('heading', { name: 'Order summary' })
    expect(heading.textContent).toBe('Order summary')
    expect(heading.style.color).toBe('var(--color-dark)')
    expect(heading.className).not.toMatch(/gray/)
  })

  it('shows whole dollars without ".00"', () => {
    const { container } = render(<OrderSummary lineItems={seats(2)} total={9000} currency="USD" />)
    expect(screen.getAllByText('$90')).toHaveLength(2) // the line and the total
    expect(container.textContent).not.toContain('.00')
  })

  it('keeps the cents when there are some', () => {
    render(<OrderSummary lineItems={seats(1, 3250)} total={3250} currency="USD" />)
    expect(screen.getAllByText('$32.50')).toHaveLength(2)
  })
})
