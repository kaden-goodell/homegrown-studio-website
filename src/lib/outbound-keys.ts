/**
 * The Gmail app password and the Quo key, pasted in /admin › More › Email,
 * texts and Square (bus factor: Catherine renews them without the hosting
 * dashboard). NEVER the Square token: it can send payments elsewhere and
 * doesn't run out by itself, so it stays in the hosting settings.
 *
 *  - Only the secret part: the sending Google account (GMAIL_USER) and the
 *    studio's Quo number (QUO_FROM_NUMBER) stay fixed in the site setup, so a
 *    pasted key can only be the studio's own (the Quo key is checked against
 *    the studio number before it can be saved).
 *  - Encrypted at rest: AES-256-GCM with a key derived (HKDF) from the
 *    server-only LOOKUP_SIGNING_SECRET, with its own info string. Without
 *    that setting nothing can be saved (fail closed) and the site setup's
 *    keys are used.
 *  - A saved key wins over the site setup's. One that can't be decrypted
 *    (the setting changed, or the record is damaged) is ignored: the site
 *    setup's is used and the screen says so.
 *  - Never shown back, never logged, never in the audit or the archive.
 *  - Saved only after "Test it" worked with that exact key in the last 15
 *    minutes (a fingerprint is kept for that, never the key).
 *  - Refused on a test site that shares the live stores (R41).
 *
 * One record per service in kv `outbound-keys`. Server only.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'

const logger = createLogger('outbound-keys')
const kv = makeKvStore('outbound-keys', 'outbound-keys')

export const KEY_SERVICES = ['gmail', 'quo'] as const
export type KeyService = (typeof KEY_SERVICES)[number]

/** How long a passing "Test it" counts for saving that same key. */
export const TESTED_FOR_MS = 15 * 60_000
const CACHE_MS = 30_000
const HISTORY_CAP = 20

interface KeyRecord {
  v: 1
  iv: string
  ct: string
  tag: string
  updatedAt: string
  by: By
  history: { at: string; by: By }[]
}

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The encryption key, or null when LOOKUP_SIGNING_SECRET isn't set (then nothing is stored or read). */
function secretKey(): Buffer | null {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return null
  return Buffer.from(hkdfSync('sha256', secret, 'hometown-studio', 'outbound-keys v1', 32))
}

/** Whether this site can keep a pasted key safely. */
export function canStoreKeys(): boolean {
  return secretKey() !== null
}

function encrypt(value: string, key: Buffer): { iv: string; ct: string; tag: string } {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(value, 'utf8'), c.final()])
  return { iv: iv.toString('base64url'), ct: ct.toString('base64url'), tag: c.getAuthTag().toString('base64url') }
}

function decrypt(rec: KeyRecord, key: Buffer): string | null {
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64url'))
    d.setAuthTag(Buffer.from(rec.tag, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(rec.ct, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

function parse(json: string | null): KeyRecord | null | 'invalid' {
  if (!json || json === 'null') return null
  try {
    const r = JSON.parse(json)
    return r && typeof r.iv === 'string' && typeof r.ct === 'string' && typeof r.tag === 'string' && typeof r.updatedAt === 'string' ? (r as KeyRecord) : 'invalid'
  } catch {
    return 'invalid'
  }
}

const cache = new Map<KeyService, { at: number; value: string | null }>()

/** @internal test-only: forget this server's memory of the saved keys. */
export function _forgetKeyCacheForTests(): void {
  cache.clear()
}

/** @internal test-only */
export async function _resetOutboundKeysForTests(): Promise<void> {
  cache.clear()
  for (const s of KEY_SERVICES) {
    await kv.set(s, 'null')
    await kv.set(`tested:${s}`, 'null')
  }
}

/**
 * Sync: true when this server has already seen a key saved in /admin for the
 * service (the quick "is it set up?" checks). The async checks
 * (emailReadyNow / quoReadyNow) always read the store.
 */
export function storedKeyKnown(service: KeyService): boolean {
  return !!cache.get(service)?.value
}

/** The saved key for a service, or null (none saved, can't be decrypted, or no secret): the site setup's is used then. Never throws. */
export async function storedKey(service: KeyService): Promise<string | null> {
  const c = cache.get(service)
  if (c && Date.now() - c.at < CACHE_MS) return c.value
  const key = secretKey()
  let value: string | null = null
  if (key) {
    try {
      const rec = parse(await kv.get(service))
      if (rec && rec !== 'invalid') {
        value = decrypt(rec, key)
        if (value === null) logger.error('A key saved in /admin can’t be decrypted; using the site setup’s', { service })
      }
    } catch (err) {
      logger.warn('Saved keys unreadable; using the site setup’s', { service, error: err instanceof Error ? err.message : String(err) })
      return c?.value ?? null // a store blip keeps the last good answer
    }
  }
  cache.set(service, { at: Date.now(), value })
  return value
}

export interface KeyStatus {
  /** A key was saved in /admin (and is in use when it decrypts). */
  setInAdmin: boolean
  updatedAt: string | null
  by: string | null
  /** Saved but can't be decrypted or read: the site setup's is in use. */
  broken: boolean
}

/** What the screen shows. Never the key. */
export async function keyStatus(service: KeyService): Promise<KeyStatus> {
  try {
    const rec = parse(await kv.get(service))
    if (!rec) return { setInAdmin: false, updatedAt: null, by: null, broken: false }
    if (rec === 'invalid') return { setInAdmin: true, updatedAt: null, by: null, broken: true }
    const key = secretKey()
    return { setInAdmin: true, updatedAt: rec.updatedAt, by: rec.by?.name ?? null, broken: !key || decrypt(rec, key) === null }
  } catch {
    return { setInAdmin: false, updatedAt: null, by: null, broken: true }
  }
}

const fingerprint = (service: KeyService, value: string, key: Buffer) => createHmac('sha256', key).update(`tested:${service}:${value}`).digest('base64url')

/** Remember that "Test it" worked with this exact key (a fingerprint, never the key). */
export async function noteTested(service: KeyService, value: string, now = Date.now()): Promise<void> {
  const key = secretKey()
  if (!key || classWritesRefusal()) return
  await kv.set(`tested:${service}`, JSON.stringify({ fp: fingerprint(service, value, key), at: now }))
}

/** True when "Test it" worked with this exact key in the last 15 minutes. */
export async function wasTested(service: KeyService, value: string, now = Date.now()): Promise<boolean> {
  const key = secretKey()
  if (!key) return false
  try {
    const raw = await kv.get(`tested:${service}`)
    const j = raw ? JSON.parse(raw) : null
    return !!j && typeof j.at === 'number' && now - j.at <= TESTED_FOR_MS && j.fp === fingerprint(service, value, key)
  } catch {
    return false
  }
}

export class KeyStoreError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'KeyStoreError'
  }
}

/** Saves a key (encrypted). The caller checks the passcode and that it was tested. */
export async function saveKey(service: KeyService, value: string, by: By, now = new Date()): Promise<{ updatedAt: string }> {
  if (classWritesRefusal()) throw new TestSiteStoreError() // R41
  const key = secretKey()
  if (!key) throw new KeyStoreError(503, 'This site can’t keep keys safely yet (a setting is missing), so use the steps under What to do.')
  const prev = parse(await kv.get(service).catch(() => null))
  const history = prev && prev !== 'invalid' && Array.isArray(prev.history) ? prev.history : []
  const updatedAt = now.toISOString()
  const rec: KeyRecord = { v: 1, ...encrypt(value, key), updatedAt, by, history: [{ at: updatedAt, by }, ...history].slice(0, HISTORY_CAP) }
  await kv.set(service, JSON.stringify(rec))
  await kv.set(`tested:${service}`, 'null') // a test counts for one save
  cache.set(service, { at: Date.now(), value })
  logger.info('Key saved in /admin', { service, by: by.name })
  return { updatedAt }
}
