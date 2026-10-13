import { describe, it, expect } from 'vitest'
import { agreementState, isCurrent } from '@lib/waiver-coverage'
import { substantiveSince } from '@config/waiver-content'

const NOW = new Date('2026-10-18T14:00:00.000Z')
describe('agreementState (the door check and the class-day reminder share it)', () => {
  it('current: unexpired, on the current terms', () => {
    expect(agreementState({ validUntil: '2027-01-01T00:00:00.000Z', agreementVersion: substantiveSince }, NOW)).toBe('current')
    expect(isCurrent({ validUntil: '2027-01-01T00:00:00.000Z', agreementVersion: substantiveSince }, NOW)).toBe(true)
  })
  it('expired: the moment it lapses', () => {
    expect(agreementState({ validUntil: NOW.toISOString(), agreementVersion: substantiveSince }, NOW)).toBe('expired')
  })
  it('outdated: older terms, even if unexpired', () => {
    expect(agreementState({ validUntil: '2027-01-01T00:00:00.000Z', agreementVersion: 'v0' }, NOW)).toBe('outdated')
  })
  it('an unreadable date is not current', () => {
    expect(isCurrent({ validUntil: 'garbage', agreementVersion: substantiveSince }, NOW)).toBe(false)
  })
})
