import { describe, it, expect } from 'vitest'
import { contactIsUsable, contactProblems, contactStarted, isEmail, isPhone, problemWith, CONTACT_MESSAGES } from '@lib/contact-rules'

const good = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '(256) 555-0123' }

describe('isEmail', () => {
  it('accepts an ordinary address, with spaces around it', () => {
    expect(isEmail('ada@example.com')).toBe(true)
    expect(isEmail('  ada.l+studio@mail.example.co  ')).toBe(true)
  })
  it('refuses what is plainly not one', () => {
    for (const bad of ['', 'a', 'ada@', '@example.com', 'ada@example', 'ada example@x.com']) expect(isEmail(bad)).toBe(false)
  })
})

describe('isPhone', () => {
  it('accepts ten digits however they are written', () => {
    for (const ok of ['2565550123', '(256) 555-0123', '256.555.0123', '+1 256 555 0123', '1-256-555-0123']) expect(isPhone(ok)).toBe(true)
  })
  it('refuses nine digits, twelve digits, and eleven that do not start with 1', () => {
    for (const bad of ['', '256555012', '256-555-01234-5', '2-256-555-0123']) expect(isPhone(bad)).toBe(false)
  })
})

describe('contactProblems', () => {
  it('finds nothing wrong with usable details', () => {
    expect(contactProblems(good, { phoneRequired: true })).toEqual({})
    expect(contactIsUsable(good, { phoneRequired: true })).toBe(true)
  })

  it('names each missing field in plain words', () => {
    expect(contactProblems({ firstName: ' ', lastName: '', email: '', phone: '' }, { phoneRequired: true })).toEqual({
      firstName: CONTACT_MESSAGES.firstName,
      lastName: CONTACT_MESSAGES.lastName,
      email: CONTACT_MESSAGES.emailMissing,
      phone: CONTACT_MESSAGES.phone,
    })
  })

  it('tells a typo from a blank', () => {
    expect(problemWith('email', { ...good, email: 'ada@example' }, { phoneRequired: true })).toBe(CONTACT_MESSAGES.email)
  })

  it('lets a workshop booking go without a phone number', () => {
    expect(contactIsUsable({ ...good, phone: '' }, { phoneRequired: false })).toBe(true)
  })

  it('still refuses an unusable number when the phone is optional', () => {
    expect(contactProblems({ ...good, phone: '555-0123' }, { phoneRequired: false })).toEqual({ phone: CONTACT_MESSAGES.phone })
  })

  it('never accepts a first name standing in for a last name', () => {
    expect(contactProblems({ ...good, lastName: '' }, { phoneRequired: false })).toEqual({ lastName: CONTACT_MESSAGES.lastName })
  })
})

describe('contactStarted', () => {
  it('is false until something is typed', () => {
    expect(contactStarted({ firstName: '', lastName: ' ', email: '', phone: '' })).toBe(false)
    expect(contactStarted({ firstName: '', lastName: '', email: 'a', phone: '' })).toBe(true)
  })
})
