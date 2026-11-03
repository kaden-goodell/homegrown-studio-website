/**
 * The owners' names for crew screens on /staff (N11): "Ask Catherine or
 * Kaden." comes from the staff list's Owners (More › Staff › People), never
 * from names written into the screens, so a new owner shows up everywhere.
 *
 * /staff fills this from me.json / pick.json (`owners`). Until it has, it
 * uses the same bootstrap owners the server uses before a staff list exists
 * (admin-who OWNERS).
 *
 * Client-safe: no server imports.
 */
import { OWNERS } from '@lib/admin-who'

let names: string[] = [...OWNERS]

/** Take the owners from a /staff reply. Anything that isn't a non-empty list of names is ignored. */
export function setOwnerNames(value: unknown): void {
  if (!Array.isArray(value)) return
  const clean = value.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
  if (clean.length) names = clean
}

/** Tests: back to the bootstrap owners. */
export function _resetOwnerNamesForTests(): void {
  names = [...OWNERS]
}

const join = (word: 'or' | 'and') =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`

/** "Catherine or Kaden" (one owner: "Catherine"). */
export const ownersOr = (): string => join('or')
/** "Catherine and Kaden" (one owner: "Catherine"). */
export const ownersAnd = (): string => join('and')
/** True with a single owner, for verbs ("Catherine puts" vs "Catherine or Kaden put"). */
export const oneOwner = (): boolean => names.length === 1
