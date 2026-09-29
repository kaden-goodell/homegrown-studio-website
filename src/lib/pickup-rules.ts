/** Pure pickup predicates — no store imports, so both @lib/pickup and @lib/rsvp-store can use them. */

/** Rows or a may-NOT-collect note. */
export function hasPickupContent(
  p: { authorizedPickup: unknown[]; notAuthorized?: string | null } | null | undefined,
): p is { authorizedPickup: any[]; notAuthorized: string } {
  return !!p && (p.authorizedPickup.length > 0 || (p.notAuthorized ?? '').trim() !== '')
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Is `next` the same household as `prev`? Normalized email equal AND signer
 * first + last name equal. Phone never counts: a phone index knows nothing
 * about households, and pickup names are third parties' data.
 */
export function sameHousehold(
  prev: { email: string; firstName: string; lastName: string },
  next: { email: string; firstName: string; lastName: string },
): boolean {
  const e = norm(prev.email)
  return e !== '' && e === norm(next.email) && norm(prev.firstName) === norm(next.firstName) && norm(prev.lastName) === norm(next.lastName)
}
