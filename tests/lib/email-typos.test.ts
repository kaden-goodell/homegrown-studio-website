import { describe, it, expect } from 'vitest'
import { suggestEmailFix, isNearMiss } from '@lib/email-typos'

describe('suggestEmailFix', () => {
  it.each([
    ['jane@gmial.com', 'jane@gmail.com'],
    ['jane@gmail.con', 'jane@gmail.com'],
    ['jane@gmai.com', 'jane@gmail.com'],
    ['Jane.Doe@yaho.com', 'Jane.Doe@yahoo.com'],
    ['jane@icloud.co', 'jane@icloud.com'],
    ['jane@hotmial.com', 'jane@hotmail.com'],
    ['jane@outlok.com', 'jane@outlook.com'],
  ])('%s → %s', (typed, fixed) => expect(suggestEmailFix(typed)).toBe(fixed))

  it.each(['jane@gmail.com', 'jane@ourhometownstudio.com', 'jane@uah.edu', 'jane@redstone.army.mil', 'jane@', 'jane', 'jane@att.net'])(
    'leaves %s alone',
    (typed) => expect(suggestEmailFix(typed)).toBeNull(),
  )

  it('cannot catch a slip in the name part — that is what the confirmation screen is for', () => {
    expect(suggestEmailFix('meredithblackphptography@gmail.com')).toBeNull()
  })
})

describe('isNearMiss', () => {
  it('spots a one- or two-letter slip', () => {
    expect(isNearMiss('meredithblackphptography@gmail.com', 'Meredithblackphotography@gmail.com')).toBe(true)
    expect(isNearMiss('jane.doe@gmail.com', 'jane.deo@gmail.com')).toBe(true)
  })
  it('is not the same address, nor a different one', () => {
    expect(isNearMiss('jane@gmail.com', 'JANE@gmail.com')).toBe(false)
    expect(isNearMiss('jane@gmail.com', 'jane.work@company.com')).toBe(false)
    expect(isNearMiss('mom@gmail.com', 'dad@gmail.com')).toBe(false)
  })
})
