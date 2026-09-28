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
    expect(visibleSteps({ slotSettled: false })).toEqual(['craft', 'when', 'who', 'pay'])
  })

  it('always keeps the craft step: it is where the description is read and the choice changed', () => {
    expect(visibleSteps({ slotSettled: false })[0]).toBe('craft')
    expect(visibleSteps({ slotSettled: true })[0]).toBe('craft')
  })

  it('drops the when step when a calendar link carried an exact, open time', () => {
    expect(visibleSteps({ slotSettled: true })).toEqual(['craft', 'who', 'pay'])
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
    expect(stepLabel('when')).toBe('Date and time')
    expect(stepLabel('who')).toBe('Guests')
    expect(stepLabel('theme')).toBe('Themed table')
    expect(stepLabel('pay')).toBe('Your details and payment')
  })
})

describe('themed-table step', () => {
  it('is absent by default (feature off / no stocked themes)', () => {
    expect(visibleSteps({ slotSettled: false })).toEqual(['craft', 'when', 'who', 'pay'])
  })

  it('appears between guests and pay when themes are available', () => {
    expect(visibleSteps({ slotSettled: false, themesAvailable: true })).toEqual([
      'craft', 'when', 'who', 'theme', 'pay',
    ])
  })

  it('composes with a settled time', () => {
    expect(visibleSteps({ slotSettled: true, themesAvailable: true })).toEqual([
      'craft', 'who', 'theme', 'pay',
    ])
  })
})
