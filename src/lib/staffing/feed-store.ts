/**
 * Calendar links for phones (stage 3): read-only ICS feeds behind a secret
 * token in the URL. kv `calendar-feeds`:
 *   tok-{sha256hex}            → FeedRecord (only the HASH of a token is ever stored)
 *   who-staff-{staffId} / who-owner-{Owner} → { hash } of that person's current link
 *
 * A token is 32 random bytes, base64url (43 characters), shown once when it
 * is made (S3-R5). findFeed hashes it, reads the record, and believes it only
 * while that person's current link is this hash, so making a new link or
 * revoking stops the old one at once even if tidying its record fails. The
 * feed's scope comes from the record, never from the URL.
 *
 * Writes are compare-and-set and refused on a test site sharing the live
 * stores (R41). Server only.
 */
import { createHash, randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { assertClassWritesAllowed, classWritesRefusal } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { ownerOf, type Owner } from '@lib/admin-who'
import type { By } from '@lib/staff-auth'
import { BUSY_SAVING, StaffingError } from './errors'
import { storableStaffId } from './ids'

const logger = createLogger('calendar-feeds')
const kv = makeKvStore('calendar-feeds', 'calendar-feeds')
const ATTEMPTS = 3
const TOUCH_EVERY_MS = 60 * 60_000
export const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export interface FeedRecord {
  hash: string
  scope: 'mine' | 'all'
  staffId: string | null
  owner: Owner | null
  createdAt: string
  by: By
  lastUsedAt: string | null
}
type Who = { staffId: string } | { owner: Owner }

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const tokKey = (hash: string) => `tok-${hash}`

function whoKey(who: Who): string {
  if ('staffId' in who) {
    if (!storableStaffId(who.staffId)) throw new StaffingError(403, "That person isn't on the team list.")
    return `who-staff-${who.staffId}`
  }
  const owner = ownerOf(who.owner)
  if (!owner) throw new StaffingError(403, 'Only an owner can have the whole-studio calendar.')
  return `who-owner-${owner}`
}

const whoKeyOfRecord = (r: FeedRecord): string | null => {
  try {
    if (r.scope === 'mine' && r.staffId) return whoKey({ staffId: r.staffId })
    if (r.scope === 'all' && r.owner) return whoKey({ owner: r.owner })
  } catch { /* a malformed record is no link */ }
  return null
}

/** Points the person's current link at `hash` (or null); returns the hash it replaced. */
async function setCurrent(k: string, hash: string | null): Promise<string | null> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(k)
    const prev = value ? ((JSON.parse(value) as { hash: string | null } | null)?.hash ?? null) : null
    if (await kv.setIfMatch(k, JSON.stringify({ hash, at: new Date().toISOString() }), etag, value !== null)) return prev
  }
  throw new StaffingError(503, BUSY_SAVING)
}

/** Tidies a replaced link's record away. Best effort: the current-link check already stops it. */
async function forget(hash: string | null): Promise<void> {
  if (!hash) return
  try {
    const { value, etag } = await kv.getWithMeta(tokKey(hash))
    if (value !== null) await kv.setIfMatch(tokKey(hash), 'null', etag, true)
  } catch (err) {
    logger.warn('Could not tidy an old calendar link', { error: err instanceof Error ? err.message : String(err) })
  }
}

export const LINK_RACE = 'A new link was just made on another screen at the same moment. Tap Make a new link again.'

/**
 * Makes a person's link, stopping their previous one. The raw token is
 * returned once and never stored. Two taps at the same moment: the first to
 * land wins and the other is told to try again (409), so nobody is ever shown
 * a link that is already dead.
 */
export async function makeFeed(who: Who, by: By): Promise<{ token: string; record: FeedRecord }> {
  const k = whoKey(who)
  assertClassWritesAllowed() // R41
  const pointer = await kv.getWithMeta(k)
  const prev = pointer.value ? ((JSON.parse(pointer.value) as { hash: string | null } | null)?.hash ?? null) : null
  const token = randomBytes(32).toString('base64url')
  const hash = sha256(token)
  const record: FeedRecord = {
    hash,
    scope: 'staffId' in who ? 'mine' : 'all',
    staffId: 'staffId' in who ? who.staffId : null,
    owner: 'owner' in who ? ownerOf(who.owner) : null,
    createdAt: new Date().toISOString(),
    by,
    lastUsedAt: null,
  }
  if (!(await kv.setIfMatch(tokKey(hash), JSON.stringify(record), null, false))) throw new StaffingError(503, BUSY_SAVING)
  const pointed = await kv.setIfMatch(k, JSON.stringify({ hash, at: new Date().toISOString() }), pointer.etag, pointer.value !== null)
  if (!pointed) {
    await forget(hash)
    throw new StaffingError(409, LINK_RACE)
  }
  if (prev && prev !== hash) await forget(prev)
  return { token, record }
}

/** Stops a person's link (nothing to stop is fine). */
export async function revokeFeed(who: Who, by: By): Promise<void> {
  const k = whoKey(who)
  assertClassWritesAllowed() // R41
  const { value } = await kv.getWithMeta(k)
  if (!value || !(JSON.parse(value) as { hash: string | null } | null)?.hash) return
  const prev = await setCurrent(k, null)
  await forget(prev)
  logger.info('Calendar link stopped', { by: by.name })
}

/**
 * The link a token is, or null (wrong shape, unknown, replaced or stopped).
 * Never compares raw tokens; throws only when the store can't be read.
 */
export async function findFeed(token: string): Promise<FeedRecord | null> {
  if (typeof token !== 'string' || !FEED_TOKEN_RE.test(token)) return null
  const hash = sha256(token)
  const json = await kv.get(tokKey(hash))
  const record = json ? (JSON.parse(json) as FeedRecord | null) : null
  if (!record || record.hash !== hash) return null
  const k = whoKeyOfRecord(record)
  if (!k) return null
  const current = await kv.get(k)
  const currentHash = current ? (JSON.parse(current) as { hash: string | null } | null)?.hash ?? null : null
  return currentHash === hash ? record : null
}

/** Notes when a link was last used, at most once an hour. Never throws. */
export async function touchFeed(hash: string, now: Date): Promise<void> {
  try {
    if (!/^[0-9a-f]{64}$/.test(hash) || classWritesRefusal()) return
    const { value, etag } = await kv.getWithMeta(tokKey(hash))
    const record = value ? (JSON.parse(value) as FeedRecord | null) : null
    if (!record || record.hash !== hash) return
    if (record.lastUsedAt && now.getTime() - Date.parse(record.lastUsedAt) < TOUCH_EVERY_MS) return
    await kv.setIfMatch(tokKey(hash), JSON.stringify({ ...record, lastUsedAt: now.toISOString() }), etag, true)
  } catch (err) {
    logger.warn('Could not note a calendar link was used', { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Whether this person has a working link now (the screen says "You have a link" without showing it). */
export async function hasFeed(who: Who): Promise<boolean> {
  let k: string
  try { k = whoKey(who) } catch { return false }
  const json = await kv.get(k)
  return !!(json && (JSON.parse(json) as { hash: string | null } | null)?.hash)
}

/** Whether a person has a working link, when it was made and last used (owners' "Stop their calendar link" list). Throws when the store fails. */
export async function feedStatus(who: Who): Promise<{ has: boolean; createdAt: string | null; lastUsedAt: string | null }> {
  const none = { has: false, createdAt: null, lastUsedAt: null }
  let k: string
  try { k = whoKey(who) } catch { return none }
  const json = await kv.get(k)
  const hash = json ? (JSON.parse(json) as { hash: string | null } | null)?.hash ?? null : null
  if (!hash) return none
  const rec = await kv.get(tokKey(hash))
  const record = rec ? (JSON.parse(rec) as FeedRecord | null) : null
  return { has: true, createdAt: record?.createdAt ?? null, lastUsedAt: record?.lastUsedAt ?? null }
}
