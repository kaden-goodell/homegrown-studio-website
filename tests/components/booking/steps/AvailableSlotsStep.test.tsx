import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TimeSlot } from '@providers/interfaces/booking'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({ state: {}, dispatch: mockDispatch }),
}))

import AvailableSlotsStep from '@components/booking/steps/AvailableSlotsStep'

const mockSlots: TimeSlot[] = [
  {
    id: 's1',
    startAt: '2026-03-15T10:00:00',
    endAt: '2026-03-15T12:00:00',
    duration: 120,
    locationId: 'main',
    available: true,
  },
  {
    id: 's2',
    startAt: '2026-03-15T14:00:00',
    endAt: '2026-03-15T16:00:00',
    duration: 120,
    locationId: 'main',
    available: true,
  },
  {
    id: 's3',
    startAt: '2026-03-16T09:00:00',
    endAt: '2026-03-16T11:00:00',
    duration: 120,
    locationId: 'main',
    available: true,
  },
]

describe('AvailableSlotsStep', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
  })

  it('renders slot times grouped by date', () => {
    render(<AvailableSlotsStep slots={mockSlots} />)

    // Two date headings
    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings).toHaveLength(2)

    // Slot buttons
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)

    // Duration shown
    expect(screen.getAllByText('120 min')).toHaveLength(3)
  })

  it('clicking a slot dispatches SET_SLOT and GO_TO_STEP', () => {
    render(<AvailableSlotsStep slots={mockSlots} />)

    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_SLOT',
      payload: mockSlots[0],
    })
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'GO_TO_STEP',
      payload: 4,
    })
  })

  it('shows "No available slots" message when empty', () => {
    render(<AvailableSlotsStep slots={[]} />)

    expect(screen.getByText(/no available slots/i)).toBeInTheDocument()
  })
})
