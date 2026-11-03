// tests/components/admin/shell/SquareHow.test.tsx — "How" under a "change it in Square" line (final review M8).
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SquareHow } from '@components/admin/shell/SquareHow'
import { SQ_LEGACY_CLASS } from '@lib/admin-help'

describe('SquareHow', () => {
  it('shows the exact Square steps when tapped, and hides them again', () => {
    render(<SquareHow how={SQ_LEGACY_CLASS} />)
    expect(screen.queryByTestId('square-how')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'How' }))
    expect(screen.getByTestId('square-how')).toHaveTextContent(/^Square Dashboard .* › Appointments › Calendar/)
    fireEvent.click(screen.getByRole('button', { name: 'Hide the steps' }))
    expect(screen.queryByTestId('square-how')).toBeNull()
  })
})
