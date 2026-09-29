import { describe, it, expect } from 'vitest'
import { flowPropsFor } from '@lib/waiver-page'

describe('flowPropsFor (what /waiver hands WaiverFlow)', () => {
  it('a resolved drop-off event passes its id, label and dropOff', () => {
    expect(flowPropsFor('workshop', { kind: 'ok', id: 'ws1', label: 'Camp', dropOff: true }))
      .toMatchObject({ workshopId: 'ws1', partyId: undefined, eventTitle: 'Camp', dropOff: true, notice: null })
  })

  it('an event LOOKUP ERROR keeps the id but does NOT assume drop-off', () => {
    const p = flowPropsFor('party', { kind: 'error', id: 'p1' })
    expect(p.partyId).toBe('p1')
    expect(p.dropOff).toBe(false)
  })

  it('unknown / past events pass no id and show the notice; no event passes nothing', () => {
    expect(flowPropsFor('party', { kind: 'unknown', notice: 'nope' })).toMatchObject({ partyId: undefined, notice: 'nope', dropOff: undefined })
    expect(flowPropsFor('party', { kind: 'past', notice: 'over' })).toMatchObject({ partyId: undefined, notice: 'over' })
    expect(flowPropsFor(null, { kind: 'none' })).toMatchObject({ partyId: undefined, workshopId: undefined, notice: null })
  })
})
