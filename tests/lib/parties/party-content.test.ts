import { describe, it, expect } from 'vitest'
import {
  CONFIG_COPY_FACTS,
  defaultPackageOf,
  lowestPackageCents,
  partyContent,
  partyContentFor,
  partyCopyFacts,
} from '@config/party-content'
import { partyCheckoutPolicySummary, policySections, policySectionsFor, checkoutPolicySummary } from '@config/policy-content'
import { configPartySettings } from '@lib/parties/party-times'
import { partyRefundLine } from '@lib/refund-lines'
import type { PartyPackage, PartySettings } from '@lib/parties/types'

const saved = (change: (s: PartySettings) => void) => {
  const s = configPartySettings()
  change(s)
  return s
}
const pkg = (p: Partial<PartyPackage> & Pick<PartyPackage, 'id' | 'priceCents'>): PartyPackage => ({
  name: p.id, minutes: 90, minGuests: 10, maxGuests: 30, defaultGuests: 10, quickPicks: [10], who: 'everyone', archived: false, ...p,
})
const faq = (c: ReturnType<typeof partyContentFor>, q: RegExp) => c.faq.find((f) => q.test(f.q))!.a

describe('party copy follows the party settings', () => {
  it('with the config as the settings, is exactly today’s copy', () => {
    expect(partyCopyFacts(configPartySettings())).toEqual(CONFIG_COPY_FACTS)
    expect(partyContentFor(configPartySettings())).toEqual(partyContent)
    expect(partyContentFor()).toEqual(partyContent)
    expect(policySectionsFor()).toEqual(policySections)
    expect(partyCheckoutPolicySummary()).toBe(checkoutPolicySummary.party)
  })

  it('price change reaches /book copy and the FAQ answer: a saved $350 package', () => {
    const c = partyContentFor(saved((s) => { s.packages[0].priceCents = 35000 }))
    expect(c.deposit.holdLine).toBe('$350 holds your date — that’s all that’s due today.')
    expect(faq(c, /how much/i)).toContain('A flat $350 studio fee reserves the entire studio')
    expect(faq(c, /how much/i)).not.toContain('$300')
  })

  it('price change reaches the refund line', () => {
    const now = new Date('2026-10-08T17:00:00.000Z')
    expect(partyRefundLine('2026-10-17T19:00:00.000Z', now, 35000)).toBe(
      'This date is less than 14 days away, so the $350 is refundable as studio credit, not cash. Free reschedule with 48 hours’ notice.',
    )
  })

  it('a 120-minute package changes the length copy', () => {
    const c = partyContentFor(saved((s) => { s.packages[0].minutes = 120 }))
    expect(c.hero.valueTrio).toContain('120 minutes of making')
    expect(faq(c, /how long/i)).toBe('Parties are 120 minutes in the studio with 10 to 30 guests. The whole space is yours for the entire time.')
  })

  it('guest numbers come from the package', () => {
    const c = partyContentFor(saved((s) => { Object.assign(s.packages[0], { minGuests: 12, maxGuests: 24 }) }))
    expect(c.hero.valueTrio).toContain('12–24 guests')
    expect(faq(c, /minimum party size/i)).toContain('groups of 12 or more, with a 12-craft minimum')
    expect(c.deposit.noShowLine).toContain('(12-craft minimum)')
  })

  it('the policy page and the checkout line quote the saved fee and minimum', () => {
    const party = policySectionsFor({ feeCents: 35000, minGuests: 12 })[0]
    expect(party.intro).toMatch(/^Your \$350 studio fee reserves the entire studio/)
    expect(party.rules.find((r) => r.heading === 'Guest count and craft charges')!.body).toContain('with a 12-craft minimum')
    expect(partyCheckoutPolicySummary(12)).toContain('crafts billed for who comes (12 minimum)')
  })

  it('the copy is the default package’s: the first everyone can book, never a link, owner-only or archived one', () => {
    const s = saved((x) => {
      x.packages = [
        pkg({ id: 'pkg_old', priceCents: 20000, archived: true }),
        pkg({ id: 'pkg_test', priceCents: 100, who: 'link' }),
        pkg({ id: 'pkg_staff', priceCents: 5000, who: 'admin' }),
        pkg({ id: 'pkg_whole', priceCents: 32500, minutes: 105 }),
        pkg({ id: 'pkg_table', priceCents: 15000 }),
      ]
      x.times.bookingWindowDays = 60
    })
    expect(defaultPackageOf(s)?.id).toBe('pkg_whole')
    expect(partyCopyFacts(s)).toMatchObject({ feeCents: 32500, minutes: 105, bookingWindowDays: 60 })
    expect(lowestPackageCents(s)).toBe(15000)
  })

  it('falls back to the config when nothing everyone can book is saved', () => {
    const s = saved((x) => { x.packages = [pkg({ id: 'pkg_test', priceCents: 100, who: 'link' })] })
    expect(partyCopyFacts(s).feeCents).toBe(CONFIG_COPY_FACTS.feeCents)
    expect(lowestPackageCents(s)).toBe(CONFIG_COPY_FACTS.feeCents)
  })
})
