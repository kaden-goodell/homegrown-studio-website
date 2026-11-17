// tests/components/shop/MagnetCropper.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MagnetCropper from '@components/shop/MagnetCropper'

describe('MagnetCropper', () => {
  it('shows the safe-area line, the close-up hint and a zoom slider', () => {
    render(<MagnetCropper src="blob:x" size={{ w: 4000, h: 3000 }} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByTestId('safe-area')).toBeTruthy()
    expect(screen.getByText(/dashed line/i)).toBeTruthy()
    expect(screen.getByRole('slider', { name: /zoom/i })).toBeTruthy()
  })
  it('warns when the crop is too small to print sharp', () => {
    render(<MagnetCropper src="blob:x" size={{ w: 500, h: 500 }} onDone={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByRole('slider', { name: /zoom/i }), { target: { value: '2' } })
    expect(screen.getByText(/blurry/i)).toBeTruthy()
  })
  it('cancels', () => {
    const onCancel = vi.fn()
    render(<MagnetCropper src="blob:x" size={{ w: 4000, h: 3000 }} onDone={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalled()
  })
})
