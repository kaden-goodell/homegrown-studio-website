import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDispatch = vi.fn()

vi.mock('@components/booking/WizardContext', () => ({
  useWizard: () => ({
    state: { eventType: { flow: 'booking', duration: 120 } },
    dispatch: mockDispatch,
  }),
}))

import DateSelectionStep from '@components/booking/steps/DateSelectionStep'

describe('DateSelectionStep', () => {
  const mockOnSlotsLoaded = vi.fn()

  beforeEach(() => {
    mockDispatch.mockClear()
    mockOnSlotsLoaded.mockClear()
    vi.restoreAllMocks()
  })

  it('renders date fields and search button', () => {
    render(<DateSelectionStep onSlotsLoaded={mockOnSlotsLoaded} />)

    // Custom DateRangePicker renders label elements with "Start Date" and "End Date"
    expect(screen.getByText('Start Date')).toBeInTheDocument()
    expect(screen.getByText('End Date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search Availability' })).toBeInTheDocument()
  })

  it('does not show duration input when flow is booking', () => {
    render(<DateSelectionStep onSlotsLoaded={mockOnSlotsLoaded} />)

    expect(screen.queryByLabelText('Duration (hours)')).not.toBeInTheDocument()
  })

  it('disables search button when no dates selected', () => {
    render(<DateSelectionStep onSlotsLoaded={mockOnSlotsLoaded} />)

    const button = screen.getByRole('button', { name: 'Search Availability' })
    expect(button).toBeDisabled()
  })
})

describe('DateSelectionStep (quote flow)', () => {
  beforeEach(() => {
    mockDispatch.mockClear()
    vi.restoreAllMocks()
  })

  it('shows duration input when flow is quote', async () => {
    const { unmount } = render(<DateSelectionStep onSlotsLoaded={vi.fn()} />)
    unmount()

    // Re-mock for quote flow
    const mod = await import('@components/booking/WizardContext')
    vi.spyOn(mod, 'useWizard').mockReturnValue({
      state: { eventType: { flow: 'quote', duration: 180 } } as any,
      dispatch: mockDispatch,
    })

    render(<DateSelectionStep onSlotsLoaded={vi.fn()} />)

    expect(screen.getByLabelText('Duration (hours)')).toBeInTheDocument()
  })
})
