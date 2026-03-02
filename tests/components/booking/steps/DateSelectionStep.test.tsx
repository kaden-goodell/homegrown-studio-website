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

  it('renders date inputs and search button', () => {
    render(<DateSelectionStep onSlotsLoaded={mockOnSlotsLoaded} />)

    expect(screen.getByLabelText('Start Date')).toBeInTheDocument()
    expect(screen.getByLabelText('End Date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search Availability' })).toBeInTheDocument()
  })

  it('does not show duration input when flow is booking', () => {
    render(<DateSelectionStep onSlotsLoaded={mockOnSlotsLoaded} />)

    expect(screen.queryByLabelText('Duration (hours)')).not.toBeInTheDocument()
  })

  it('calls API and dispatches SET_DATES on search', async () => {
    const mockSlots = [
      { id: 's1', startAt: '2026-03-15T10:00:00', endAt: '2026-03-15T12:00:00', duration: 120, locationId: 'main', available: true },
    ]

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSlots),
    })

    render(<DateSelectionStep onSlotsLoaded={mockOnSlotsLoaded} />)

    fireEvent.change(screen.getByLabelText('Start Date'), { target: { value: '2026-03-15' } })
    fireEvent.change(screen.getByLabelText('End Date'), { target: { value: '2026-03-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search Availability' }))

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'SET_DATES',
        payload: { start: '2026-03-15', end: '2026-03-20' },
      })
    })

    await waitFor(() => {
      expect(mockOnSlotsLoaded).toHaveBeenCalledWith(mockSlots)
    })

    expect(mockDispatch).toHaveBeenCalledWith({ type: 'GO_TO_STEP', payload: 2 })
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
