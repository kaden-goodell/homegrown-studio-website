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
  /** Square IDs — all bookings go against one team member, our code enforces table cap */
  square: {
    teamMemberId: 'TMeIN-kxF-ZVhTVj', // Kaden — all table bookings assigned here
    serviceVariationIds: {
      oneHour: 'PTTX7A63IHXJQ6RJHRYUIAEB',
      twoHour: '5D3MCU4WMNAPGDK3I2A6JD65',
    },
    serviceVariationVersions: {
      oneHour: 1775091058045,
      twoHour: 1775091065920,
    },
  },
}
