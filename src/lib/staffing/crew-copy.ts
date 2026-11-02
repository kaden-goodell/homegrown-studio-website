/**
 * Crew-facing words shared by the server (calendar links) and the /staff
 * screens (My shifts). Client-safe: strings only.
 */

/**
 * The line crew see on a party in their phone calendar and in My shifts.
 *
 * TODO(owner, Kaden): this states a staff arrival rule as fact on everyone's
 * phone. Confirm the 30 minutes, change it, or set it to '' to drop the line
 * everywhere at once. The plan's first wording, "Doors 30 minutes early",
 * meant something different (when guests may come in), so it was not used.
 */
export const PARTY_ARRIVAL = 'Be there 30 minutes before it starts.'

/** What crew hear when they try something only an owner can do. */
export const OWNERS_ASSIGN = 'Only an owner can put people on a class or party. Ask Catherine or Kaden.'
