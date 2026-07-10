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

const logger = createLogger('party-store')

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
   * confirmed pickup list + a pickup code + dropdown check-out. Birthday-style
   * parties (parent present) leave this false.
   */
  dropOff: boolean
  createdAt: string // ISO
}

const STORE_NAME = 'parties'

async function getBlobStore() {
  const { getStore } = await import('@netlify/blobs')
  const store = getStore(STORE_NAME)
  await store.get('__probe__')
  return store
}

async function fsWrite(key: string, json: string): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const dir = new URL('../../.data/parties/', import.meta.url)
  await mkdir(dir, { recursive: true })
  await writeFile(new URL(`${key}.json`, dir), json, 'utf8')
}

async function fsRead(key: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const dir = new URL('../../.data/parties/', import.meta.url)
    return await readFile(new URL(`${key}.json`, dir), 'utf8')
  } catch {
    return null
  }
}

export function newHostToken(): string {
  return randomUUID().replace(/-/g, '')
}

export async function savePartyRecord(record: PartyRecord): Promise<void> {
  const json = JSON.stringify(record, null, 2)
  try {
    const store = await getBlobStore()
    await store.set(record.bookingId, json)
  } catch {
    await fsWrite(record.bookingId, json)
  }
  logger.info('Party stored', { bookingId: record.bookingId })
}

export async function getPartyRecord(bookingId: string): Promise<PartyRecord | null> {
  try {
    const store = await getBlobStore()
    const json = await store.get(bookingId, { type: 'text' })
    if (json) return JSON.parse(json)
  } catch {
    /* fall through to fs */
  }
  const json = await fsRead(bookingId)
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
  try {
    const store = await getBlobStore()
    const { blobs } = await store.list()
    const records = await Promise.all(
      blobs.map((b: { key: string }) => getPartyRecord(b.key)),
    )
    return records.filter((r): r is PartyRecord => r !== null).sort((a, b) => b.startIso.localeCompare(a.startIso))
  } catch {
    try {
      const { readdir, readFile } = await import('node:fs/promises')
      const dir = new URL('../../.data/parties/', import.meta.url)
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json'))
      const records = await Promise.all(
        files.map(async (f) => JSON.parse(await readFile(new URL(f, dir), 'utf8')) as PartyRecord),
      )
      return records.sort((a, b) => b.startIso.localeCompare(a.startIso))
    } catch {
      return []
    }
  }
}
