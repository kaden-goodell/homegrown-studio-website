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
import { isPreviewOrDev } from '@lib/deploy-context'
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
  /** Host's phone — the studio's day-of contact channel. Added 2026-09; older
   *  records predate this field, so consumers must tolerate it being absent. */
  hostPhone?: string
  guestCount: number
  title: string | null
  /**
   * Drop-off event (parents leave). Turns on staff pickup verification: a
   * confirmed pickup list + a pickup code + dropdown check-out. Parties are
   * never drop-off (a responsible adult stays with each child); only
   * studio-run drop-off events (camps, PNO) set this. Read-only here now —
   * the staff console writes drop-off via the `event-meta` overlay
   * (`@lib/event-meta`); this field is a fallback `getEvent` reads for old
   * records written before that store existed.
   */
  dropOff: boolean
  /**
   * In-studio themed-table add-on, when the host booked one. `displayName` is
   * the SELECTED theme (e.g. "The Sweet Sixteen") — never the ledger-collapsed
   * variant — so staff staging the room see the right name. `claimRef` is the
   * reservation key on the shared kit ledger, released when the party cancels.
   */
  theme?: { themeId: string; displayName: string; serves: number; claimRef: string }
  /** Written by a payment-bypass booking (dev / preview). Hidden in production. */
  simulated?: true
  createdAt: string // ISO
}

export function newHostToken(): string {
  return randomUUID().replace(/-/g, '')
}

export async function savePartyRecord(record: PartyRecord): Promise<void> {
  await kv.set(record.bookingId, JSON.stringify(record, null, 2))
  logger.info('Party stored', { bookingId: record.bookingId })
}

/** Previews share production's blob stores; simulated parties must never show up there. */
function visibleHere(record: PartyRecord): boolean {
  return isPreviewOrDev() || !(record.simulated === true || record.bookingId.startsWith('dev_'))
}

export async function getPartyRecord(bookingId: string): Promise<PartyRecord | null> {
  const json = await kv.get(bookingId)
  if (!json) return null
  const record: PartyRecord = JSON.parse(json)
  return visibleHere(record) ? record : null
}

/** Constant-ish check that the supplied token matches the party's host token. */
export function hostTokenValid(record: PartyRecord | null, token: string | null | undefined): boolean {
  return !!record && !!token && token === record.hostToken
}

/** All party records (for the staff console). Newest first. */
export async function listParties(): Promise<PartyRecord[]> {
  const keys = (await kv.list()).filter((k) => k !== '__probe__')
  const records = await Promise.all(keys.map(getPartyRecord))
  return records
    .filter((r): r is PartyRecord => r !== null)
    .sort((a, b) => b.startIso.localeCompare(a.startIso))
}
