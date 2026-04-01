/** Only config that Square can't handle natively */
export const reservationConfig = {
  /** Max party tables per time slot (physical constraint — only 2 party areas) */
  partyTableMaxPerSlot: 2,
  /** Max dedicated hosts per time slot (staffing constraint) */
  dedicatedHostMaxPerSlot: 2,
  /** For whole studio bookings: how much of the $500 becomes gift card craft credit */
  wholeStudioCraftCreditCents: 20000, // $200
  /** For table reservations: 100% of deposit becomes gift card craft credit */
  tableCraftCreditPercent: 100,
}
