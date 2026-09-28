/**
 * Tests for the adult DOB masked-input helpers (HOM-212).
 */
import { describe, it, expect } from 'vitest'
import { maskDob, dobToIso } from '@lib/dob-input'

describe('maskDob', () => {
  it('inserts slashes as digits are typed', () => {
    expect(maskDob('0')).toBe('0')
    expect(maskDob('01')).toBe('01')
    expect(maskDob('011')).toBe('01/1')
    expect(maskDob('0115')).toBe('01/15')
    expect(maskDob('01152008')).toBe('01/15/2008')
  })

  it('strips non-digit characters before masking', () => {
    expect(maskDob('01/15/2008')).toBe('01/15/2008')
    expect(maskDob('ab01cd15ef2008')).toBe('01/15/2008')
  })

  it('caps at 8 digits (10 chars incl. slashes)', () => {
    expect(maskDob('011520081234')).toBe('01/15/2008')
  })
})

describe('dobToIso', () => {
  it('converts a valid MM/DD/YYYY to YYYY-MM-DD', () => {
    expect(dobToIso('01/15/2008')).toBe('2008-01-15')
  })

  it('returns null for an invalid month', () => {
    expect(dobToIso('13/40/2000')).toBeNull()
  })

  it('returns null for a roll-over day in a valid month', () => {
    expect(dobToIso('02/30/2001')).toBeNull()
  })

  it('returns null for a partial or malformed string', () => {
    expect(dobToIso('01/15')).toBeNull()
    expect(dobToIso('')).toBeNull()
    expect(dobToIso('not a date')).toBeNull()
  })
})
