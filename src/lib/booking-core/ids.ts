/**
 * Ids for bookings, parties and charges, made from the key that started them
 * (a checkout attempt id, or an owner sheet's create key). A retry with the
 * same key gets the same id, so it finds what the first try made (R35).
 *
 * Server only (node:crypto).
 */
import { createHash } from 'node:crypto'

export type IdPrefix = 'bkg' | 'pty' | 'chg' | 'itm'

/** `${prefix}_` + the first 16 hex characters of sha256(key). */
export function idFor(prefix: IdPrefix, key: string): string {
  return `${prefix}_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

/** An owner sheet's create key: the same shape the class sheet's Add uses. */
export const CREATE_KEY_RE = /^[A-Za-z0-9_-]{8,80}$/
