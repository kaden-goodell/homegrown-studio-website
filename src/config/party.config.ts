/**
 * Party + Open Studio configuration.
 *
 * Party is a bookable APPOINTMENTS_SERVICE ($300 flat studio fee) + a per-head
 * craft cost. Crafts are catalog ITEMS in the "Crafts" category (each with
 * a name, per-head price, description, and optional image), created via
 * `scripts/seed-party.ts` + `scripts/add-party-craft.ts`.
 *
 * Open Studio is a non-bookable catalog item (flow='display', dated windows in
 * the `programDates` custom attribute).
 */
import { PARTY_START_DATE } from './opening'

export const partyConfig = {
  square: {
    /** APPOINTMENTS_SERVICE catalog item for the whole-studio party. */
    catalogItemId: 'ZMSLASCRBGJ7JE3MJVOVJUSA',
    /** Category holding craft ITEMS (name + per-head price + description + image). */
    partyCraftCategoryId: 'YJYZ5FAHKRCFH634JSDJEZVQ',
    /** Marker category — crafts also tagged here are made-to-order & non-refundable. */
    personalizedCategoryId: 'FD7DGZWHHJ76KF7YWAWKDWYS',
    /** Marker category — the (single) craft tagged here shows the "Most popular"
     *  badge. Manage from Square Dashboard or `scripts/set-popular-craft.ts`. */
    popularCategoryId: 'N2ZDEPFKYME52I7OQYSFIDWN',
    /** Marker category — crafts tagged here are bookable for parties but left
     *  off the Craft Café menu. Manage from Square or `scripts/set-party-only.ts`. */
    partyOnlyCategoryId: 'JQ3QDTNFUZQH3H2DKP3IQTDA',
    /** Marker category — the reverse: Craft Café menu only, never offered for
     *  parties or take-home kits. `scripts/set-party-only.ts --cafe`. */
    cafeOnlyCategoryId: 'OYJ4G6TF6C2HRGWIF2RDEXCQ',
    /** Non-bookable Open Studio display item (flow='display', windows in the
     *  programDates custom attribute). Currently the TEST item created
     *  2026-07-18 for pre-launch flow testing (windows = Jul 23–Aug 2 open
     *  hours) — swap for a real item with Sept windows before grand opening. */
    openStudioItemId: 'AVJKOK4G7EOZUXF5ANIPF7AY',
    /** Default team member the whole-room booking is assigned to (Kaden). */
    defaultTeamMemberId: 'TMeIN-kxF-ZVhTVj',
  },
  /** Flat room fee in cents. THE single source of truth for the studio fee —
   *  the charge, the modal, and all page copy derive from this value. */
  basePriceCents: 30000,
  /** Minimum party size — the picker, copy, and server validation all derive from this. */
  minGuests: 10,
  /** Hard guest cap for any bookable event (studio room capacity). */
  maxGuests: 30,
  /** Default guest estimate — anchors the party at a realistic size, not 1. */
  defaultGuests: 10,
  /** One-tap guest counts offered before the fine-tune stepper. */
  guestQuickPicks: [10, 15, 20, 25, 30],
  /** Party length shown to the customer. */
  durationMinutes: 90,
  /** How early a host may arrive to set up, in minutes (Kaden, 27 Sep 2026). */
  hostArrivalMinutesEarly: 30,
  /**
   * How far ahead a party can be booked, in days from today (studio-local).
   * 90 now that the weekend shape is settled (Kaden, 8 Oct 2026; was 45
   * while plans were still moving). Enforced in partyStartsForDate, so the
   * calendar, the date list, the panel and the server all agree.
   */
  bookingWindowDays: 90,
  /**
   * The least notice a party needs, in days: a party on the 20th can be booked
   * up to and including the 13th. A week out — five business days to order
   * supplies (Kaden, 9 Oct 2026; was 5 days from 27 Sep). Enforced in the same
   * place as the window.
   */
  minLeadDays: 7,
  /** Earliest bookable party date (YYYY-MM-DD, studio-local): the weekend
   *  after the grand opening (see opening.ts). No date before this is offered
   *  OR accepted — enforced in partyStartsForDate, which also backs the book
   *  endpoint's server-side slot re-verify. */
  bookingOpensDate: PARTY_START_DATE,
  /** Cleanup gap required between any two events in the room (parties and classes, either order). */
  cleanupBufferMinutes: 60,
  /** Studio timezone for interpreting slot start times. */
  timezone: 'America/Chicago',
  /**
   * Craft per-head price breaks by guest count. Kept as a single flat tier (no
   * volume discount): crafts are now settled at the Square register, so any group
   * discount is applied there (a saved Square discount), not in the online estimate.
   */
  priceBreakTiers: [
    { fromGuest: 1, discountPct: 0 },
  ],
} as const

/**
 * Party start schedule per weekday (0=Sun … 6=Sat), in studio-local time. Starts
 * step by (durationMinutes + cleanupBufferMinutes) from `firstStart`, while
 * start + party + cleanup ≤ `lastWrap`, so the evening workshop slot stays clear.
 * Weekdays not listed have no parties (Mon–Wed).
 * Weekend shape (Kaden, 8 Oct 2026):
 *   Sat: Craft Café 9–12 · party 1:30 · workshop 4–6 · workshop 7–9
 *   Sun: party 1:00 · party 3:30 · workshop 6–8
 * so Saturday offers ONE party start (1:30; a 90-min party + the hour's
 * cleanup wraps by 4:00 for the first class) and Sunday two (3:30 steps aside
 * automatically if a class is ever scheduled there).
 */
export const partyDays: Record<number, { firstStart: string; lastWrap: string }> = {
  0: { firstStart: '13:00', lastWrap: '18:00' }, // Sunday: 1:00, 3:30
  // Thursday and Friday (Kaden, 9 Oct 2026): one party at 4:00, before the
  // evening class. A class at 6:00 leaves no time to clean up, so that day's
  // 4:00 steps aside on its own.
  4: { firstStart: '16:00', lastWrap: '18:30' }, // Thursday: 4:00
  5: { firstStart: '16:00', lastWrap: '18:30' }, // Friday: 4:00
  6: { firstStart: '13:30', lastWrap: '16:00' }, // Saturday: 1:30 only
}

/**
 * One-off party days that replace the weekday schedule for that date, and are
 * offered even before `bookingOpensDate` (lead time, window and closures still
 * apply). Same shape as partyDays.
 *   2026-10-24: Kaden opened that Saturday to parties all day (9 Oct 2026):
 *   9:00 · 11:30 · 2:00 · 4:30 · 7:00, each 90 min + the hour's cleanup
 *   (the last party ends 8:30; cleanup runs past the 9pm close).
 */
export const partyDateOverrides: Record<string, { firstStart: string; lastWrap: string }> = {
  // Thursday/Friday parties start Oct 22 (Kaden, 9 Oct 2026), ahead of the
  // regular Nov 7 start: Thu Oct 22 gets two (4:00 and 6:30), the rest the
  // usual 4:00 until the weekly schedule takes over on Nov 7.
  '2026-10-22': { firstStart: '16:00', lastWrap: '21:00' },
  '2026-10-23': { firstStart: '16:00', lastWrap: '18:30' },
  '2026-10-29': { firstStart: '16:00', lastWrap: '18:30' },
  '2026-11-05': { firstStart: '16:00', lastWrap: '18:30' },
  '2026-11-06': { firstStart: '16:00', lastWrap: '18:30' },
  '2026-10-24': { firstStart: '09:00', lastWrap: '21:30' },
}
