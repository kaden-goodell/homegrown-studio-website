/**
 * Who is using /admin. The admin passcode is shared, so the page asks
 * "Who's using this?" at sign-in, remembers the answer on the device, and
 * sends it with every admin request as the X-Admin-Who header. The server
 * only believes a name on this fixed list (Kaden, 19 Oct 2026).
 *
 * Client-safe: no imports, no env.
 */
export const OWNERS = ['Catherine', 'Kaden'] as const
export type Owner = (typeof OWNERS)[number]

export const ADMIN_WHO_HEADER = 'X-Admin-Who'

/** The owner a value names (any case, trimmed), or null when it isn't one of them. */
export function ownerOf(value: unknown): Owner | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return OWNERS.find((o) => o.toLowerCase() === v) ?? null
}
