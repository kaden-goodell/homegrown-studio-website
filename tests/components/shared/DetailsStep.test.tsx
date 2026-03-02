import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DetailsStep from '@components/shared/DetailsStep'

describe('DetailsStep', () => {
  const defaultProps = {
    title: 'Hand-Built Pottery',
    description: 'Learn the art of hand-building with clay.\n\nYou will create two pieces.',
    tags: [
      { label: '2 hours' },
      { label: '$65.00' },
      { label: '8 seats left' },
    ],
    onContinue: vi.fn(),
  }

  it('renders title and description', () => {
    render(<DetailsStep {...defaultProps} />)
    expect(screen.getByText('Hand-Built Pottery')).toBeDefined()
    expect(screen.getByText(/Learn the art/)).toBeDefined()
  })

  it('renders all tags', () => {
    render(<DetailsStep {...defaultProps} />)
    expect(screen.getByText('2 hours')).toBeDefined()
    expect(screen.getByText('$65.00')).toBeDefined()
    expect(screen.getByText('8 seats left')).toBeDefined()
  })

  it('renders image when imageUrl is provided', () => {
    render(<DetailsStep {...defaultProps} imageUrl="https://example.com/img.jpg" />)
    const img = screen.getByRole('img')
    expect(img.getAttribute('src')).toBe('https://example.com/img.jpg')
  })

  it('does not render image when imageUrl is not provided', () => {
    render(<DetailsStep {...defaultProps} />)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('calls onContinue when button is clicked', () => {
    render(<DetailsStep {...defaultProps} />)
    fireEvent.click(screen.getByText('Continue'))
    expect(defaultProps.onContinue).toHaveBeenCalledOnce()
  })

  it('renders custom button text', () => {
    render(<DetailsStep {...defaultProps} buttonText="Select This Party" />)
    expect(screen.getByText('Select This Party')).toBeDefined()
  })

  it('splits description on newlines into paragraphs', () => {
    const { container } = render(<DetailsStep {...defaultProps} />)
    const paragraphs = container.querySelectorAll('[data-testid="description"] p')
    expect(paragraphs.length).toBe(2)
  })
})
