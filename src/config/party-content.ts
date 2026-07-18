/**
 * Customer-facing party copy + Kaden-gated content.
 *
 * RULE: nothing fabricated ships. Fields marked `TODO(Kaden)` render ONLY when
 * filled in — empty string means the UI hides that element entirely. The full
 * list of gated items lives in docs/NEEDS-FROM-KADEN.md.
 */

export interface FaqEntry {
  q: string
  /** Empty string = not answered yet — entry is NOT rendered (and NOT in JSON-LD). */
  a: string
}

import { partyConfig } from './party.config'
import { policyWindows } from './policy-content'

/** "$300" — every mention of the studio fee derives from partyConfig.basePriceCents. */
const FEE = `$${partyConfig.basePriceCents / 100}`

/** Policy windows (HOM-78) — all cancellation copy derives from these. */
const REFUND_DAYS = policyWindows.partyFullRefundDays
const RESCHED_HOURS = policyWindows.partyRescheduleNoticeHours
const LOCK_DAYS = policyWindows.partyHeadcountLockDays

export const partyContent = {
  hero: {
    eyebrow: 'Private Parties',
    headline: 'Throw a party they’ll actually remember',
    occasions: 'Birthdays · Girls’ nights · Showers · Team nights · Just because',
    subline:
      'The whole studio, just your people. Pick a craft, pick a date, and come make something together.',
    valueTrio: [
      'The whole studio is yours',
      `${partyConfig.durationMinutes} minutes of making`,
      `${partyConfig.minGuests}–${partyConfig.maxGuests} guests`,
    ],
    /** AI-generated placeholder (Jul 2026) — swap for a real photo of the studio table before launch. */
    heroImage: '/images/party-hero.jpg' as string,
    heroImageAlt: 'Round oak studio table set for a craft party with tote bags, patches, and ribbon',
  },

  /** How the studio fee is framed everywhere: value first, fee second. */
  deposit: {
    holdLine: `${FEE} holds your date — that’s all that’s due today.`,
    perPersonExample: { guests: 12 }, // "~$17/person for the room" is computed from this
    noShowLine: `Crafts are paid at the studio for your final guest count, which you confirm a week before the party (${partyConfig.minGuests}-craft minimum) — today’s number is just an estimate.`,
  },

  trust: {
    securedBy: 'Payments secured by Square',
    nothingElseDue: 'Nothing else is due today. Crafts are paid at the studio, based on your final guest count.',
    /**
     * Point-of-sale summary of the reschedule/cancellation terms. Derived from
     * policyWindows (HOM-78) — the /policies page is the source of truth; keep
     * this line and the FAQ answer consistent with it. Empty string hides the line.
     */
    reschedulePolicy:
      `Free reschedule with ${RESCHED_HOURS} hours’ notice. Cancel ${REFUND_DAYS}+ days out for a full refund — closer in, your fee becomes studio credit that never expires.` as string,
  },

  /** Business number (Quo, set up Jul 2026). Empty = every "text us" element is hidden. */
  textNumber: '(256) 464-1710' as string,

  /**
   * FAQ — doubles as the AEO/SEO surface (FAQPage JSON-LD is emitted for
   * answered entries). Answers below are derived from real config/facts only.
   * TODO(Kaden): fill the empty answers — they stay hidden until you do.
   */
  faq: [
    {
      q: 'How much does a party cost?',
      a: `A flat ${FEE} studio fee reserves the entire studio for your group — that’s all you pay when you book. Each guest’s craft is paid at the studio on the day, priced per person by the craft you choose (most are $15–$40).`,
    },
    {
      q: 'What if some guests can’t make it?',
      a: `Your booking-day guest count is just an estimate. We confirm your final headcount ${LOCK_DAYS} days before the party — that’s the count you pay crafts for at the studio (${partyConfig.minGuests}-craft minimum). Extra friends can usually join day-of if supplies allow, but the count can’t go down inside the final week — that’s when we prep your stations and materials.`,
    },
    {
      q: 'How long is a party and how many people can I bring?',
      a: `Parties are ${partyConfig.durationMinutes} minutes in the studio with ${partyConfig.minGuests} to ${partyConfig.maxGuests} guests. The whole space is yours for the entire time.`,
    },
    {
      q: 'Is there a minimum party size?',
      a: `Yes — parties are for groups of ${partyConfig.minGuests} or more, with a ${partyConfig.minGuests}-craft minimum settled at the studio. Whatever headcount you confirm the week before (minimum ${partyConfig.minGuests}) is what you’re charged for.`,
    },
    {
      q: 'Who are parties for?',
      a: 'Everyone. Birthdays at any age, girls’ nights, showers, team nights — if it’s worth celebrating, it’s worth crafting. Recommended for ages 8 and up.',
    },
    {
      q: 'Does everyone make the same craft?',
      a: 'Yes — you pick one craft for your party when you book, and every guest gets to make it. Browse the crafts above to find yours.',
    },
    {
      q: 'What about personalized crafts?',
      a: 'Some crafts are made to order for your group (we’ll mark them clearly when you book). After booking we’ll email you to collect your final headcount and personalization details. Because they’re custom-made, personalized items can’t be changed or refunded once made.',
    },
    {
      q: 'Can I bring food, drinks, or a cake?',
      a: 'A dessert or sweet treat and water — that’s the menu! Treat time is optional and runs about 20–30 minutes (plenty of guests just keep crafting right through it), so keep it simple. Please bring your own plates, napkins, and utensils — we don’t provide paper goods.',
    },
    {
      q: 'Can we bring wine or other alcohol?',
      a: 'No outside alcohol, please — Alabama law doesn’t allow it in our studio. We’re pursuing a beer & wine license so guests can enjoy a drink here once it’s issued.',
    },
    {
      q: 'Can you do a character theme (Bluey, princesses, superheroes)?',
      a: 'We can’t use trademarked characters in our crafts or decor — those belong to their studios. What we can do: match your party’s colors and vibe, and you’re welcome to bring your own character decorations for the tables.',
    },
    {
      q: 'Can I decorate the studio for my party?',
      a: 'Yes — minimal decorations are welcome. You’ll have 30 minutes before your start time to set up while we reset the studio from the previous party. Just plan to take your decorations down afterward and leave the space the way you found it.',
    },
    {
      q: 'What happens if I need to cancel or reschedule?',
      a: `Cancel ${REFUND_DAYS} or more days before your party and the studio fee is fully refunded. Inside ${REFUND_DAYS} days it converts to studio credit that never expires. Rescheduling is free with ${RESCHED_HOURS} hours’ notice — just know refund eligibility counts from your original date, so rescheduling doesn’t restart the clock. The full details live on our policies page.`,
    },
    {
      q: 'Do adults or non-guests have to pay?',
      a: 'Everyone who makes a craft pays the per-person price — adults, friends, siblings, anyone crafting. Crafts aren’t shareable. Just count crafters in your confirmed headcount: someone who only comes to watch and cheer doesn’t count and costs nothing.',
    },
  ] satisfies FaqEntry[],

  confirmation: {
    nextStepsEmail: [
      'Check your email — your confirmation is on its way.',
      'Invite your people — share the details below.',
      "Show up and make something. We'll have everything ready.",
    ],
    nextStepsNoEmail: [
      'Invite your people — share the details below.',
      "Show up and make something. We'll have everything ready.",
    ],
  },
} as const
