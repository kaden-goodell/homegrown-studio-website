/**
 * Party + Open Studio configuration.
 *
 * Party is a bookable APPOINTMENTS_SERVICE ($200 flat studio fee) + a per-head
 * craft cost. Crafts are catalog ITEMS in the "Party Crafts" category (each with
 * a name, per-head price, description, and optional image), created via
 * `scripts/seed-party.ts` + `scripts/add-party-craft.ts`.
 *
 * Open Studio is a non-bookable catalog item (flow='display', dated windows in
 * the `programDates` custom attribute).
 */
export const partyConfig = {
  square: {
    /** APPOINTMENTS_SERVICE catalog item for the whole-studio party. */
    catalogItemId: 'ZMSLASCRBGJ7JE3MJVOVJUSA',
    /** Category holding craft ITEMS (name + per-head price + description + image). */
    partyCraftCategoryId: 'YJYZ5FAHKRCFH634JSDJEZVQ',
    /** Marker category — crafts also tagged here are made-to-order & non-refundable. */
    personalizedCategoryId: 'FD7DGZWHHJ76KF7YWAWKDWYS',
    /** Non-bookable Open Studio display item (flow='display'). TODO: rebuild — old TEST item was deleted. */
    openStudioItemId: '3ACHZ6GJKU4SVCF6RN3QJZE4',
    /** Default team member the whole-room booking is assigned to (Kaden). */
    defaultTeamMemberId: 'TMeIN-kxF-ZVhTVj',
  },
  /** Flat room fee in cents ($200). Per-head craft cost comes from the chosen craft modifier. */
  basePriceCents: 20000,
  /** Hard guest cap for any bookable event (studio room capacity). */
  maxGuests: 30,
  /** Default guest estimate — anchors the party at a realistic size, not 1. */
  defaultGuests: 10,
  /** One-tap guest counts offered before the fine-tune stepper. */
  guestQuickPicks: [8, 10, 12, 15, 20],
  /** Party length shown to the customer. */
  durationMinutes: 90,
  /** How many days ahead the date picker offers bookable party dates. */
  bookingWindowDays: 45,
  /** Cleanup gap between back-to-back parties, and before the evening workshop. */
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
 *   Sat: 9:00, 11:30, 2:00, 4:30   (90-min parties, 1-hr gaps, wrap by 7pm)
 *   Sun: 1:00, 3:30                (wrap by 6pm)
 */
export const partyDays: Record<number, { firstStart: string; lastWrap: string }> = {
  0: { firstStart: '13:00', lastWrap: '18:00' }, // Sunday
  6: { firstStart: '09:00', lastWrap: '19:00' }, // Saturday
}
