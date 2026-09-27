import { describe, it, expect } from 'vitest'
import { partyRefundLine, workshopRefundLine } from '@lib/refund-lines'
import { formatDay, formatDayAndSpan, formatTimeSpan, studioClock } from '@lib/studio-time'

// 2:00 PM Central on Saturday 17 Oct 2026
const PARTY = '2026-10-17T19:00:00.000Z'

describe('partyRefundLine', () => {
  it('names the last day for a cash refund when the party is 14 or more days away', () => {
    const now = new Date('2026-09-27T17:00:00.000Z') // 20 days before
    expect(partyRefundLine(PARTY, now)).toBe('Full refund until Oct 3. After that, studio credit.')
  })

  it('says credit only, before they pay, when the party is inside 14 days', () => {
    const now = new Date('2026-10-08T17:00:00.000Z') // 9 days before
    expect(partyRefundLine(PARTY, now)).toBe(
      'This date is less than 14 days away, so the $300 is refundable as studio credit, not cash. Free reschedule with 48 hours’ notice.',
    )
  })

  it('changes at the boundary', () => {
    const justBefore = new Date(new Date(PARTY).getTime() - 14 * 86_400_000 - 60_000)
    const justAfter = new Date(new Date(PARTY).getTime() - 14 * 86_400_000 + 60_000)
    expect(partyRefundLine(PARTY, justBefore)).toMatch(/^Full refund until Oct 3\./)
    expect(partyRefundLine(PARTY, justAfter)).toMatch(/^This date is less than 14 days away/)
  })
})

describe('workshopRefundLine', () => {
  it('states the 48-hour window', () => {
    expect(workshopRefundLine()).toBe('Full refund up to 48 hours before. After that, studio credit or a free seat transfer.')
  })
})

describe('studio time', () => {
  // 7–9 PM Central on Friday 16 Oct 2026 (already the 17th in UTC)
  const START = '2026-10-17T00:00:00.000Z'
  const END = '2026-10-17T02:00:00.000Z'

  it('shows the studio day and clock, whatever the visitor\'s own timezone', () => {
    expect(formatDay(START)).toBe('Fri, Oct 16')
    expect(studioClock(START)).toBe('19:00')
  })

  it('writes a time span the way the rest of the site does', () => {
    expect(formatTimeSpan(START, END)).toBe('7–9 PM')
    expect(formatDayAndSpan(START, END)).toBe('Fri, Oct 16 · 7–9 PM')
    expect(formatTimeSpan('2026-10-17T14:00:00.000Z', '2026-10-17T17:30:00.000Z')).toBe('9:00 AM–12:30 PM')
  })
})
