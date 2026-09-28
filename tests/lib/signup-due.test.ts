import { describe, it, expect } from 'vitest'
import { judge, type StudioFacts, type WorkshopFact } from '@lib/signup-due'

const workshop = (over: Partial<WorkshopFact> = {}): WorkshopFact => ({
  id: 'clsschi_kinusaiga',
  name: 'Kinusaiga',
  startAt: '2026-10-17T00:00:00.000Z', // Fri Oct 16, 7:00 PM Central
  durationMinutes: 120,
  priceCents: 4000,
  seatsLeft: 12,
  ...over,
})

// Saturday Oct 24: 9:00 AM and 2:00 PM Central. Sunday Oct 25: 1:00 PM.
const OCT_24_9AM = '2026-10-24T14:00:00.000Z'
const OCT_24_2PM = '2026-10-24T19:00:00.000Z'
const OCT_25_1PM = '2026-10-25T18:00:00.000Z'
const NOV_07_9AM = '2026-11-07T15:00:00.000Z'

const facts = (over: Partial<StudioFacts> = {}): StudioFacts => ({
  now: new Date('2026-10-10T15:00:00.000Z'),
  bookingOpen: true,
  openPartyStarts: [OCT_24_9AM, OCT_24_2PM, OCT_25_1PM, NOV_07_9AM],
  workshops: [workshop()],
  kitsOpen: false,
  bookingWindowDays: 45,
  timeZone: 'America/Chicago',
  ...over,
})

const due = (interest: string, f: StudioFacts = facts()) => {
  const v = judge(interest, f)
  if (v.state !== 'due') throw new Error(`expected due, got ${v.state}`)
  return v.item
}

describe('while booking is closed', () => {
  const closed = facts({ bookingOpen: false })

  it.each([
    '',
    'party:booking-opens',
    'party:more-dates',
    'party-date:2026-10-24',
    'party-later:2026-12',
    'workshops:booking-opens',
    'workshop:Kinusaiga 2026-10-16',
    'workshop-soon:Kinusaiga 2026-10-16',
    'workshop-waitlist:Kinusaiga 2026-10-16',
  ])('nothing is due: %s', (interest) => {
    expect(judge(interest, closed)).toEqual({ state: 'wait' })
  })

  it('a waiting-list sign-up for a workshop that has been and gone is over', () => {
    expect(judge('workshop-waitlist:Kinusaiga 2026-10-02', closed)).toEqual({ state: 'over' })
  })
})

describe('party booking opening', () => {
  it('tells someone who asked about booking that it is open, with the next open date', () => {
    expect(due('party:booking-opens')).toEqual({
      headline: 'Party booking is open',
      lines: ['The next open date is Saturday, October 24.'],
      path: '/book',
      linkLabel: 'See open dates',
    })
  })

  it('treats a sign-up that named nothing the same way', () => {
    expect(due('').headline).toBe('Party booking is open')
  })

  it('waits while no party date is on offer, even with booking open', () => {
    expect(judge('party:booking-opens', facts({ openPartyStarts: [] }))).toEqual({ state: 'wait' })
    expect(judge('party:more-dates', facts({ openPartyStarts: [] }))).toEqual({ state: 'wait' })
  })

  it('tells someone waiting for more dates that there are some', () => {
    expect(due('party:more-dates').headline).toBe('More party dates are open')
  })

  it('links straight to the craft they were looking at', () => {
    expect(due('party-craft:ABCDEF123456').path).toBe('/book?craft=ABCDEF123456')
  })

  it('never puts something that is not a craft id into a link', () => {
    expect(due('party-craft:"><script>').path).toBe('/book')
  })
})

describe('a party date someone was looking at', () => {
  it('links straight to the date when it is open', () => {
    expect(due('party-date:2026-10-24')).toEqual({
      headline: 'Saturday, October 24 is open for a party',
      lines: ['A date is held for whoever books it first.'],
      path: '/book?date=2026-10-24',
      linkLabel: 'Book October 24',
    })
  })

  it('links straight to the time when that time is open', () => {
    const item = due('party-time:2026-10-24T19:00Z')
    expect(item.lines[0]).toBe('2:00 PM is open. A date is held for whoever books it first.')
    expect(item.path).toBe(`/book?start=${encodeURIComponent(OCT_24_2PM)}`)
  })

  it('links to the date when the time has gone but the date has others', () => {
    const item = due('party-time:2026-10-24T16:30Z')
    expect(item.path).toBe('/book?date=2026-10-24')
  })

  it('says so when the date is not available, and points at the dates that are', () => {
    const item = due('party-date:2026-10-31')
    expect(item.headline).toBe('Party booking is open')
    expect(item.lines).toEqual([
      'Saturday, October 31 is not available, but other dates are.',
      'The next open date is Saturday, October 24.',
    ])
    expect(item.path).toBe('/book')
  })

  it('promises nothing about a date further ahead than dates are open', () => {
    const item = due('party-date:2026-12-12')
    expect(item.lines[0]).toBe('We open party dates 45 days ahead, so Saturday, December 12 is not on the calendar yet.')
    expect(item.path).toBe('/book')
  })

  it('still tells them booking opened when the date they looked at has passed', () => {
    const item = due('party-date:2026-10-03')
    expect(item).toEqual({
      headline: 'Party booking is open',
      lines: ['The next open date is Saturday, October 24.'],
      path: '/book',
      linkLabel: 'See open dates',
    })
  })

  it('reads a date that is not a date as a plain booking sign-up', () => {
    expect(due('party-date:soon').path).toBe('/book')
    expect(due('party-time:whenever').path).toBe('/book')
  })
})

describe('planning something later', () => {
  it('waits until a date in that month is open', () => {
    expect(judge('party-later:2026-12', facts())).toEqual({ state: 'wait' })
  })

  it('tells them the day the first date in that month opens', () => {
    const f = facts({ now: new Date('2026-10-25T15:00:00.000Z'), openPartyStarts: [NOV_07_9AM, '2026-12-05T15:00:00.000Z'] })
    expect(due('party-later:2026-12', f)).toEqual({
      headline: 'Party dates in December are opening',
      lines: [
        'The first open date is Saturday, December 5.',
        'We open dates 45 days ahead, so the rest of December opens day by day.',
      ],
      path: '/book?date=2026-12-05',
      linkLabel: 'See December dates',
    })
  })

  it('says nothing about a month whose only dates are closed', () => {
    // Christmas week is closed, so it is never in the list of open party times.
    const f = facts({ now: new Date('2026-11-20T15:00:00.000Z'), openPartyStarts: [] })
    expect(judge('party-later:2026-12', f)).toEqual({ state: 'wait' })
  })

  it('is over once the month has passed', () => {
    expect(judge('party-later:2026-09', facts())).toEqual({ state: 'over' })
  })

  it('cannot answer a sign-up that named no month: left for a person', () => {
    expect(judge('party-later', facts())).toEqual({ state: 'unknown' })
    expect(judge('party-later:someday', facts())).toEqual({ state: 'unknown' })
  })
})

describe('workshops', () => {
  it('tells someone who asked about a workshop that it can be booked, and links to it', () => {
    expect(due('workshop:Kinusaiga 2026-10-16')).toEqual({
      headline: 'Booking is open for Kinusaiga',
      lines: ['Friday, October 16 at 7:00 PM. $40 per seat.'],
      path: '/workshops?w=clsschi_kinusaiga',
      linkLabel: 'See details and book',
    })
  })

  it('finds a workshop whose name was cut short to fit', () => {
    const long = workshop({ id: 'w2', name: 'Girls Grades 9–12 Craft Night', startAt: '2026-10-25T21:00:00.000Z' })
    const item = due('workshop:Girls Grades 9–12 Craft 2026-10-25', facts({ workshops: [long] }))
    expect(item.headline).toBe('Booking is open for Girls Grades 9–12 Craft Night')
  })

  it('never repeats a name we do not list', () => {
    const item = due('workshop:Free Money Night 2026-10-16')
    expect(JSON.stringify(item)).not.toContain('Free Money')
    expect(item.headline).toBe('Workshop booking is open')
    expect(item.path).toBe('/workshops')
  })

  it('does not match the same name on another day', () => {
    const item = due('workshop:Kinusaiga 2026-11-20')
    expect(item.path).toBe('/workshops')
  })

  it('tells someone who asked about workshops in general', () => {
    const two = [workshop(), workshop({ id: 'w2', name: 'Fall Earring Bar', startAt: '2026-10-18T00:00:00.000Z', priceCents: 3500 })]
    expect(due('workshops:booking-opens', facts({ workshops: two }))).toEqual({
      headline: 'Workshop booking is open',
      lines: ['2 workshops are open for booking. The first is Kinusaiga on Friday, October 16.'],
      path: '/workshops',
      linkLabel: 'See the workshops',
    })
    expect(due('workshops:new-dates').headline).toBe('New workshops are posted')
  })

  it('waits while nothing can be booked: sold out, unpriced, or already started', () => {
    for (const w of [workshop({ seatsLeft: 0 }), workshop({ priceCents: 0 }), workshop({ startAt: '2026-10-09T00:00:00.000Z' })]) {
      expect(judge('workshops:new-dates', facts({ workshops: [w] }))).toEqual({ state: 'wait' })
    }
    expect(judge('workshops:new-dates', facts({ workshops: [] }))).toEqual({ state: 'wait' })
  })

  it('a "coming soon" sign-up waits for a price, then is due', () => {
    const interest = 'workshop-soon:Kinusaiga 2026-10-16'
    expect(judge(interest, facts({ workshops: [workshop({ priceCents: 0 })] }))).toEqual({ state: 'wait' })
    expect(due(interest).headline).toBe('Kinusaiga is open for booking')
  })

  it('a waiting-list sign-up waits for a seat, then says how many are open', () => {
    const interest = 'workshop-waitlist:Kinusaiga 2026-10-16'
    expect(judge(interest, facts({ workshops: [workshop({ seatsLeft: 0 })] }))).toEqual({ state: 'wait' })
    expect(due(interest, facts({ workshops: [workshop({ seatsLeft: 1 })] }))).toEqual({
      headline: 'A seat has opened in Kinusaiga',
      lines: ['Friday, October 16 at 7:00 PM. $40 per seat.', '1 seat is open right now. A seat goes to whoever books it first.'],
      path: '/workshops?w=clsschi_kinusaiga',
      linkLabel: 'See details and book',
    })
    expect(due(interest, facts({ workshops: [workshop({ seatsLeft: 3 })] })).lines[1]).toContain('3 seats are open')
  })

  it('a waiting-list sign-up is over once the workshop has been', () => {
    expect(judge('workshop-waitlist:Kinusaiga 2026-10-02', facts())).toEqual({ state: 'over' })
    expect(judge('workshop-soon:Kinusaiga 2026-10-02', facts())).toEqual({ state: 'over' })
  })

  it('waits when the workshop is not listed at all', () => {
    expect(judge('workshop-waitlist:Kinusaiga 2026-10-16', facts({ workshops: [] }))).toEqual({ state: 'wait' })
  })
})

describe('kits', () => {
  it('wait until kits can be ordered', () => {
    expect(judge('kits', facts())).toEqual({ state: 'wait' })
    expect(judge('kit-theme:sterling', facts())).toEqual({ state: 'wait' })
  })

  it('are due when they can', () => {
    expect(due('kits', facts({ kitsOpen: true })).path).toBe('/kits')
    expect(due('kit-theme:sterling', facts({ kitsOpen: true })).path).toBe('/kits')
  })
})

describe('anything else', () => {
  it('is left for a person, open or closed', () => {
    expect(judge('corporate: call me about a team day', facts())).toEqual({ state: 'unknown' })
    expect(judge('corporate: call me about a team day', facts({ bookingOpen: false }))).toEqual({ state: 'unknown' })
  })
})
