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
 * A record that is there but can't be read (broken, fields missing), or gone
 * after one was set (the `passcode-was-set` marker stays), counts as
 * unreadable: nobody signs in until an owner sets a new one in /admin, which
 * overwrites it. Only if both the record and the marker are deleted (store
 * access, not something the app does) does STAFF_PASSCODE count again.
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
import { clearFailedSignIns } from '@lib/staff-signin-failures'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('staff-passcode')
const kv = makeKvStore('staff-access', 'staff-access')
const KEY = 'passcode'
/**
 * Written the first time an owner sets a passcode, and never removed. While it
 * is there, a missing passcode record means it was lost or damaged, not "never
 * set", so STAFF_PASSCODE (maybe an old passcode) never quietly comes back (S3).
 */
const MARKER = 'passcode-was-set'
const CACHE_MS = 5_000
const HISTORY_CAP = 20
/** Six or more: a shared passcode is guessed online, so short ones fall in days (S1). */
export const PASSCODE_MIN = 6
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

let cache: { at: number; rec: PasscodeRecord | null | 'unreadable' } | null = null
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
  await kv.set(MARKER, 'null')
}

/** @internal test-only: write the raw stored value (to test a damaged record). */
export async function _writeRawPasscodeForTests(raw: string): Promise<void> {
  _resetPasscodeCache()
  await kv.set(KEY, raw)
}

type Parsed = { state: 'absent' } | { state: 'ok'; rec: PasscodeRecord } | { state: 'invalid' }

/** Tells "nothing saved" apart from "something saved that can't be used". Never throws. */
function parse(json: string | null): Parsed {
  if (!json) return { state: 'absent' }
  let rec: any
  try {
    rec = JSON.parse(json)
  } catch {
    return { state: 'invalid' }
  }
  if (rec === null) return { state: 'absent' }
  const ok = rec && typeof rec === 'object'
    && typeof rec.hash === 'string' && rec.hash.length > 0
    && typeof rec.salt === 'string' && rec.salt.length > 0
    && typeof rec.gen === 'number' && Number.isFinite(rec.gen)
    && typeof rec.updatedAt === 'string'
    && rec.by && typeof rec.by.name === 'string'
  if (!ok) return { state: 'invalid' }
  return { state: 'ok', rec: { ...rec, history: Array.isArray(rec.history) ? rec.history : [] } as PasscodeRecord }
}

/** True once an owner has ever set a passcode here. */
async function wasEverSet(): Promise<boolean> {
  const raw = await kv.get(MARKER)
  return !!raw && raw !== 'null'
}

/** The record, null (never set: STAFF_PASSCODE), or 'damaged' (unusable or lost after one was set). Throws when the store can't be read. */
async function readState(): Promise<PasscodeRecord | null | 'damaged'> {
  const parsed = parse(await kv.get(KEY))
  if (parsed.state === 'ok') return parsed.rec
  if (parsed.state === 'invalid') return 'damaged'
  return (await wasEverSet()) ? 'damaged' : null
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
    const state = await readState()
    if (state === 'damaged') {
      // Never fall back to STAFF_PASSCODE or an older copy: an owner sets a new one in /admin to fix it.
      logger.error('The saved staff passcode is damaged or missing; nobody can sign in to /staff until an owner sets a new one')
      cache = { at: Date.now(), rec: 'unreadable' }
      lastKnown = null
      return 'unreadable'
    }
    cache = { at: Date.now(), rec: state }
    lastKnown = { rec: state }
    return state
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

/**
 * What /admin shows: whether an owner set one, and who and when. Never the
 * passcode. `damaged`: the saved one can't be used, so nobody can sign in to
 * /staff until an owner sets a new one (saving it repairs it).
 */
export async function passcodeStatus(): Promise<{ setInAdmin: boolean; updatedAt: string | null; by: string | null; damaged: boolean }> {
  const state = await readState()
  if (state === 'damaged') return { setInAdmin: true, updatedAt: null, by: null, damaged: true }
  return state
    ? { setInAdmin: true, updatedAt: state.updatedAt, by: state.by.name, damaged: false }
    : { setInAdmin: false, updatedAt: null, by: null, damaged: false }
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
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const { value, etag } = await kv.getWithMeta(KEY)
    // A damaged record reads as "none" here, so the screen's null matches and saving repairs it (the etag still guards the write).
    const parsed = parse(value)
    const cur = parsed.state === 'ok' ? parsed.rec : null
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
      try {
        await kv.set(MARKER, JSON.stringify({ at: stamp }))
      } catch (err) {
        logger.warn('Could not note that a staff passcode was set', { error: err instanceof Error ? err.message : String(err) })
      }
      await clearFailedSignIns()
      logger.info('Staff passcode changed', { by: by.name, gen: rec.gen })
      return { updatedAt: rec.updatedAt, gen: rec.gen }
    }
  }
  throw new PasscodeError(503, PASSCODE_MESSAGES.busy)
}
