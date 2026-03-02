import { describe, it, expect } from 'vitest'
import { enrollmentReducer, createInitialState, emptyChild } from '@components/programs/EnrollmentContext'
import type { ProgramConfig } from '@config/site.config'

const mockProgram: ProgramConfig = {
  id: 'test-camp',
  name: 'Test Camp',
  description: 'A test program',
  enrollmentType: 'per-session',
  pricePerHead: 20000,
  maxCapacity: 10,
  schedule: { days: 'Mon-Thu', time: '9 AM - 12 PM', totalHours: 3 },
  sessions: [
    { id: 'wk1', name: 'Week 1', startDate: '2026-06-08', endDate: '2026-06-11' },
    { id: 'wk2', name: 'Week 2', startDate: '2026-06-15', endDate: '2026-06-18' },
  ],
  instructorEmail: 'test@test.com',
}

describe('enrollmentReducer', () => {
  it('initializes with empty sessions for per-session programs', () => {
    const state = createInitialState(mockProgram)
    expect(state.selectedSessions).toEqual([])
    expect(state.headcount).toBe(1)
    expect(state.children).toHaveLength(1)
  })

  it('initializes with all sessions for full programs', () => {
    const fullProgram = { ...mockProgram, enrollmentType: 'full' as const }
    const state = createInitialState(fullProgram)
    expect(state.selectedSessions).toHaveLength(2)
  })

  it('SET_SESSIONS updates selected sessions', () => {
    const state = createInitialState(mockProgram)
    const next = enrollmentReducer(state, {
      type: 'SET_SESSIONS',
      payload: [mockProgram.sessions[0]],
    })
    expect(next.selectedSessions).toHaveLength(1)
    expect(next.selectedSessions[0].id).toBe('wk1')
  })

  it('SET_HEADCOUNT adjusts children array', () => {
    const state = createInitialState(mockProgram)
    const next = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 3 })
    expect(next.headcount).toBe(3)
    expect(next.children).toHaveLength(3)
  })

  it('SET_HEADCOUNT shrinks children array', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 3 })
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 1 })
    expect(state.children).toHaveLength(1)
  })

  it('SET_CHILD_INFO updates specific child', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 2 })
    const childInfo = { ...emptyChild(), firstName: 'Alice', lastName: 'Smith', age: '8' }
    state = enrollmentReducer(state, { type: 'SET_CHILD_INFO', payload: { index: 1, info: childInfo } })
    expect(state.children[1].firstName).toBe('Alice')
    expect(state.children[0].firstName).toBe('') // untouched
  })

  it('NEXT_STEP and PREV_STEP navigate', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'NEXT_STEP' })
    expect(state.currentStep).toBe(1)
    state = enrollmentReducer(state, { type: 'PREV_STEP' })
    expect(state.currentStep).toBe(0)
    state = enrollmentReducer(state, { type: 'PREV_STEP' })
    expect(state.currentStep).toBe(0) // doesn't go below 0
  })

  it('RESET returns to initial state', () => {
    let state = createInitialState(mockProgram)
    state = enrollmentReducer(state, { type: 'SET_HEADCOUNT', payload: 5 })
    state = enrollmentReducer(state, { type: 'NEXT_STEP' })
    state = enrollmentReducer(state, { type: 'RESET' })
    expect(state.currentStep).toBe(0)
    expect(state.headcount).toBe(1)
  })
})
