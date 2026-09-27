import { describe, it, expect } from 'vitest'
import { partySummary } from '@lib/party-summary'
import { partyConfig } from '@config/party.config'

// 2:00 PM Central on Saturday 17 Oct 2026
const START = '2026-10-17T19:00:00.000Z'
const keychains = { name: 'Bubble Letter Keychains', perHeadCents: 2000 }

describe('partySummary', () => {
  it('matches the approved layout for a plain party', () => {
    expect(partySummary({ startIso: START, craft: keychains, guests: 10 })).toEqual({
      today: [{ label: 'Studio fee, holds Sat, Oct 17 at 2:00 PM', amount: '$300' }],
      dueTodayCents: 30000,
      atStudio: [
        {
          label: 'Bubble Letter Keychains, about 10 guests × $20',
          amount: 'about $200',
          note: 'Only for guests who come. Minimum 10 crafts.',
        },
      ],
      estimatedTotal: 'about $500',
      payLabel: 'Pay $300 and reserve Oct 17',
    })
  })

  it('takes the fee and the minimum from the settings, not from this file', () => {
    const s = partySummary({ startIso: START, craft: keychains, guests: 10 })
    expect(s.dueTodayCents).toBe(partyConfig.basePriceCents)
    expect(s.atStudio[0].note).toContain(String(partyConfig.minGuests))
  })

  it('the estimated total is the studio fee plus guests × per-person price, and follows the guest count', () => {
    expect(partySummary({ startIso: START, craft: keychains, guests: 15 }).estimatedTotal).toBe('about $600')
    expect(partySummary({ startIso: START, craft: keychains, guests: 25 }).estimatedTotal).toBe('about $800')
  })

  it('never changes what is charged today when the guest count changes', () => {
    for (const guests of [10, 17, 30]) {
      expect(partySummary({ startIso: START, craft: keychains, guests }).dueTodayCents).toBe(30000)
    }
  })

  it('keeps cents when a price has them', () => {
    const s = partySummary({ startIso: START, craft: { name: 'Junk Journaling', perHeadCents: 1550 }, guests: 11 })
    expect(s.atStudio[0].label).toBe('Junk Journaling, about 11 guests × $15.50')
    expect(s.atStudio[0].amount).toBe('about $170.50')
    expect(s.estimatedTotal).toBe('about $470.50')
  })

  it('shows a range for a craft priced by the piece', () => {
    const s = partySummary({ startIso: START, craft: { name: 'Patch & Personalize', perHeadCents: 2500, perHeadMaxCents: 4000 }, guests: 10 })
    expect(s.atStudio[0].label).toBe('Patch & Personalize, about 10 guests × $25–$40')
    expect(s.atStudio[0].amount).toBe('about $250–$400')
    expect(s.estimatedTotal).toBe('about $550–$700')
  })

  it('puts a themed table under "pay today" and into the button', () => {
    const s = partySummary({ startIso: START, craft: keychains, guests: 10, themedTable: { name: 'Gilded', serves: 10, priceCents: 7500 } })
    expect(s.today).toEqual([
      { label: 'Studio fee, holds Sat, Oct 17 at 2:00 PM', amount: '$300' },
      { label: 'Themed table, Gilded (serves 10)', amount: '$75' },
    ])
    expect(s.dueTodayCents).toBe(37500)
    expect(s.estimatedTotal).toBe('about $575')
    expect(s.payLabel).toBe('Pay $375 and reserve Oct 17')
  })

  it('says less, not something wrong, before a time or craft is chosen', () => {
    const s = partySummary({ guests: 10 })
    expect(s.today[0].label).toBe('Studio fee, holds your date')
    expect(s.atStudio).toEqual([])
    expect(s.estimatedTotal).toBe('')
    expect(s.payLabel).toBe('Pay $300 and reserve your date')
  })
})
