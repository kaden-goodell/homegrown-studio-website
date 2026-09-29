import { describe, it, expect } from 'vitest'
import { hasAllergy, isNoneToken } from '@lib/allergy'

describe('hasAllergy', () => {
  it.each(['peanuts', 'Tree nuts, shellfish', 'penicillin', 'None of the above but latex'])('true for %s', (v) => {
    expect(hasAllergy(v)).toBe(true)
  })
  it.each(['', '   ', undefined, null, 'None', 'none', ' NONE ', 'n/a', 'N/A', 'No', 'NKA', 'None.'])('false for %j', (v) => {
    expect(hasAllergy(v as any)).toBe(false)
  })
})

describe('isNoneToken', () => {
  it.each(['None', 'none', ' NONE. ', 'n/a', 'N/A', 'na', 'No'])('true for %j', (v) => expect(isNoneToken(v)).toBe(true))
  it.each(['', '  ', undefined, null, 'Rick Smith', 'None of your business', 'Nora'])('false for %j', (v) => expect(isNoneToken(v as any)).toBe(false))
})
