/**
 * Booking & cancellation policy — the canonical customer-facing terms.
 *
 * Decided 2026-07-18 (HOM-78, all questions answered by Kaden). This module is
 * THE single source of truth: the /policies page renders it, checkout terms
 * checkboxes link to it, and party-content FAQ answers must stay consistent
 * with it. Change policy here first, then sync the FAQ summaries.
 */

import { partyConfig } from './party.config'

/** Path + anchors for deep links from checkout and FAQs. */
export const POLICY_PATH = '/policies'
export const POLICY_ANCHORS = {
  parties: 'parties',
  workshops: 'workshops',
  closures: 'closures-and-refunds',
} as const

/** Every window in one place — copy below derives from these. */
export const policyWindows = {
  /** Cancel this many days (or more) before a party → full refund. */
  partyFullRefundDays: 14,
  /** Minimum notice to reschedule a party, in hours. */
  partyRescheduleNoticeHours: 48,
  /** We confirm the expected headcount this many days before the party — for
   *  prep only; billing is on actual attendance with the minGuests floor. */
  partyHeadcountLockDays: 7,
  /** Workshop cancellations this many hours (or more) ahead → full refund. */
  workshopRefundHours: 48,
  /** Refund arrival window shown to customers. */
  refundBusinessDays: '5–10',
} as const

export interface PolicySection {
  id: string
  title: string
  intro?: string
  rules: { heading: string; body: string }[]
}

const W = policyWindows

export const policySections: PolicySection[] = [
  {
    id: POLICY_ANCHORS.parties,
    title: 'Private Parties',
    intro:
      `Your ${'$' + partyConfig.basePriceCents / 100} studio fee reserves the entire studio for your group. ` +
      'Parties take real prep on our end — these windows exist so another group can book a date you release.',
    rules: [
      {
        heading: `Cancel ${W.partyFullRefundDays}+ days before your party`,
        body: 'Full refund of the studio fee to your original payment method. No questions, no fee.',
      },
      {
        heading: `Cancel inside ${W.partyFullRefundDays} days`,
        body:
          'Your studio fee converts to studio credit for the full amount. Credit never expires and can be used ' +
          'for any booking or purchase — we just can’t return it as cash once we’re inside the window.',
      },
      {
        heading: 'Rescheduling',
        body:
          `Reschedule free to any open date with at least ${W.partyRescheduleNoticeHours} hours’ notice. ` +
          `One thing to know: refund eligibility always counts from your original party date and doesn’t reset when you reschedule. ` +
          `If you reschedule from inside the ${W.partyFullRefundDays}-day window, the studio fee becomes studio credit rather than refundable.`,
      },
      {
        heading: 'Guest count and craft charges',
        body:
          `We’ll confirm your expected headcount about ${W.partyHeadcountLockDays} days before the party so we can prep stations and materials — ` +
          `but crafts are charged at the studio for whoever actually comes, with a ${partyConfig.minGuests}-craft minimum. ` +
          'Plan for 15 and 13 make it? You pay for 13. Beyond the minimum, a friend who can’t make it never costs you anything, ' +
          'and day-of additions are welcome when supplies allow.',
      },
      {
        heading: 'No-shows',
        body:
          'If your party doesn’t show up at all, the studio fee is forfeited — no refund or credit. We prepped the studio and held the date for you.',
      },
      {
        heading: 'Personalized crafts',
        body:
          'Made-to-order items (clearly marked when you book) can’t be changed or refunded once they’re made, regardless of the windows above.',
      },
    ],
  },
  {
    id: POLICY_ANCHORS.workshops,
    title: 'Workshops',
    rules: [
      {
        heading: `Cancel ${W.workshopRefundHours}+ hours before the workshop`,
        body: 'Full refund to your original payment method.',
      },
      {
        heading: `Inside ${W.workshopRefundHours} hours`,
        body:
          'Your choice of studio credit for the full amount (never expires) or a free seat transfer — give your seat ' +
          'to someone else, or move yourself to another date of the same workshop.',
      },
      {
        heading: 'If we cancel a workshop',
        body:
          'Occasionally a workshop doesn’t reach enough sign-ups to run. If we cancel, you choose: an automatic full refund or a free seat in another session.',
      },
    ],
  },
  {
    id: POLICY_ANCHORS.closures,
    title: 'Studio Closures & Refunds',
    rules: [
      {
        heading: 'Weather and emergency closures',
        body:
          'If we have to close the studio (severe weather, emergencies), every affected booking gets the choice of a free reschedule or a full refund — always.',
      },
      {
        heading: 'How refunds arrive',
        body:
          `Refunds go back to your original payment method and typically arrive in ${W.refundBusinessDays} business days, depending on your bank.`,
      },
      {
        heading: 'Questions?',
        body:
          'Text or call us and we’ll sort it out — the fastest way to reach us is the number in the footer below.',
      },
    ],
  },
]

/** One-line checkout summaries — shown next to the terms checkbox. */
export const checkoutPolicySummary = {
  party:
    `Free reschedule with ${W.partyRescheduleNoticeHours}h notice · full refund ${W.partyFullRefundDays}+ days out · ` +
    `studio credit inside ${W.partyFullRefundDays} days · crafts billed for who comes (${partyConfig.minGuests} minimum)`,
  workshop:
    `Full refund ${W.workshopRefundHours}+ hours out · studio credit or free seat transfer inside ${W.workshopRefundHours} hours`,
} as const
