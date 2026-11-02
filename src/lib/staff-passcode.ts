/**
 * The staff passcode an owner sets in /admin › More › Staff › People › Staff
 * passcode (bus factor: Catherine can lock out someone who left without the
 * Netlify dashboard). Stored only as a salted scrypt hash, never the passcode
 * itself, in kv `staff-access` (key `passcode`), changed with compare-and-set
 * and the last changes kept (who and when, never what).
 *
 * Once an owner sets one, it takes the place of the STAFF_PASSCODE setting.
 * Each change moves the session generation on, and staff-auth signs cookies
 * with a key made from the stored hash and that generation, so a change signs
 * everyone out of /staff at once.
 *
 * Until an owner first sets one, there is no record and staff-auth uses
 * STAFF_PASSCODE exactly as before (cookies already handed out keep working).
 *
 * Deliberately not in the weekly archive (archive-stores.ts): a passcode hash
 * has no record value.
 *
 * Server only.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'

const logger = createLogger('staff-passcode')
const kv = makeKvStore('staff-access', 'staff-access')
const KEY = 'passcode'
const ATTEMPTS = 3
const CACHE_MS = 5_000
const HISTORY_CAP = 20
export const PASSCODE_MIN = 4
export const PASSCODE_MAX = 40

export interface PasscodeRecord {
  v: 1
  /** base64url */
  salt: string
  /** base64url scrypt(passcode, salt) */
  hash: string
  /** Moves on with every change: cookies from an older generation stop counting. */
  gen: number
  updatedAt: string
  by: By
  /** newest first: who changed it and when, never the passcode. */
  history: { at: string; by: By }[]
}

export const PASSCODE_MESSAGES = {
  short: `Use at least ${PASSCODE_MIN} letters or numbers.`,
  long: `Keep it to ${PASSCODE_MAX} letters or numbers or fewer.`,
  mismatch: 'The two passcodes don’t match. Type the same one twice.',
  stale: 'Someone else just changed the staff passcode. Check with them, then try again if you still need to.',
  busy: 'Someone else is saving at the same moment. Try again.',
  unreadable: 'We couldn’t reach the staff passcode just now. Try again in a minute.',
} as const

export class PasscodeError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'PasscodeError'
  }
}

function scrypt(pass: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pass, salt, 32, (err, key) => (err ? reject(err) : resolve(key))))
}

let cache: { at: number; rec: PasscodeRecord | null } | null = null
/** The last answer this server read, used when the store can't be read (never STAFF_PASSCODE: a changed passcode must not come back in an outage). */
let lastKnown: { rec: PasscodeRecord | null } | null = null

/** @internal test-only */
export function _resetPasscodeCache(): void {
  cache = null
  lastKnown = null
}

/** @internal test-only: forget the saved passcode (back to STAFF_PASSCODE). */
export async function _resetPasscodeForTests(): Promise<void> {
  _resetPasscodeCache()
  await kv.set(KEY, 'null')
}

function parse(json: string | null): PasscodeRecord | null {
  if (!json) return null
  const rec = JSON.parse(json) as PasscodeRecord | null
  return rec && typeof rec.hash === 'string' && typeof rec.salt === 'string' && typeof rec.gen === 'number' ? rec : null
}

/**
 * The owner-set passcode record, or null when none was ever set (STAFF_PASSCODE
 * is in use). Remembered for a few seconds. When the store can't be read: the
 * last answer this server had, else 'unreadable' (staff-auth then lets nobody
 * in, rather than guess).
 */
export async function readPasscodeRecord(): Promise<PasscodeRecord | null | 'unreadable'> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rec
  try {
    const rec = parse(await kv.get(KEY))
    cache = { at: Date.now(), rec }
    lastKnown = { rec }
    return rec
  } catch (err) {
    logger.error('Staff passcode could not be read', { error: err instanceof Error ? err.message : String(err) })
    return lastKnown ? lastKnown.rec : 'unreadable'
  }
}

/** True when `input` is the owner-set passcode. */
export async function matchesRecord(rec: PasscodeRecord, input: string): Promise<boolean> {
  if (typeof input !== 'string' || !input) return false
  const want = Buffer.from(rec.hash, 'base64url')
  const got = await scrypt(input, Buffer.from(rec.salt, 'base64url'))
  return want.length === got.length && timingSafeEqual(want, got)
}

/** What /admin shows: whether an owner set one, and who and when. Never the passcode. */
export async function passcodeStatus(): Promise<{ setInAdmin: boolean; updatedAt: string | null; by: string | null }> {
  const rec = parse(await kv.get(KEY))
  return rec ? { setInAdmin: true, updatedAt: rec.updatedAt, by: rec.by.name } : { setInAdmin: false, updatedAt: null, by: null }
}

/** Tidies and checks a new passcode (spaces at the ends dropped). */
export function cleanPasscode(raw: unknown, again: unknown): string {
  const p = typeof raw === 'string' ? raw.trim() : ''
  const a = typeof again === 'string' ? again.trim() : ''
  if (p.length < PASSCODE_MIN) throw new PasscodeError(400, PASSCODE_MESSAGES.short)
  if (p.length > PASSCODE_MAX) throw new PasscodeError(400, PASSCODE_MESSAGES.long)
  if (p !== a) throw new PasscodeError(400, PASSCODE_MESSAGES.mismatch)
  return p
}

/**
 * Sets a new staff passcode. `expectedUpdatedAt` = what the screen loaded
 * (null when none was set in /admin yet); anything newer is refused (409).
 * Signs everyone out of /staff (the generation moves on).
 */
export async function setStaffPasscode(passcode: string, by: By, expectedUpdatedAt: string | null, now = new Date()): Promise<{ updatedAt: string; gen: number }> {
  if (classWritesRefusal()) throw new TestSiteStoreError() // R41: never the live passcode from a test site
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const cur = parse(value)
    if ((cur?.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) throw new PasscodeError(409, PASSCODE_MESSAGES.stale)
    const salt = randomBytes(16)
    const hash = (await scrypt(passcode, salt)).toString('base64url')
    const stamp = cur && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const rec: PasscodeRecord = {
      v: 1,
      salt: salt.toString('base64url'),
      hash,
      gen: (cur?.gen ?? 0) + 1,
      updatedAt: stamp,
      by,
      history: [{ at: stamp, by }, ...(cur?.history ?? [])].slice(0, HISTORY_CAP),
    }
    if (await kv.setIfMatch(KEY, JSON.stringify(rec), etag, value !== null)) {
      cache = { at: Date.now(), rec }
      lastKnown = { rec }
      logger.info('Staff passcode changed', { by: by.name, gen: rec.gen })
      return { updatedAt: rec.updatedAt, gen: rec.gen }
    }
  }
  throw new PasscodeError(503, PASSCODE_MESSAGES.busy)
}
