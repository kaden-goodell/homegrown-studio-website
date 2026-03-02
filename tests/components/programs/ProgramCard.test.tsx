import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProgramCard from '@components/programs/ProgramCard'
import type { ProgramConfig } from '@config/site.config'

const mockProgram: ProgramConfig = {
  id: 'summer-camp',
  name: 'Summer Art Camp',
  description: 'A week of creative exploration',
  enrollmentType: 'per-session',
  pricePerHead: 22500,
  maxCapacity: 12,
  ageRange: { min: 6, max: 12 },
  schedule: { days: 'Mon-Thu', time: '9:00 AM - 12:30 PM', totalHours: 3.5 },
  sessions: [
    { id: 'wk1', name: 'Week 1', startDate: '2026-06-08', endDate: '2026-06-11' },
    { id: 'wk2', name: 'Week 2', startDate: '2026-06-15', endDate: '2026-06-18' },
  ],
  instructorEmail: 'test@test.com',
}

describe('ProgramCard', () => {
  it('renders program name and description', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('Summer Art Camp')).toBeTruthy()
    expect(screen.getByText('A week of creative exploration')).toBeTruthy()
  })

  it('renders schedule', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText(/Mon-Thu/)).toBeTruthy()
  })

  it('renders age range', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText(/Ages 6/)).toBeTruthy()
  })

  it('renders session count for per-session programs', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('2 sessions available')).toBeTruthy()
  })

  it('renders price per session', () => {
    render(<ProgramCard program={mockProgram} onEnroll={() => {}} />)
    expect(screen.getByText('$225 / child / session')).toBeTruthy()
  })

  it('calls onEnroll when button clicked', () => {
    const onEnroll = vi.fn()
    render(<ProgramCard program={mockProgram} onEnroll={onEnroll} />)
    fireEvent.click(screen.getByText('Enroll Now'))
    expect(onEnroll).toHaveBeenCalledWith(mockProgram)
  })
})
