import { describe, it, expect } from 'vitest'
import { issueEmailFixTicket, readEmailFixTicket, planEmailFix, onFileToAskAbout, type EmailFixTicket } from '@lib/email-fix'

const base: EmailFixTicket = { kind: 'workshop', bookingId: 'clsbk_1', customerId: 'C1', typed: 'meredithblackphptography@gmail.com', onFile: null, matchedBy: 'new', eventId: 'clssch_1' }

describe('email-fix ticket', () => {
  it('round-trips, and any change or expiry breaks it', () => {
    const now = Date.now()
    const token = issueEmailFixTicket(base, now)
    expect(readEmailFixTicket(token, now)?.bookingId).toBe('clsbk_1')
    const [body, mac] = token.split('.')
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), customerId: 'VICTIM' })).toString('base64url')
    expect(readEmailFixTicket(`${tampered}.${mac}`, now)).toBeNull()
    expect(readEmailFixTicket(token, now + 25 * 60 * 60 * 1000)).toBeNull()
    expect(readEmailFixTicket('nonsense', now)).toBeNull()
  })
})

describe('onFileToAskAbout', () => {
  it('asks only when the phone matched and the emails are a slip apart', () => {
    expect(onFileToAskAbout('meredithblackphptography@gmail.com', { email: 'Meredithblackphotography@gmail.com', matchedBy: 'phone' })).toBe('Meredithblackphotography@gmail.com')
    expect(onFileToAskAbout('jane.work@company.com', { email: 'jane@gmail.com', matchedBy: 'phone' })).toBeNull()
    expect(onFileToAskAbout('jane@gmail.com', { email: 'jane@gmail.com', matchedBy: 'email' })).toBeNull()
    expect(onFileToAskAbout('jane@gmial.com', { email: 'jane@gmail.com', matchedBy: 'new' })).toBeNull()
  })
})

describe('planEmailFix', () => {
  it('a new customer fixing their typo: resend and fix their Square record', () => {
    expect(planEmailFix(base, 'meredithblackphotography@gmail.com')).toEqual({ action: 'resend', email: 'meredithblackphotography@gmail.com', updateSquare: true })
  })

  it('picking between typed and on-file: settles the record, no resend', () => {
    const t = { ...base, matchedBy: 'phone' as const, onFile: 'meredithblackphotography@gmail.com' }
    expect(planEmailFix(t, 'meredithblackphotography@gmail.com')).toEqual({ action: 'choose', email: 'meredithblackphotography@gmail.com', updateSquare: false })
    expect(planEmailFix(t, 'meredithblackphptography@gmail.com')).toEqual({ action: 'choose', email: 'meredithblackphptography@gmail.com', updateSquare: true })
  })

  it('a record found by phone, changed to a wholly different email: resend, but leave Square alone', () => {
    const t = { ...base, matchedBy: 'phone' as const, typed: 'someone@gmail.com', onFile: null }
    expect(planEmailFix(t, 'attacker@evil.com')).toEqual({ action: 'resend', email: 'attacker@evil.com', updateSquare: false })
  })

  it('a record found by email, changed to a wholly different email: leave Square alone', () => {
    const t = { ...base, matchedBy: 'email' as const, typed: 'victim@gmail.com' }
    expect(planEmailFix(t, 'attacker@evil.com').action).toBe('resend')
    expect((planEmailFix(t, 'attacker@evil.com') as any).updateSquare).toBe(false)
    expect((planEmailFix(t, 'victim@gmial.com') as any).updateSquare).toBe(true)
  })

  it('the same address is nothing to do', () => {
    expect(planEmailFix(base, ' MeredithBlackPhptography@gmail.com ')).toEqual({ action: 'none' })
  })
})
