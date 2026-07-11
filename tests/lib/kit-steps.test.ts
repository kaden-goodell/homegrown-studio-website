import { describe, it, expect } from 'vitest'
import {
  visibleSteps,
  stepLabel,
  nextStep,
  prevStep,
  stepIndex,
  type KitStepId,
} from '@lib/kit-steps'

describe('visibleSteps', () => {
  it('full flow leads with crafts (matching the landing page order)', () => {
    expect(visibleSteps({ craftSettled: false })).toEqual(['craft', 'build', 'when', 'pay'])
  })

  it('drops the craft step when a craft is preselected', () => {
    expect(visibleSteps({ craftSettled: true })).toEqual(['build', 'when', 'pay'])
  })
})

describe('navigation', () => {
  const steps: KitStepId[] = ['build', 'when', 'pay']

  it('nextStep walks right and returns null at the end', () => {
    expect(nextStep('build', steps)).toBe('when')
    expect(nextStep('when', steps)).toBe('pay')
    expect(nextStep('pay', steps)).toBeNull()
  })

  it('prevStep walks left and returns null at the start', () => {
    expect(prevStep('pay', steps)).toBe('when')
    expect(prevStep('when', steps)).toBe('build')
    expect(prevStep('build', steps)).toBeNull()
  })

  it('stepIndex reports the position within the visible flow', () => {
    expect(stepIndex('build', steps)).toBe(0)
    expect(stepIndex('pay', steps)).toBe(2)
  })
})

describe('stepLabel', () => {
  it('labels every step', () => {
    expect(stepLabel('craft')).toBe('Crafts')
    expect(stepLabel('build')).toBe('Guests & Table')
    expect(stepLabel('when')).toBe('Party Date')
    expect(stepLabel('pay')).toBe('Details & Payment')
  })
})
