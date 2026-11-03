/**
 * The /admin passcode an owner sets in /admin › More › Admin access (G4, bus
 * factor: Catherine can change it after a lost phone, or when someone saw it,
 * without the hosting dashboard). Same design as staff-passcode.ts: stored
 * only as a salted scrypt hash in kv `admin-access` (key `passcode`), changed
 * with compare-and-set, the last changes kept (who and when, never what).
 *
 * Once an owner sets one, it takes the place of the ADMIN_PASSCODE setting.
 * Each change moves the session generation on, and admin-auth signs cookies
 * with a key made from the stored hash and that generation, so a change signs
 * every device out of /admin (the one that saved gets a fresh sign-in).
 *
 * Until an owner first sets one, there is no record and admin-auth uses
 * ADMIN_PASSCODE exactly as before (cookies already handed out keep working).
 *
 * A record that is there but can't be read, or gone after one was set (the
 * `passcode-was-set` marker stays), counts as damaged: ADMIN_PASSCODE does NOT
 * quietly come back (it may be the old passcode someone saw).
 *
 * The main way back in when nobody remembers it is the emailed link on the
 * sign-in page (admin-recovery.ts). The last resort, when email itself is
 * down, is deliberate: a NEW ADMIN_PASSCODE of at least 8 characters,
 * different from every setting that was in force at the last few changes
 * here (the marker keeps salted fingerprints of them, never the values),
 * takes over until an owner sets a fresh one here. The settings in force at
 * those changes never work again (M4), and the owners are told by email and
 * text the first time a server sees a takeover.
 *
 * Another server may accept the old passcode or cookie for up to 5 seconds
 * after a change (the per-server cache), or for as long as the store can't
 * be read (the last answer it had). That is accepted (L2).
 *
 * Deliberately not in the weekly archive (archive-stores.ts).
 *
 * Server only.
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('admin-passcode')
const kv = makeKvStore('admin-access', 'admin-access')
const KEY = 'passcode'
/** Written every time an owner sets a passcode, never removed (S3 for /admin). */
const MARKER = 'passcode-was-set'
const CACHE_MS = 5_000
const HISTORY_CAP = 20
/** Eight or more: this one opens refunds and the whole studio's records. */
export const ADMIN_PASSCODE_MIN = 8
export const ADMIN_PASSCODE_MAX = 64

/** Tries at the admin passcode, per address: sign-in and More › Admin access (the current passcode) share them. */
export const ADMIN_PASSCODE_BUCKET = (ip: unknown) => `admin-login:${String(ip ?? 'unknown')}`
export const ADMIN_PASSCODE_MAX_TRIES = 8
export const ADMIN_PASSCODE_WINDOW_MS = 15 * 60_000
export const TOO_MANY_TRIES = 'Too many tries. Wait a few minutes.'

export interface AdminPasscodeRecord {
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

interface EnvPrint { salt: string; fp: string }

interface Marker {
  at: string
  /** Salted fingerprint of the ADMIN_PASSCODE setting in force at that save ('' salt/fp when none was set). */
  envSalt: string
  envFp: string
  /** M4: the settings in force at the earlier saves too (newest first, capped), so reverting the setting never reopens one. */
  envSeen?: EnvPrint[]
}

/** How many earlier ADMIN_PASSCODE settings are remembered (besides the one at the last save). */
export const ENV_SEEN_CAP = 5

export const ADMIN_PASSCODE_MESSAGES = {
  short: `Use at least ${ADMIN_PASSCODE_MIN} letters or numbers.`,
  long: `Keep it to ${ADMIN_PASSCODE_MAX} letters or numbers or fewer.`,
  mismatch: 'The two new passcodes don’t match. Type the same one twice.',
  current: 'The current passcode isn’t right.',
  currentSpaces: 'The current passcode isn’t right. It starts or ends with a space: check for that.',
  same: 'That’s the passcode you have now. Pick a new one.',
  staff: 'That’s the staff passcode, which the crew know. Pick a different one for /admin.',
  spaces: 'The new passcode starts or ends with a space. Take the space out (spaces in the middle are fine).',
  stale: 'Someone else just changed the admin passcode. Check with them, then try again if you still need to.',
  busy: 'Someone else is saving at the same moment. Try again.',
  unreadable: 'We couldn’t reach the admin passcode just now. Try again in a minute.',
} as const

export class AdminPasscodeError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'AdminPasscodeError'
  }
}

function scrypt(pass: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(pass, salt, 32, (err, key) => (err ? reject(err) : resolve(key))))
}

const fingerprint = (value: string, salt: string) => createHmac('sha256', salt).update(`admin-env:${value}`).digest('base64url')

/** What the door uses now. 'damaged' carries the marker so a deliberately new ADMIN_PASSCODE can be told apart from the old one. */
export type AdminPasscodeState =
  | { kind: 'none' }
  | { kind: 'set'; rec: AdminPasscodeRecord; marker: Marker | null }
  | { kind: 'damaged'; marker: Marker | null }

let cache: { at: number; state: AdminPasscodeState | 'unreadable' } | null = null
/** The last answer this server read, used when the store can't be read (never ADMIN_PASSCODE: a changed passcode must not come back in an outage). */
let lastKnown: AdminPasscodeState | null = null

/** @internal test-only */
export function _resetAdminPasscodeCache(): void {
  cache = null
  lastKnown = null
}

/** @internal test-only: forget the saved passcode and the marker (back to ADMIN_PASSCODE). */
export async function _resetAdminPasscodeForTests(): Promise<void> {
  _resetAdminPasscodeCache()
  takeoverChecked.clear()
  await kv.set(KEY, 'null')
  await kv.set(MARKER, 'null')
  await kv.set(TAKEOVER_KEY, 'null')
  await kv.set('failed-signins', 'null')
}

/** @internal test-only: write the raw stored value (to test a damaged or deleted record). */
export async function _writeRawAdminPasscodeForTests(raw: string): Promise<void> {
  _resetAdminPasscodeCache()
  await kv.set(KEY, raw)
}

type Parsed = { state: 'absent' } | { state: 'ok'; rec: AdminPasscodeRecord } | { state: 'invalid' }

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
  return { state: 'ok', rec: { ...rec, history: Array.isArray(rec.history) ? rec.history : [] } as AdminPasscodeRecord }
}

/** The marker, null when a passcode was never set here. A marker that can't be parsed still counts as "was set". */
async function readMarker(): Promise<Marker | null | 'unparseable'> {
  const raw = await kv.get(MARKER)
  if (!raw || raw === 'null') return null
  try {
    const m = JSON.parse(raw)
    return m && typeof m.at === 'string' && typeof m.envSalt === 'string' && typeof m.envFp === 'string' ? (m as Marker) : 'unparseable'
  } catch {
    return 'unparseable'
  }
}

async function readState(): Promise<AdminPasscodeState> {
  const parsed = parse(await kv.get(KEY))
  const marker = await readMarker()
  if (parsed.state === 'ok') return { kind: 'set', rec: parsed.rec, marker: marker === 'unparseable' ? null : marker }
  if (parsed.state === 'invalid') return { kind: 'damaged', marker: marker === 'unparseable' ? null : marker }
  if (marker === null) return { kind: 'none' }
  return { kind: 'damaged', marker: marker === 'unparseable' ? null : marker }
}

/**
 * What the admin door uses now, remembered for a few seconds. When the store
 * can't be read: the last answer this server had, else 'unreadable' (nobody
 * gets in rather than guess).
 */
export async function readAdminPasscode(): Promise<AdminPasscodeState | 'unreadable'> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.state
  try {
    const state = await readState()
    if (state.kind === 'damaged') logger.error('The saved admin passcode is damaged or missing; only a new ADMIN_PASSCODE setting lets owners in to set a fresh one')
    cache = { at: Date.now(), state }
    lastKnown = state
    return state
  } catch (err) {
    logger.error('Admin passcode could not be read', { error: err instanceof Error ? err.message : String(err) })
    return lastKnown ?? 'unreadable'
  }
}

/** True when `input` is the owner-set passcode. */
export async function matchesAdminRecord(rec: AdminPasscodeRecord, input: string): Promise<boolean> {
  if (typeof input !== 'string' || !input) return false
  const want = Buffer.from(rec.hash, 'base64url')
  const got = await scrypt(input, Buffer.from(rec.salt, 'base64url'))
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * True when ADMIN_PASSCODE may be used while the saved passcode is damaged:
 * it is set AND differs from the one in force when a passcode was last set
 * here (so the old value never quietly comes back). With no usable marker,
 * never.
 */
export function envIsNewSince(marker: Marker | null, env: string): boolean {
  if (!env || !marker) return false
  if (env.length < ADMIN_PASSCODE_MIN) return false // M4: a short setting never takes over
  const seen = envPrints(marker)
  return seen.every((e) => fingerprint(env, e.salt) !== e.fp) // none set back then → any value now is new
}

/** Every remembered setting's fingerprint, newest first. */
function envPrints(marker: Marker): EnvPrint[] {
  const out: EnvPrint[] = marker.envSalt ? [{ salt: marker.envSalt, fp: marker.envFp }] : []
  for (const e of Array.isArray(marker.envSeen) ? marker.envSeen : []) {
    if (e && typeof e.salt === 'string' && e.salt && typeof e.fp === 'string') out.push(e)
  }
  return out
}

/** A stable private fingerprint of a setting, for "was this takeover already told?" (never the value). */
export const takeoverPrint = (env: string, salt: string) => fingerprint(`takeover:${env}`, salt)

/** What /admin shows: whether an owner set one, who and when. Never the passcode. */
export async function adminPasscodeStatus(envNow: string): Promise<{ setInAdmin: boolean; updatedAt: string | null; by: string | null; damaged: boolean; settingTookOver: boolean }> {
  const state = await readState()
  if (state.kind === 'damaged') return { setInAdmin: true, updatedAt: null, by: null, damaged: true, settingTookOver: envIsNewSince(state.marker, envNow) }
  return state.kind === 'set'
    ? { setInAdmin: true, updatedAt: state.rec.updatedAt, by: state.rec.by.name, damaged: false, settingTookOver: envIsNewSince(state.marker, envNow) }
    : { setInAdmin: false, updatedAt: null, by: null, damaged: false, settingTookOver: false }
}

/** Checks a new passcode exactly as typed: nothing is trimmed, so what she types at sign-in is what was saved (L3). */
export function cleanAdminPasscode(raw: unknown, again: unknown): string {
  const p = typeof raw === 'string' ? raw : ''
  const a = typeof again === 'string' ? again : ''
  if (p && p !== p.trim()) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.spaces)
  if (p.length < ADMIN_PASSCODE_MIN) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.short)
  if (p.length > ADMIN_PASSCODE_MAX) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.long)
  if (p !== a) throw new AdminPasscodeError(400, ADMIN_PASSCODE_MESSAGES.mismatch)
  return p
}

/**
 * Sets a new admin passcode. `expectedUpdatedAt` = what the screen loaded
 * (null when none was set in /admin yet); anything newer is refused (409).
 * `envNow` = the ADMIN_PASSCODE setting now, fingerprinted into the marker.
 * Signs everyone out of /admin (the generation moves on).
 */
export async function setAdminPasscode(passcode: string, by: By, expectedUpdatedAt: string | null | 'any', envNow: string, now = new Date()): Promise<{ rec: AdminPasscodeRecord }> {
  if (classWritesRefusal()) throw new TestSiteStoreError() // R41: never the live passcode from a test site
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    await casPause(attempt)
    const { value, etag } = await kv.getWithMeta(KEY)
    // A damaged record reads as "none" here, so the screen's null matches and saving repairs it (the etag still guards the write).
    const parsed = parse(value)
    const cur = parsed.state === 'ok' ? parsed.rec : null
    // 'any': the emailed recovery link (its single-use token already guards it).
    if (expectedUpdatedAt !== 'any' && (cur?.updatedAt ?? null) !== (expectedUpdatedAt ?? null)) throw new AdminPasscodeError(409, ADMIN_PASSCODE_MESSAGES.stale)
    const salt = randomBytes(16)
    const hash = (await scrypt(passcode, salt)).toString('base64url')
    const stamp = cur && now.toISOString() <= cur.updatedAt ? new Date(Date.parse(cur.updatedAt) + 1).toISOString() : now.toISOString()
    const rec: AdminPasscodeRecord = {
      v: 1,
      salt: salt.toString('base64url'),
      hash,
      gen: (cur?.gen ?? 0) + 1,
      updatedAt: stamp,
      by,
      history: [{ at: stamp, by }, ...(cur?.history ?? [])].slice(0, HISTORY_CAP),
    }
    // The marker first: if the record lands and the marker doesn't, a later loss of the record must still not bring the old setting back.
    const envSalt = envNow ? randomBytes(12).toString('base64url') : ''
    // M4: remember the earlier settings too (minus this one), so putting an old one back never reopens /admin.
    const before = await readMarker().catch(() => null)
    const earlier = before && before !== 'unparseable' ? envPrints(before).filter((e) => !envNow || fingerprint(envNow, e.salt) !== e.fp) : []
    const marker: Marker = { at: stamp, envSalt, envFp: envNow ? fingerprint(envNow, envSalt) : '', envSeen: earlier.slice(0, ENV_SEEN_CAP) }
    await kv.set(MARKER, JSON.stringify(marker))
    if (await kv.setIfMatch(KEY, JSON.stringify(rec), etag, value !== null)) {
      const state: AdminPasscodeState = { kind: 'set', rec, marker }
      cache = { at: Date.now(), state }
      lastKnown = state
      logger.info('Admin passcode changed', { by: by.name, gen: rec.gen })
      return { rec }
    }
  }
  throw new AdminPasscodeError(503, ADMIN_PASSCODE_MESSAGES.busy)
}

// ---------------------------------------------------------------- M4: a takeover by the hosting setting is told

const TAKEOVER_KEY = 'takeover-told'
/** Settings this server already checked (sha256, never the value), so the check costs one read per server per setting. */
const takeoverChecked = new Set<string>()

/** @internal test-only */
export function _resetTakeoverMemory(): void {
  takeoverChecked.clear()
}

/**
 * The first time any server sees a new ADMIN_PASSCODE take over from the one
 * set in /admin, every owner is emailed and texted: the tripwire for someone
 * with the hosting login, and it tells Catherine which passcode works now.
 * Once per setting (kv `admin-access` `takeover-told` keeps a salted
 * fingerprint, never the value). Never from a test site that shares the live
 * stores (R41: a branch deploy with its own setting isn't a takeover of the
 * live site). Never throws.
 */
export async function noticeEnvTakeover(env: string, now = new Date()): Promise<void> {
  const mem = createHash('sha256').update(`admin-takeover:${env}`).digest('base64url')
  if (takeoverChecked.has(mem)) return
  takeoverChecked.add(mem)
  if (classWritesRefusal()) return
  try {
    let tell = false
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await casPause(attempt)
      const { value, etag } = await kv.getWithMeta(TAKEOVER_KEY)
      let cur: { salt?: string; fp?: string } | null = null
      try { cur = value ? JSON.parse(value) : null } catch { cur = null }
      if (cur && typeof cur.salt === 'string' && cur.fp === takeoverPrint(env, cur.salt)) return
      const salt = randomBytes(12).toString('base64url')
      if (await kv.setIfMatch(TAKEOVER_KEY, JSON.stringify({ salt, fp: takeoverPrint(env, salt), at: now.toISOString() }), etag, value !== null)) {
        tell = true
        break
      }
    }
    if (!tell) return
    logger.error('A new ADMIN_PASSCODE setting took over from the passcode set in /admin')
    const { tellOwners, studioWhen } = await import('@lib/owner-notice')
    await tellOwners({
      subject: '⚠ The /admin passcode was reset from the hosting settings',
      line: `The /admin passcode was reset from the website’s hosting settings (seen ${studioWhen(now)}). The passcode saved in /admin no longer works; the one in the hosting settings does. If none of you did this, sign in and set a new one in /admin › More › Admin access, and change the hosting account’s password.`,
    })
  } catch (err) {
    takeoverChecked.delete(mem)
    logger.warn('Could not check or tell a passcode takeover', { error: err instanceof Error ? err.message : String(err) })
  }
}
