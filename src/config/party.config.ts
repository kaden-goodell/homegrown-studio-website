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
  guestQuickPicks: [10, 15, 20, 25],
  /** Party length shown to the customer. */
  durationMinutes: 90,
  /** How early a host may arrive to set up, in minutes (Kaden, 27 Sep 2026). */
  hostArrivalMinutesEarly: 30,
  /**
   * How far ahead a party can be booked, in days from today (studio-local).
   * Stays at 45 while the studio is new, so plans can change without
   * cancelling on anyone (Kaden, 27 Sep 2026). Enforced in partyStartsForDate,
   * so the calendar, the date list, the panel and the server all agree.
   */
  bookingWindowDays: 45,
  /**
   * The least notice a party needs, in days: a party on the 20th can be booked
   * up to and including the 15th. Gives time to order supplies (Kaden, 27 Sep
   * 2026). Enforced in the same place as the window.
   */
  minLeadDays: 5,
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
 * Weekdays not listed have no parties.
 * Weekend shape (Kaden, 8 Oct 2026):
 *   Sat: Craft Café 9–12:30 · party 1:30 · workshop 4–6 · workshop 7–9
 *   Sun: party 1:00 · party 3:30 · workshop 6–8
 * so Saturday offers ONE party start (1:30; a 90-min party + the hour's
 * cleanup wraps by 4:00 for the first class) and Sunday two (3:30 steps aside
 * automatically if a class is ever scheduled there).
 */
export const partyDays: Record<number, { firstStart: string; lastWrap: string }> = {
  0: { firstStart: '13:00', lastWrap: '18:00' }, // Sunday: 1:00, 3:30
  6: { firstStart: '13:30', lastWrap: '16:00' }, // Saturday: 1:30 only
}
