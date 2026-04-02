/** Only config that Square can't handle natively */
export const reservationConfig = {
  /** Max tables per time slot (physical constraint — 6 tables in the studio) */
  maxTablesPerSlot: 6,
  /** Max party tables per time slot (physical constraint — only 2 party areas) */
  partyTableMaxPerSlot: 2,
  /** Max dedicated hosts per time slot (staffing constraint) */
  dedicatedHostMaxPerSlot: 2,
  /** For whole studio bookings: how much of the $500 becomes gift card craft credit */
  wholeStudioCraftCreditCents: 20000, // $200
  /** For table reservations: 100% of deposit becomes gift card craft credit */
  tableCraftCreditPercent: 100,
  square: {
    /** The one stable ID — everything else is fetched dynamically via service-info */
    catalogItemId: 'A4LUBW4SBU5I2LG44KV5PX3B',
    /** Default team member for bookings (falls back to any available) */
    defaultTeamMemberId: 'TMeIN-kxF-ZVhTVj',
  },
}
