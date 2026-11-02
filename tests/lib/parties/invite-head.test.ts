import { describe, it, expect } from 'vitest'
import { inviteHead } from '@lib/parties/invite-head'

describe('inviteHead (the guest invite page and its link preview)', () => {
  it('a cancelled party leads with that: no "invited", no date or time, nothing to RSVP', () => {
    const h = inviteHead({ cancelled: true, hasDetails: true, title: 'Mia turns 9', craft: 'Slime', when: 'Sat, Nov 14 at 2:00 PM CT' })
    expect(h).toEqual({
      eyebrow: 'Party cancelled', headline: 'This party was cancelled.', subline: 'Sorry for the change. Nothing to do here.',
      pageTitle: 'Party cancelled', description: 'This party was cancelled.', showDetails: false,
    })
    expect(JSON.stringify(h)).not.toMatch(/invited|RSVP|Nov 14|2:00/i)
  })

  it('a party still on: the invitation as before', () => {
    const h = inviteHead({ cancelled: false, hasDetails: true, title: '', craft: 'Slime', when: 'Sat, Nov 14 at 2:00 PM CT' })
    expect(h.headline).toBe('You’re invited to a craft party!')
    expect(h.description).toBe('Slime · Sat, Nov 14 at 2:00 PM CT · at Hometown Studio. Tap to RSVP.')
    expect(h.showDetails).toBe(true)
  })

  it('fix round 2 (Minor F): a party whose record can’t be read just now is never "invited" (it may be cancelled or moved): a neutral line, no details', () => {
    const h = inviteHead({ cancelled: false, hasDetails: true, title: 'Mia turns 9', craft: 'Slime', when: 'Sat, Nov 14 at 2:00 PM CT', unreadable: true })
    expect(h).toEqual({
      eyebrow: 'Party invite', headline: 'We couldn’t load this party right now.', subline: 'Try again in a minute.',
      pageTitle: 'Party invite', description: 'A craft party at Hometown Studio.', showDetails: false,
    })
    expect(JSON.stringify(h)).not.toMatch(/invited|RSVP|Nov 14|2:00|Slime|Mia/i)
  })
})
