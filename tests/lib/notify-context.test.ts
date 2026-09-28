import { describe, it, expect } from 'vitest'
import { longDate, partyNotifyContext, workshopNotifyContext } from '@lib/notify-context'

const TZ = 'America/Chicago'
const q = (s: string) => new URLSearchParams(s)

describe('longDate', () => {
  it('names the weekday for a studio-local date', () => {
    expect(longDate('2026-10-16')).toBe('Friday, October 16')
  })
})

describe('partyNotifyContext', () => {
  it('says back a date chosen on the calendar', () => {
    expect(partyNotifyContext(q('date=2026-10-24'), TZ)).toEqual({
      lookingAt: 'Saturday, October 24',
      interest: 'party-date:2026-10-24',
    })
  })

  it('says back a start time in studio time', () => {
    // 19:00 UTC on 17 Oct is 2:00 PM Central (daylight time)
    const ctx = partyNotifyContext(q('start=2026-10-17T19:00:00.000Z'), TZ)
    expect(ctx.lookingAt).toBe('Saturday, October 17 at 2:00 PM')
    expect(ctx.interest).toBe('party-time:2026-10-17T19:00Z')
  })

  it('keeps the studio day when the UTC day has already rolled over', () => {
    // 00:30 UTC on 18 Oct is 7:30 PM Central on the 17th
    expect(partyNotifyContext(q('start=2026-10-18T00:30:00.000Z'), TZ).lookingAt).toBe('Saturday, October 17 at 7:30 PM')
  })

  it('passes a craft along without trying to name it', () => {
    expect(partyNotifyContext(q('craft=AWQTIIWL4Q7ISM4D6ZYBKL6K'), TZ)).toEqual({
      lookingAt: '',
      interest: 'party-craft:AWQTIIWL4Q7ISM4D6ZYBKL6K',
    })
  })

  it('falls back to the plain sign-up with nothing in the address', () => {
    expect(partyNotifyContext(q(''), TZ)).toEqual({ lookingAt: '', interest: 'party:booking-opens' })
  })

  it('ignores values that are not what they claim to be', () => {
    const plain = { lookingAt: '', interest: 'party:booking-opens' }
    expect(partyNotifyContext(q('date=tomorrow'), TZ)).toEqual(plain)
    expect(partyNotifyContext(q('date=2026-13-45'), TZ)).toEqual(plain)
    expect(partyNotifyContext(q('start=not-a-time'), TZ)).toEqual(plain)
    expect(partyNotifyContext(q('craft=<script>alert(1)</script>'), TZ)).toEqual(plain)
  })

  it('keeps the interest within the 80 characters the endpoint stores', () => {
    const ctx = partyNotifyContext(q(`craft=${'A'.repeat(40)}`), TZ)
    expect(ctx.interest.length).toBeLessThanOrEqual(80)
  })
})

describe('workshopNotifyContext', () => {
  it('names the workshop and its studio-local day', () => {
    // 7 PM Central on Fri 16 Oct is 00:00 UTC on the 17th
    expect(workshopNotifyContext({ name: 'Kinusaiga', startAt: '2026-10-17T00:00:00.000Z' }, TZ)).toEqual({
      lookingAt: 'Kinusaiga, Fri, Oct 16',
      interest: 'workshop:Kinusaiga 2026-10-16',
    })
  })

  it('falls back when the workshop could not be found', () => {
    const plain = { lookingAt: '', interest: 'workshops:booking-opens' }
    expect(workshopNotifyContext(null, TZ)).toEqual(plain)
    expect(workshopNotifyContext(undefined, TZ)).toEqual(plain)
    expect(workshopNotifyContext({ name: '', startAt: '2026-10-17T00:00:00.000Z' }, TZ)).toEqual(plain)
    expect(workshopNotifyContext({ name: 'Kinusaiga', startAt: 'soon' }, TZ)).toEqual(plain)
  })

  it('cuts a long name so the date still fits in 80 characters', () => {
    const ctx = workshopNotifyContext({ name: 'Girls Grades 9–12 Craft Night: '.repeat(4), startAt: '2026-10-25T21:00:00.000Z' }, TZ)
    expect(ctx.interest.length).toBeLessThanOrEqual(80)
    expect(ctx.interest.endsWith('2026-10-25')).toBe(true)
  })
})
