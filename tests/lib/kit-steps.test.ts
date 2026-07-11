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
  it('full flow when nothing is preselected', () => {
    expect(visibleSteps({ craftSettled: false })).toEqual([
      'craft',
      'guests',
      'theme',
      'when',
      'pay',
    ])
  })

  it('drops the craft step when a craft is preselected', () => {
    expect(visibleSteps({ craftSettled: true })).toEqual(['guests', 'theme', 'when', 'pay'])
  })
})

describe('navigation', () => {
  const steps: KitStepId[] = ['guests', 'theme', 'when', 'pay']

  it('nextStep walks right and returns null at the end', () => {
    expect(nextStep('guests', steps)).toBe('theme')
    expect(nextStep('theme', steps)).toBe('when')
    expect(nextStep('when', steps)).toBe('pay')
    expect(nextStep('pay', steps)).toBeNull()
  })

  it('prevStep walks left and returns null at the start', () => {
    expect(prevStep('pay', steps)).toBe('when')
    expect(prevStep('when', steps)).toBe('theme')
    expect(prevStep('theme', steps)).toBe('guests')
    expect(prevStep('guests', steps)).toBeNull()
  })

  it('stepIndex reports the position within the visible flow', () => {
    expect(stepIndex('guests', steps)).toBe(0)
    expect(stepIndex('pay', steps)).toBe(3)
  })
})

describe('stepLabel', () => {
  it('labels every step', () => {
    expect(stepLabel('craft')).toBe('Crafts')
    expect(stepLabel('guests')).toBe('Guests')
    expect(stepLabel('theme')).toBe('Themed Table')
    expect(stepLabel('when')).toBe('Party Date')
    expect(stepLabel('pay')).toBe('Details & Payment')
  })
})
