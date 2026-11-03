/**
 * Who is using /admin. The admin passcode is shared, so the page asks
 * "Who's using this?" at sign-in, remembers the answer on the device, and
 * sends it with every admin request as the X-Admin-Who header.
 *
 * The owners are the people marked Owner on the staff list (More › Staff ›
 * People), read on the server by admin-owners.ts. OWNERS is only the
 * bootstrap: the two names used until the staff list exists (and the first
 * names the sign-in screen offers on a device that has never signed in).
 *
 * Client-safe: no imports, no env.
 */
export const OWNERS = ['Catherine', 'Kaden'] as const
/** An owner's name as the staff list shows it ("Catherine"). */
export type Owner = string

export const ADMIN_WHO_HEADER = 'X-Admin-Who'

/** Longest owner name a device or request may carry. */
export const OWNER_NAME_MAX = 60

/** A value tidied into a possible owner name (trimmed, one space between words), or null when it can't be one. */
export function ownerNameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/\s+/g, ' ')
  if (!v || v.length > OWNER_NAME_MAX || /[\u0000-\u001f<>]/.test(v)) return null
  return v
}

/** The owner a value names from `owners` (any case, trimmed), or null when it isn't one of them. */
export function ownerOf(value: unknown, owners: readonly string[] = OWNERS): Owner | null {
  const v = ownerNameOf(value)?.toLowerCase()
  if (!v) return null
  return owners.find((o) => o.toLowerCase() === v) ?? null
}
