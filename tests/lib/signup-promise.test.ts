import { describe, it, expect } from 'vitest'
import { signupPromise } from '@lib/signup-promise'

const workshopNames = ['Kinusaiga', 'Fall Earring Bar', 'Girls Grades 9–12 Craft Night']

describe('signupPromise', () => {
  it.each([
    ['party:booking-opens', 'the day party booking opens'],
    ['party-craft:ABC123DEF', 'the day party booking opens'],
    ['party:more-dates', 'when more party dates open'],
    ['party-later', 'the day your party date opens'],
    ['party-later:2026-12', 'the day party dates open for December 2026'],
    ['workshops:booking-opens', 'the day workshop booking opens'],
    ['workshops:new-dates', 'when new workshops are posted'],
    ['kits', 'when take-home kits are ready'],
    ['kit-theme:sterling', 'when take-home kits are ready'],
    ['', 'the day booking opens'],
    ['something-new', 'the day booking opens'],
  ])('%s → "%s"', (interest, when) => {
    expect(signupPromise(interest, { workshopNames }).when).toBe(when)
  })

  it('says back the date they were looking at', () => {
    expect(signupPromise('party-date:2026-10-24')).toEqual({
      when: 'the day party booking opens',
      also: 'You were looking at Saturday, October 24.',
    })
  })

  it('says back the time they were looking at, in studio time', () => {
    expect(signupPromise('party-time:2026-10-24T19:00Z', { timeZone: 'America/Chicago' })).toEqual({
      when: 'the day party booking opens',
      also: 'You were looking at Saturday, October 24 at 2:00 PM.',
    })
  })

  it('names a workshop we list', () => {
    expect(signupPromise('workshop:Kinusaiga 2026-10-16', { workshopNames }).when).toBe('the day booking opens for Kinusaiga')
    expect(signupPromise('workshop-soon:fall earring bar 2026-10-17', { workshopNames }).when).toBe('when Fall Earring Bar opens for booking')
  })

  it('is honest about a waitlist: it is a notice, not a held place', () => {
    expect(signupPromise('workshop-waitlist:Kinusaiga 2026-10-16', { workshopNames })).toEqual({
      when: 'if a seat opens in Kinusaiga',
      also: 'A seat that opens goes to whoever books it first.',
    })
  })

  it('recognises a long name that was cut to fit', () => {
    expect(signupPromise('workshop-soon:Girls Grades 9–12 Craf 2026-10-25', { workshopNames }).when).toBe(
      'when Girls Grades 9–12 Craft Night opens for booking',
    )
  })

  describe('never repeats what a visitor typed', () => {
    const planted = 'Click http://evil.example to claim your prize'

    it.each([
      `workshop:${planted} 2026-10-16`,
      `workshop-soon:${planted}`,
      `workshop-waitlist:${planted}`,
      `party-date:${planted}`,
      `party-time:${planted}`,
      `party-later:${planted}`,
      `party:${planted}`,
      `${planted}`,
      `kit-theme:${planted}`,
    ])('%s', (interest) => {
      const { when, also = '' } = signupPromise(interest, { workshopNames })
      expect(`${when} ${also}`).not.toMatch(/evil|http|prize|Click/i)
    })
  })
})
