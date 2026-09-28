import { describe, it, expect } from 'vitest'
import { askedLine, emailedLine, failedLine, openSignups } from '@lib/signup-ledger'

describe('sign-up lines', () => {
  it('writes the line the sign-up endpoint has always written', () => {
    expect(askedLine('2026-09-27', 'party-later:2026-12')).toBe('2026-09-27 Asked to be told: party-later:2026-12')
    expect(askedLine('2026-09-27', '')).toBe('2026-09-27 Asked to be told: when booking opens')
  })

  it('writes an emailed line and a failed line for the same thing', () => {
    expect(emailedLine('2026-10-10', 'party:more-dates')).toBe('2026-10-10 Emailed: party:more-dates')
    expect(failedLine('2026-10-10', 'party:more-dates')).toBe('2026-10-10 Email failed: party:more-dates')
  })
})

describe('openSignups', () => {
  it('finds nothing in an empty note', () => {
    expect(openSignups('')).toEqual([])
    expect(openSignups(null)).toEqual([])
    expect(openSignups(undefined)).toEqual([])
  })

  it('finds a sign-up that has not been answered', () => {
    expect(openSignups('2026-09-27 Asked to be told: party-later:2026-12')).toEqual([
      { date: '2026-09-27', interest: 'party-later:2026-12' },
    ])
  })

  it('reads a sign-up that named nothing as an empty interest', () => {
    expect(openSignups('2026-09-27 Asked to be told: when booking opens')).toEqual([{ date: '2026-09-27', interest: '' }])
  })

  it('closes a sign-up once a later line says it was emailed', () => {
    const note = ['2026-10-10 Emailed: party-later:2026-12', '2026-09-27 Asked to be told: party-later:2026-12'].join('\n')
    expect(openSignups(note)).toEqual([])
  })

  it('closes a sign-up whose email failed, so nobody is emailed over and over', () => {
    const note = ['2026-10-10 Email failed: party:more-dates', '2026-09-27 Asked to be told: party:more-dates'].join('\n')
    expect(openSignups(note)).toEqual([])
  })

  it('opens it again when they sign up after the email went', () => {
    const note = [
      '2026-11-02 Asked to be told: workshop-waitlist:Kinusaiga 2026-11-20',
      '2026-10-10 Emailed: workshop-waitlist:Kinusaiga 2026-11-20',
      '2026-10-01 Asked to be told: workshop-waitlist:Kinusaiga 2026-11-20',
    ].join('\n')
    expect(openSignups(note)).toEqual([{ date: '2026-11-02', interest: 'workshop-waitlist:Kinusaiga 2026-11-20' }])
  })

  it('an email about one thing does not close a sign-up for another', () => {
    const note = [
      '2026-10-10 Emailed: party:booking-opens',
      '2026-09-28 Asked to be told: party-later:2026-12',
      '2026-09-27 Asked to be told: party:booking-opens',
    ].join('\n')
    expect(openSignups(note)).toEqual([{ date: '2026-09-28', interest: 'party-later:2026-12' }])
  })

  it('counts the same thing asked for twice once, keeping the first day', () => {
    const note = ['2026-09-29 Asked to be told: workshops:new-dates', '2026-09-27 Asked to be told: workshops:new-dates'].join('\n')
    expect(openSignups(note)).toEqual([{ date: '2026-09-27', interest: 'workshops:new-dates' }])
  })

  it('lists several open sign-ups oldest first', () => {
    const note = ['2026-09-29 Asked to be told: party:more-dates', '2026-09-27 Asked to be told: workshops:new-dates'].join('\n')
    expect(openSignups(note).map((s) => s.interest)).toEqual(['workshops:new-dates', 'party:more-dates'])
  })

  it('leaves alone anything staff wrote by hand, and other records kept in the note', () => {
    const note = [
      'Called 10/2, wants a Saturday',
      'waiver:abc123 signed 2026-09-30',
      '2026-09-27 Asked to be told: party:booking-opens',
      'Asked to be told: party:more-dates',
      '27/09/2026 Asked to be told: party:more-dates',
    ].join('\n')
    expect(openSignups(note)).toEqual([{ date: '2026-09-27', interest: 'party:booking-opens' }])
  })

  it('copes with Windows line endings and stray spaces', () => {
    expect(openSignups('  2026-09-27 Asked to be told: party:more-dates \r\n')).toEqual([
      { date: '2026-09-27', interest: 'party:more-dates' },
    ])
  })
})
