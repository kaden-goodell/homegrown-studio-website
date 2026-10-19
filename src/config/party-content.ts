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

import { formatMoney } from '@lib/money'
import type { PartyPackage } from '@lib/parties/types'
import { partyConfig } from './party.config'
import { policyWindows } from './policy-content'

/**
 * The numbers party copy is written from: the fee, length and guest range of
 * the package everyone books by default, and how far ahead dates open. Until
 * an owner saves Parties setup they are the config's; after, the saved ones
 * (the page loads the settings once and passes them in).
 */
export interface PartyCopyFacts {
  feeCents: number
  minutes: number
  minGuests: number
  maxGuests: number
  bookingWindowDays: number
}

export const CONFIG_COPY_FACTS: PartyCopyFacts = {
  feeCents: partyConfig.basePriceCents,
  minutes: partyConfig.durationMinutes,
  minGuests: partyConfig.minGuests,
  maxGuests: partyConfig.maxGuests,
  bookingWindowDays: partyConfig.bookingWindowDays,
}

/** What /book knows of Parties setup (PublicPartyFacts, or the settings themselves). */
export interface PartyFactsLike {
  packages: PartyPackage[]
  times: { bookingWindowDays: number }
}

/** The package booked when none is named: the first open to everyone (as the server picks it). */
export function defaultPackageOf(facts: { packages: PartyPackage[] }): PartyPackage | undefined {
  return facts.packages.find((p) => p.who === 'everyone' && !p.archived)
}

/** The copy numbers from the settings: the default package's, else the config's. */
export function partyCopyFacts(facts?: PartyFactsLike | PartyCopyFacts | null): PartyCopyFacts {
  if (!facts) return CONFIG_COPY_FACTS
  if ('feeCents' in facts) return facts
  const pkg = defaultPackageOf(facts)
  return {
    ...(pkg
      ? { feeCents: pkg.priceCents, minutes: pkg.minutes, minGuests: pkg.minGuests, maxGuests: pkg.maxGuests }
      : CONFIG_COPY_FACTS),
    bookingWindowDays: facts.times.bookingWindowDays,
  }
}

/** The cheapest package everyone can book (its own name and price), else the config's. */
export function cheapestPackageOf(facts?: PartyFactsLike | null): { name: string; priceCents: number } {
  const open = (facts?.packages ?? []).filter((p) => p.who === 'everyone' && !p.archived)
  const p = open.reduce<PartyPackage | undefined>((best, x) => (!best || x.priceCents < best.priceCents ? x : best), undefined)
  return p ? { name: p.name, priceCents: p.priceCents } : { name: CONFIG_PACKAGE_NAME, priceCents: CONFIG_COPY_FACTS.feeCents }
}

/** The lowest price a party starts from (packages everyone can book). */
export function lowestPackageCents(facts?: PartyFactsLike | null): number {
  return cheapestPackageOf(facts).priceCents
}

/** The config package's name (party-times.ts configPartySettings). */
const CONFIG_PACKAGE_NAME = 'Whole studio'

/** Policy windows (HOM-78) — all cancellation copy derives from these. */
const REFUND_DAYS = policyWindows.partyFullRefundDays
const RESCHED_HOURS = policyWindows.partyRescheduleNoticeHours
const LOCK_DAYS = policyWindows.partyHeadcountLockDays

/**
 * The party copy for the settings in use. `partyContent` below is the
 * config's; pages that loaded Parties setup call this with what they loaded.
 */
export function partyContentFor(facts?: PartyFactsLike | PartyCopyFacts | null) {
  const f = partyCopyFacts(facts)
  /** "$300" — every mention of the studio fee derives from the package's price. */
  const FEE = formatMoney(f.feeCents)
  return {
    hero: {
      eyebrow: 'Private parties',
      headline: 'Throw a party they’ll actually remember',
      occasions: 'Birthdays · Girls’ nights · Showers · Team nights · Just because',
      subline:
        'A completely private studio — your group is the only group in the room. Pick a craft, pick a date, and come make something together.',
      valueTrio: [
        'Fully private — the studio is yours',
        `${f.minutes} minutes of making`,
        `${f.minGuests}–${f.maxGuests} guests`,
      ],
      /** AI-generated placeholder (Jul 2026) — swap for a real photo of the studio table before launch. */
      heroImage: '/images/party-hero.jpg' as string,
      heroImageAlt: 'Round oak studio table set for a craft party with tote bags, patches, and ribbon',
    },

    /** How the studio fee is framed everywhere: value first, fee second. */
    deposit: {
      /** The private-room differentiator (HOM-161) — leads the value band on /book. */
      positioningLine:
        'The only fully private craft-party studio in Madison — no shared tables, no strangers, no other parties in the room.',
      holdLine: `${FEE} holds your date — that’s all that’s due today.`,
      /** Party size for the worked example on /book: the studio fee split across this many guests. */
      perPersonExample: { guests: 12 },
      noShowLine: `Crafts are paid at the studio for whoever actually comes (${f.minGuests}-craft minimum) — beyond that, a friend who can’t make it never costs you a thing.`,
    },

    trust: {
      securedBy: 'Payments secured by Square',
      nothingElseDue: 'Nothing else is due today. Crafts are paid at the studio, based on who comes.',
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
        a: `A flat ${FEE} studio fee reserves the entire studio for your group — that’s all you pay when you book. Each guest’s craft is paid at the studio on the day. Each craft has its own per-person price, shown when you pick one.`,
      },
      {
        q: 'What if some guests can’t make it?',
        a: `You pay for crafts for the people who actually come, with a ${f.minGuests}-craft minimum (parties are for groups of ${f.minGuests} or more). Beyond the minimum, your guest count is just an estimate — no-shows never cost you anything. We’ll check in about ${LOCK_DAYS} days before the party to confirm your expected headcount so we can prep.`,
      },
      {
        q: 'How long is a party and how many people can I bring?',
        a: `Parties are ${f.minutes} minutes in the studio with ${f.minGuests} to ${f.maxGuests} guests. The whole space is yours for the entire time.`,
      },
      {
        q: 'Is there a minimum party size?',
        a: `Yes — parties are for groups of ${f.minGuests} or more, with a ${f.minGuests}-craft minimum settled at the studio. If fewer guests end up making it on the day, the ${f.minGuests}-craft minimum still applies.`,
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
        q: 'Can you do a theme?',
        a: 'Yes. We can match your party’s colors and vibe, whatever the occasion. The one thing we can’t do is put trademarked characters or logos on our crafts or decor, since those belong to their owners. You’re welcome to bring your own themed decorations for the tables.',
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
        a: 'Everyone who makes a craft pays the per-person price — adults, friends, siblings, anyone crafting. Crafts aren’t shareable, and it’s all settled at the studio based on who actually crafts, so someone who just comes to watch and cheer costs nothing.',
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
}

/** The party copy from the config (until an owner saves Parties setup, the same as the saved settings). */
export const partyContent = partyContentFor()
