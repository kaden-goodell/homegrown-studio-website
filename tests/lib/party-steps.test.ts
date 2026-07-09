import { describe, it, expect } from 'vitest'
import {
  visibleSteps,
  stepLabel,
  nextStep,
  prevStep,
  stepIndex,
  type PartyStepId,
} from '@lib/party-steps'

describe('visibleSteps', () => {
  it('full flow when nothing is preselected', () => {
    expect(visibleSteps({ craftSettled: false, slotSettled: false })).toEqual([
      'craft',
      'when',
      'who',
      'pay',
    ])
  })

  it('drops the craft step when a non-personalized craft is preselected', () => {
    expect(visibleSteps({ craftSettled: true, slotSettled: false })).toEqual([
      'when',
      'who',
      'pay',
    ])
  })

  it('drops the when step when a slot deeplink matched', () => {
    expect(visibleSteps({ craftSettled: false, slotSettled: true })).toEqual([
      'craft',
      'who',
      'pay',
    ])
  })

  it('drops both when craft and slot are settled', () => {
    expect(visibleSteps({ craftSettled: true, slotSettled: true })).toEqual(['who', 'pay'])
  })

  it('keeps the craft step for personalized preselections (craftSettled=false)', () => {
    // A personalized craft is preselected but NOT settled — the acknowledgment
    // checkbox lives on the craft step, so the caller passes craftSettled: false.
    expect(visibleSteps({ craftSettled: false, slotSettled: false })).toContain('craft')
  })
})

describe('navigation', () => {
  const steps: PartyStepId[] = ['when', 'who', 'pay']

  it('nextStep walks right and returns null at the end', () => {
    expect(nextStep('when', steps)).toBe('who')
    expect(nextStep('who', steps)).toBe('pay')
    expect(nextStep('pay', steps)).toBeNull()
  })

  it('prevStep walks left and returns null at the start', () => {
    expect(prevStep('pay', steps)).toBe('who')
    expect(prevStep('who', steps)).toBe('when')
    expect(prevStep('when', steps)).toBeNull()
  })

  it('stepIndex reports the position within the visible flow', () => {
    expect(stepIndex('when', steps)).toBe(0)
    expect(stepIndex('pay', steps)).toBe(2)
  })
})

describe('stepLabel', () => {
  it('labels every step', () => {
    expect(stepLabel('craft')).toBe('Craft')
    expect(stepLabel('when')).toBe('Date & Time')
    expect(stepLabel('who')).toBe('Guests')
    expect(stepLabel('pay')).toBe('Details & Payment')
  })
})
