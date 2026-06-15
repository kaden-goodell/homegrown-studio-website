/**
 * Party + Open Studio prototype configuration.
 *
 * These point at TEST dummy data created in Square production by
 * `scripts/test-data-setup.mjs` (all objects prefixed "TEST —"). Swap these
 * IDs for the real catalog objects before launch; wipe TEST data with
 * `scripts/test-data-teardown.mjs`.
 *
 * Open Studio is a non-bookable catalog item (flow='display', dated windows in
 * the `programDates` custom attribute). Party is a bookable APPOINTMENTS_SERVICE:
 * $200 flat base + a per-head craft cost that varies by craft (a modifier list).
 */
export const partyConfig = {
  square: {
    /** APPOINTMENTS_SERVICE catalog item for the whole-studio party. */
    catalogItemId: 'BAL6K7M3U5RW2LAYM6VUZN6U',
    /** Modifier list of craft choices, each modifier carries a per-head price. */
    craftModifierListId: 'UHO5JT4AID362P4MKTRMVGRX',
    /** Non-bookable Open Studio display item (flow='display'). */
    openStudioItemId: '3ACHZ6GJKU4SVCF6RN3QJZE4',
    /** Default team member the whole-room booking is assigned to (Kaden). */
    defaultTeamMemberId: 'TMeIN-kxF-ZVhTVj',
  },
  /** Flat room fee in cents ($200). Per-head craft cost comes from the chosen craft modifier. */
  basePriceCents: 20000,
  /** Hard guest cap for any bookable event (studio room capacity). */
  maxGuests: 30,
  /** Party length shown to the customer. */
  durationMinutes: 120,
  /** Cleanup gap enforced app-side between back-to-back parties (Square returns hourly starts). */
  cleanupBufferMinutes: 60,
  /** Studio timezone for interpreting slot start times. */
  timezone: 'America/Chicago',
  /**
   * Latest local hour a party may START. 3pm → party (2h) + cleanup (1h) wraps by 6pm,
   * leaving 6pm onward exclusively for workshops. This is the "6pm-exclusive" rule.
   * (Per-day party scheduling beyond this is TBD — owner finalizing with the real schedule.)
   */
  latestStartHourLocal: 15,
  /** Spacing between offered party starts: 2h party + 1h cleanup. */
  slotSpacingHours: 3,
  /**
   * Craft per-head price breaks by guest count (discount applies to the CRAFT cost only,
   * never the $200 base). Percentage so it's fair across $20–90 crafts.
   */
  priceBreakTiers: [
    { fromGuest: 1, discountPct: 0 },
    { fromGuest: 11, discountPct: 25 },
    { fromGuest: 21, discountPct: 50 },
  ],
} as const
