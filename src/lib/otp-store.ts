/**
 * One-time SMS codes gating a returning-customer waiver lookup (HOM-218).
 * Only a HASH of the code is ever persisted — the plaintext is known only to
 * the SMS we send and, briefly, the caller who typed it — so a leaked `otps`
 * blob can't be replayed into an RSVP. Netlify Blobs in prod, `.data/otps/`
 * on disk in dev/test — same KV layer as every other store (@lib/blob-store).
 *
 * Keyed `otp-{recordId}` (one live code per household at a time — a fresh
 * lookup always issues a brand-new code, replacing whatever was there).
 * "Deleting" an entry (on success, lockout, or expiry) writes the JSON
 * literal `null` rather than calling a store-level delete — `KvStore` has no
 * delete method, and a tombstoned `null` is indistinguishable from "never
 * issued" to every reader here, which is all `verifyOtp`/`resendOtp` need.
 */
import { createHash, randomInt } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { makeKvStore } from '@lib/blob-store'

const logger = createLogger('otp-store')
const kv = makeKvStore('otps', 'otps')

export const TTL_MS = 10 * 60 * 1000
export const MAX_ATTEMPTS = 5
export const MAX_SENDS = 3
export const RESEND_COOLDOWN_MS = 60 * 1000

interface OtpState {
  hash: string
  expiresAt: number // epoch ms
  attempts: number
  sends: number
  lastSentAt: number // epoch ms
}

const key = (recordId: string) => `otp-${recordId}`

/** sha256(code + ':' + recordId) — binds the hash to the household so the
 *  same 6 digits issued to two different households never collide. */
export function hashCode(code: string, recordId: string): string {
  return createHash('sha256').update(`${code}:${recordId}`).digest('hex')
}

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

async function read(recordId: string): Promise<{ state: OtpState | null; etag: string | null; exists: boolean }> {
  const { value, etag } = await kv.getWithMeta(key(recordId))
  const state: OtpState | null = value ? JSON.parse(value) : null
  return { state, etag, exists: value !== null }
}

async function write(recordId: string, state: OtpState | null, etag: string | null, exists: boolean): Promise<boolean> {
  return kv.setIfMatch(key(recordId), JSON.stringify(state), etag, exists)
}

/**
 * Issue a brand-new code for this household, replacing anything already
 * stored for it — a fresh lookup always starts a fresh OTP, never a resend.
 * Returns the plaintext code to SMS; only its hash is persisted.
 */
export async function issueOtp(recordId: string, now = Date.now()): Promise<string> {
  const code = newCode()
  const state: OtpState = { hash: hashCode(code, recordId), expiresAt: now + TTL_MS, attempts: 0, sends: 1, lastSentAt: now }
  for (let attempt = 0; attempt < 3; attempt++) {
    const { etag, exists } = await read(recordId)
    if (await write(recordId, state, etag, exists)) return code
  }
  throw new Error('Concurrent update on OTP store — please retry')
}

export type ResendResult =
  | { ok: true; code: string }
  | { ok: false; reason: 'not-found' | 'cooldown' | 'max-sends' }

/**
 * Resend: issues a FRESH code (we never persist the plaintext, so there's no
 * old one to re-send) and resets the wrong-attempt counter — same rule the
 * staff pickup-code "reissue" flow uses (@lib/checkin-store). Gated by the
 * 60s cooldown and 3-sends-per-OTP cap.
 */
export async function resendOtp(recordId: string, now = Date.now()): Promise<ResendResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, etag, exists } = await read(recordId)
    if (!state) return { ok: false, reason: 'not-found' }
    if (now - state.lastSentAt < RESEND_COOLDOWN_MS) return { ok: false, reason: 'cooldown' }
    if (state.sends >= MAX_SENDS) return { ok: false, reason: 'max-sends' }
    const code = newCode()
    const next: OtpState = {
      hash: hashCode(code, recordId),
      expiresAt: now + TTL_MS,
      attempts: 0,
      sends: state.sends + 1,
      lastSentAt: now,
    }
    if (await write(recordId, next, etag, exists)) return { ok: true, code }
    // Lost the CAS race — retry
  }
  throw new Error('Concurrent update on OTP store — please retry')
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'expired' | 'locked' | 'wrong' }

/**
 * Check a typed code against the stored hash. The OTP is consumed (deleted)
 * on success, on expiry, and on the 5th wrong attempt — every one of those
 * outcomes requires the caller to look themselves up again for a new code,
 * never a retry against the same one.
 */
export async function verifyOtp(recordId: string, code: string, now = Date.now()): Promise<VerifyResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state, etag, exists } = await read(recordId)
    if (!state) return { ok: false, reason: 'not-found' }

    if (now > state.expiresAt) {
      if (await write(recordId, null, etag, exists)) return { ok: false, reason: 'expired' }
      continue
    }

    if (hashCode(code, recordId) === state.hash) {
      if (await write(recordId, null, etag, exists)) return { ok: true }
      continue
    }

    const attempts = state.attempts + 1
    if (attempts >= MAX_ATTEMPTS) {
      if (await write(recordId, null, etag, exists)) return { ok: false, reason: 'locked' }
      continue
    }
    if (await write(recordId, { ...state, attempts }, etag, exists)) return { ok: false, reason: 'wrong' }
    // Lost the CAS race — retry
  }
  logger.error('OTP verify gave up after retries', { recordId })
  throw new Error('Concurrent update on OTP store — please retry')
}
