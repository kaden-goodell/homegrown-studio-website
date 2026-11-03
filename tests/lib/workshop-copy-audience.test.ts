import { describe, it, expect } from 'vitest'
import { agesLabel, audienceOfAges } from '@lib/workshop-copy'

describe('Kids & teens filter reads ages like the card label (final review I20)', () => {
  it.each([
    ['8 & up', 'kids'],
    ['8-12', 'kids'],
    ['Ages 8 to 12', 'kids'],
    ['8–12', 'kids'],
    ['13+', 'kids'],
    ['8 and up', 'kids'],
    ['18+', 'adults'],
    ['18 or older', 'adults'],
    ['Adults', 'adults'],
  ])('%s → %s', (ages, who) => {
    expect(audienceOfAges(ages)).toBe(who)
  })

  it('the card label and the filter agree on a camp', () => {
    expect(agesLabel('8-12')).toBe('Ages 8–12')
    expect(audienceOfAges('8-12')).toBe('kids')
  })
})
