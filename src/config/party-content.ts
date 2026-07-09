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

export const partyContent = {
  hero: {
    eyebrow: 'Private Parties',
    headline: 'Throw a party they’ll actually remember',
    occasions: 'Birthdays · Girls’ nights · Showers · Team nights · Just because',
    subline:
      'The whole studio, just your people. Pick a craft, pick a date, and come make something together.',
    valueTrio: ['The whole studio is yours', '90 minutes of making', 'Up to 30 guests'],
    /** TODO(Kaden): hero lifestyle photo (group crafting at the table). Path under /public/images. Empty = text-only hero. */
    heroImage: '' as string,
    heroImageAlt: 'Friends crafting together around the studio table',
  },

  /** How the $200 is framed everywhere: value first, fee second. */
  deposit: {
    holdLine: '$200 holds your date — that’s all that’s due today.',
    perPersonExample: { guests: 12 }, // "~$17/person for the room" is computed from this
    noShowLine: 'Crafts are paid at the studio for whoever actually comes — a friend who can’t make it never costs you a thing.',
  },

  trust: {
    securedBy: 'Payments secured by Square',
    nothingElseDue: 'Nothing else is due today. Crafts are paid at the studio, based on who comes.',
    /** Approved by Kaden 2026-07-09 — tweak wording anytime; empty string hides the line. */
    reschedulePolicy: 'Free reschedule up to 7 days before your party.' as string,
  },

  /** TODO(Kaden): a real, SMS-able number. Empty = every "text us" element is hidden. */
  textNumber: '' as string,

  /**
   * FAQ — doubles as the AEO/SEO surface (FAQPage JSON-LD is emitted for
   * answered entries). Answers below are derived from real config/facts only.
   * TODO(Kaden): fill the empty answers — they stay hidden until you do.
   */
  faq: [
    {
      q: 'How much does a party cost?',
      a: 'A flat $200 studio fee reserves the entire studio for your group — that’s all you pay when you book. Each guest’s craft is paid at the studio on the day, priced per person by the craft you choose (most are $15–$40).',
    },
    {
      q: 'What if some guests can’t make it?',
      a: 'You only pay for crafts for the people who actually come. Your guest count at booking is just an estimate for planning — no-shows never cost you anything.',
    },
    {
      q: 'How long is a party and how many people can I bring?',
      a: 'Parties are 90 minutes in the studio with up to 30 guests. The whole space is yours for the entire time.',
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
      a: '', // TODO(Kaden): your food & drink policy
    },
    {
      q: 'Can I decorate the studio for my party?',
      a: '', // TODO(Kaden): your decoration policy
    },
    {
      q: 'What happens if I need to cancel or reschedule?',
      a: '', // TODO(Kaden): your cancellation/reschedule policy
    },
  ] satisfies FaqEntry[],

  confirmation: {
    nextSteps: [
      'Check your email — your confirmation is on its way.',
      'Invite your people — share the details below.',
      'Show up and make something. We’ll have everything ready.',
    ],
  },
} as const
