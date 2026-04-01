/** Only config that Square can't handle natively */
export const reservationConfig = {
  /** Max party add-on bookings per time slot (Square doesn't have this concept) */
  partyAddOnMaxPerSlot: 2,
  /** For whole studio bookings: how much of the $500 becomes gift card craft credit */
  wholeStudioCraftCreditCents: 20000, // $200
  /** For table reservations: 100% of deposit becomes gift card craft credit */
  tableCraftCreditPercent: 100,
}
