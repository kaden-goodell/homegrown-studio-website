/**
 * Parties by host email (I-10 / N8): a small index so the public booking's
 * same-person check (same-person.ts) reads only that host's parties, never
 * every party in the store.
 *
 * kv `party-by-host`, one record per host email (keyed by a hash of the
 * lower-cased email, so no address is a key): the party ids with their start
 * and when they were made, newest last, capped. Written when a party is made
 * and when a party's host email changes. The index only points: every party
 * it names is read again and checked (email, status) before it counts, so an
 * old entry is harmless. Best effort: a store blip never fails a booking.
 *
 * Server only.
 */
import { createHash } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('party-host-index')
const kv = makeKvStore('party-by-host', 'party-by-host')
/** Entries kept per host (the newest). */
export const HOST_INDEX_CAP = 40

export interface HostIndexEntry { id: string; startIso: string; createdAt: string }

const keyOf = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 40)

function parse(value: string | null): HostIndexEntry[] {
  if (!value) return []
  try {
    const v = JSON.parse(value)
    return Array.isArray(v?.parties) ? v.parties.filter((e: any) => e && typeof e.id === 'string') : []
  } catch {
    return []
  }
}

/** Note that this host has this party. Never throws. */
export async function indexPartyHost(email: string | null | undefined, entry: HostIndexEntry): Promise<void> {
  if (!email || !email.trim()) return
  const key = keyOf(email)
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await casPause(attempt)
      const { value, etag } = await kv.getWithMeta(key)
      const cur = parse(value)
      const next = [...cur.filter((e) => e.id !== entry.id), entry].slice(-HOST_INDEX_CAP)
      if (await kv.setIfMatch(key, JSON.stringify({ parties: next }), etag, value !== null)) return
    }
    logger.warn('Party host index busy; not noted', { partyId: entry.id })
  } catch (err) {
    logger.warn('Party host index not written', { partyId: entry.id, error: err instanceof Error ? err.message : String(err) })
  }
}

/** This host's parties as the index has them (newest last). Throws when the store can't be read. */
export async function partiesOfHost(email: string): Promise<HostIndexEntry[]> {
  if (!email.trim()) return []
  return parse(await kv.get(keyOf(email)))
}
