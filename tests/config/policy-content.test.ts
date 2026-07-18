import { describe, it, expect } from 'vitest'
import {
  policySections,
  policyWindows,
  checkoutPolicySummary,
  POLICY_PATH,
  POLICY_ANCHORS,
} from '@config/policy-content'
import { partyContent } from '@config/party-content'

describe('policy content (HOM-78 canonical spec)', () => {
  it('encodes the decided windows', () => {
    expect(policyWindows.partyFullRefundDays).toBe(14)
    expect(policyWindows.partyRescheduleNoticeHours).toBe(48)
    expect(policyWindows.partyHeadcountLockDays).toBe(7)
    expect(policyWindows.workshopRefundHours).toBe(48)
  })

  it('has all three sections with unique anchor ids matching POLICY_ANCHORS', () => {
    const ids = policySections.map((s) => s.id)
    expect(ids).toEqual([...new Set(ids)])
    expect(ids).toContain(POLICY_ANCHORS.parties)
    expect(ids).toContain(POLICY_ANCHORS.workshops)
    expect(ids).toContain(POLICY_ANCHORS.closures)
  })

  it('every rule has a heading and body', () => {
    for (const section of policySections) {
      expect(section.rules.length).toBeGreaterThan(0)
      for (const rule of section.rules) {
        expect(rule.heading.trim()).toBeTruthy()
        expect(rule.body.trim()).toBeTruthy()
      }
    }
  })

  it('party section covers refund, credit, reschedule anchoring, attendance billing, and no-show', () => {
    const parties = policySections.find((s) => s.id === POLICY_ANCHORS.parties)!
    const text = parties.rules.map((r) => `${r.heading} ${r.body}`).join(' ')
    expect(text).toContain('Full refund')
    expect(text).toContain('studio credit')
    expect(text).toMatch(/original party date/i)
    // Billing is on ACTUAL attendance with the 10-craft floor (Kaden 2026-07-18):
    // planned 15, 13 come → pay 13; 8 come → pay 10. The week-before check-in
    // is for prep only — never a binding "locked count."
    expect(text).toMatch(/whoever actually comes/i)
    expect(text).toMatch(/10-craft minimum/)
    expect(text).not.toMatch(/locked count|can’t go down/i)
    // Forfeiture is for the WHOLE party not showing, not individual no-shows.
    expect(text).toMatch(/doesn’t show up at all.*forfeited/i)
  })

  it('workshop section covers our-cancellation with customer choice', () => {
    const workshops = policySections.find((s) => s.id === POLICY_ANCHORS.workshops)!
    const text = workshops.rules.map((r) => `${r.heading} ${r.body}`).join(' ')
    expect(text).toMatch(/If we cancel/i)
    expect(text).toMatch(/full refund/i)
  })

  it('checkout summaries quote the same windows as policyWindows', () => {
    expect(checkoutPolicySummary.party).toContain(`${policyWindows.partyFullRefundDays}`)
    expect(checkoutPolicySummary.party).toContain(`${policyWindows.partyRescheduleNoticeHours}h`)
    expect(checkoutPolicySummary.party).toMatch(/who comes/i)
    expect(checkoutPolicySummary.workshop).toContain(`${policyWindows.workshopRefundHours}`)
  })

  it('POLICY_PATH points at the policies page', () => {
    expect(POLICY_PATH).toBe('/policies')
  })

  it('party FAQ + trust copy stays consistent with the decided windows', () => {
    // The point-of-sale summary must quote the real windows, not stale ones.
    expect(partyContent.trust.reschedulePolicy).toContain(`${policyWindows.partyRescheduleNoticeHours} hours`)
    expect(partyContent.trust.reschedulePolicy).toContain(`${policyWindows.partyFullRefundDays}+ days`)
    // The old (pre-HOM-78) refund terms must not resurface anywhere in party
    // copy. ("Pay for who comes" is CORRECT — attendance billing was confirmed
    // 2026-07-18 after a misread of the no-show answer briefly replaced it.)
    const allCopy = JSON.stringify(partyContent)
    expect(allCopy).not.toMatch(/isn’t refundable/)
    expect(allCopy).toMatch(/who actually come/i)
    expect(allCopy).not.toMatch(/locked count|final headcount \d+ days|count can’t go down/i)
    // Cancel/reschedule FAQ reflects full-refund-then-credit, anchored to the original date.
    const cancelFaq = partyContent.faq.find((f) => f.q.includes('cancel or reschedule'))!
    expect(cancelFaq.a).toMatch(/fully refunded/i)
    expect(cancelFaq.a).toMatch(/studio credit/i)
    expect(cancelFaq.a).toMatch(/original date/i)
  })

  it('party FAQ covers the no-outside-alcohol and no-branded-characters questions', () => {
    const alcohol = partyContent.faq.find((f) => /alcohol/i.test(f.q))
    expect(alcohol?.a).toMatch(/No outside alcohol/i)
    const characters = partyContent.faq.find((f) => /character/i.test(f.q))
    expect(characters?.a).toMatch(/trademarked/i)
  })
})
