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
    expect(stepLabel('package')).toBe('Package')
    expect(stepLabel('extras')).toBe('Extras')
    expect(stepLabel('pay')).toBe('Your details and payment')
  })
})

describe('extras step', () => {
  it('is absent with no add-ons and no themed tables (the config today)', () => {
    expect(visibleSteps({ slotSettled: false, addOnCount: 0, themesAvailable: false })).toEqual(['craft', 'when', 'who', 'pay'])
  })

  it('appears between guests and pay when an online add-on is offered', () => {
    expect(visibleSteps({ slotSettled: false, addOnCount: 1 })).toEqual(['craft', 'when', 'who', 'extras', 'pay'])
  })

  it('appears between guests and pay when themed tables are available', () => {
    expect(visibleSteps({ slotSettled: false, themesAvailable: true })).toEqual(['craft', 'when', 'who', 'extras', 'pay'])
  })

  it('composes with a settled time', () => {
    expect(visibleSteps({ slotSettled: true, addOnCount: 2 })).toEqual(['craft', 'who', 'extras', 'pay'])
  })
})

describe('package step', () => {
  it('is absent with one package', () => {
    expect(visibleSteps({ slotSettled: false, packageCount: 1 })).toEqual(['craft', 'when', 'who', 'pay'])
  })

  it('comes after the craft, before the date, when more than one package is offered', () => {
    expect(visibleSteps({ slotSettled: false, packageCount: 2 })).toEqual(['craft', 'package', 'when', 'who', 'pay'])
  })

  it('is shown when a link names a link-only package', () => {
    expect(visibleSteps({ slotSettled: false, packageCount: 1, linkPackage: true })).toEqual(['craft', 'package', 'when', 'who', 'pay'])
  })
})
