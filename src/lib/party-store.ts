/**
 * Party metadata + host access token.
 *
 * Saved when a party is booked so the host can return to a management view of
 * their party (details + who's RSVP'd) via a link carrying a secret token.
 * The token gates the roster — it holds other guests' kid names, allergies,
 * and emergency contacts, so the party page must never be a guessable URL.
 *
 * Netlify Blobs in prod, `.data/parties/` on disk in dev.
 */
import { randomUUID } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'

const logger = createLogger('party-store')
const kv = makeKvStore('parties', 'parties')

export interface PartyRecord {
  bookingId: string
  hostToken: string
  craftName: string
  startIso: string
  durationMinutes: number | null
  hostName: string
  hostEmail: string
  guestCount: number
  title: string | null
  /**
   * Drop-off event (parents leave). Turns on staff pickup verification: a
   * confirmed pickup list + a pickup code + dropdown check-out. Parties are never drop-off (a responsible adult stays with each child); only studio-run drop-off events (camps, PNO) set this, via the staff console.
   */
  dropOff: boolean
  /**
   * In-studio themed-table add-on, when the host booked one. `displayName` is
   * the SELECTED theme (e.g. "The Sweet Sixteen") — never the ledger-collapsed
   * variant — so staff staging the room see the right name. `claimRef` is the
   * reservation key on the shared kit ledger, released when the party cancels.
   */
  theme?: { themeId: string; displayName: string; serves: number; claimRef: string }
  createdAt: string // ISO
}

export function newHostToken(): string {
  return randomUUID().replace(/-/g, '')
}

export async function savePartyRecord(record: PartyRecord): Promise<void> {
  await kv.set(record.bookingId, JSON.stringify(record, null, 2))
  logger.info('Party stored', { bookingId: record.bookingId })
}

export async function getPartyRecord(bookingId: string): Promise<PartyRecord | null> {
  const json = await kv.get(bookingId)
  return json ? JSON.parse(json) : null
}

/** Constant-ish check that the supplied token matches the party's host token. */
export function hostTokenValid(record: PartyRecord | null, token: string | null | undefined): boolean {
  return !!record && !!token && token === record.hostToken
}

/** Flip the drop-off flag on a party (staff console). */
export async function updatePartyDropOff(bookingId: string, dropOff: boolean): Promise<PartyRecord | null> {
  const record = await getPartyRecord(bookingId)
  if (!record) return null
  const updated = { ...record, dropOff }
  await savePartyRecord(updated)
  return updated
}

/** All party records (for the staff console). Newest first. */
export async function listParties(): Promise<PartyRecord[]> {
  const keys = (await kv.list()).filter((k) => k !== '__probe__')
  const records = await Promise.all(keys.map(getPartyRecord))
  return records
    .filter((r): r is PartyRecord => r !== null)
    .sort((a, b) => b.startIso.localeCompare(a.startIso))
}
