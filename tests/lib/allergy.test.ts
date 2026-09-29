import { describe, it, expect } from 'vitest'
import { hasAllergy } from '@lib/allergy'

describe('hasAllergy', () => {
  it.each(['peanuts', 'Tree nuts, shellfish', 'penicillin', 'None of the above but latex'])('true for %s', (v) => {
    expect(hasAllergy(v)).toBe(true)
  })
  it.each(['', '   ', undefined, null, 'None', 'none', ' NONE ', 'n/a', 'N/A', 'No', 'NKA', 'None.'])('false for %j', (v) => {
    expect(hasAllergy(v as any)).toBe(false)
  })
})
