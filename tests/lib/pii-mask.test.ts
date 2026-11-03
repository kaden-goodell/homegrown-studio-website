import { describe, it, expect } from 'vitest'
import { maskContact, maskEmail, maskPhone } from '@lib/pii-mask'

describe('pii-mask', () => {
  it('masks emails to the first letter and the domain', () => {
    expect(maskEmail('jane.doe@gmail.com')).toBe('j•••@gmail.com')
    expect(maskEmail('')).toBe('')
    expect(maskEmail('nope')).toBe('•••')
  })
  it('masks phones to the last four digits', () => {
    expect(maskPhone('(256) 555-1234')).toBe('••1234')
    expect(maskPhone('+12565551234')).toBe('••1234')
    expect(maskPhone(null)).toBe('')
  })
  it('masks whichever a contact looks like', () => {
    expect(maskContact('jane@x.co')).toBe('j•••@x.co')
    expect(maskContact('256-555-1234')).toBe('••1234')
    expect(maskContact('Jane Smith')).toBe('J•••')
  })
})
