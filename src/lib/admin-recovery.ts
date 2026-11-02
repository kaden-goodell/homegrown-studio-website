/**
 * "Forgot the passcode?" on the /admin sign-in page (M3, TOP RULE: Catherine
 * gets back in without the hosting dashboard).
 *
 *  1. Ask. Anyone on the sign-in page can tap "Email me a link". Nothing is
 *     typed: the link goes to EVERY active Owner's email on the staff list, so
 *     it can't be pointed anywhere else, and every owner sees it was asked for.
 *     An owner made (or whose email changed) in the last 72 hours is skipped
 *     (contactSince): a stolen session that adds its own owner can't use this
 *     to take /admin over, and the real owners were told about that change
 *     (M1). With no staff list yet, or nobody left, the site setup's owner
 *     emails (fixed in the code) get it.
 *  2. The link. 32 random bytes; only sha256 of it is kept, in kv
 *     `admin-access` `recovery:<hash>`: when it runs out (15 minutes), the
 *     passcode generation it belongs to, and whether it was used. A new link
 *     ends the older one; a passcode change (generation moves on) ends it too.
 *  3. Single use, safe from link scanners. Opening the link only shows the
 *     form (Gmail and Outlook open links ahead of time). Submitting a new
 *     passcode uses it up with compare-and-set, then the normal passcode rules
 *     apply, the generation moves on (everyone is signed out) and that device
 *     is signed in.
 *  4. Rate limits in the store, not just memory: 3 links an hour and 10 a day
 *     for the whole site (plus a per-address limit in memory). Wrong or old
 *     links count as wrong passcodes (admin-signin-failures.ts).
 *  5. Audited (admin.recovery-requested / admin.recovery-used, never the
 *     token or an email). When a link is used, every owner gets an email and
 *     a text.
 *  6. Refused on a test site that shares the live stores (R41). On the muted
 *     sandbox preview the email is listed in More › Messages, not sent.
 *
 * Server only.
 */
import { createHash, randomBytes } from 'node:crypto'
import { siteConfig } from '@config/site.config'
import { SITE_URL } from '@config/site-url'
import { makeKvStore } from '@lib/blob-store'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { readAdminPasscode } from '@lib/admin-passcode'

const logger = createLogger('admin-recovery')
const kv = makeKvStore('admin-access', 'admin-access')

export const RECOVERY_TTL_MS = 15 * 60_000
/** An owner newer than this (or with a newer email) doesn't get a link. */
export const RECOVERY_NEW_OWNER_MS = 72 * 60 * 60_000
export const RECOVERY_PER_HOUR = 3
export const RECOVERY_PER_DAY = 10
const CURRENT = 'recovery-current'
const REQUESTS = 'recovery-requests'
const HOUR = 3600_000
const DAY = 24 * HOUR

export const RECOVERY_MESSAGES = {
  sent: 'A link is on its way to every owner’s email on the staff list. It works once, for 15 minutes. Check spam if it isn’t there in a minute.',
  limited: 'Several links were asked for already. Use the newest email, or try again in an hour.',
  used: 'This link was already used. Go to /admin and tap “Forgot the passcode?” for a new one.',
  expired: 'This link has run out (they work for 15 minutes). Go to /admin and tap “Forgot the passcode?” for a new one.',
  unknown: 'This link doesn’t work. Go to /admin and tap “Forgot the passcode?” for a new one.',
  outdated: 'The admin passcode was changed since this link was sent, so it no longer works. Sign in with the new one, or ask for a new link.',
  busy: 'Someone else is using this link at the same moment. Try again.',
  unreadable: 'We couldn’t check the link just now. Try again in a minute.',
} as const

export type RecoveryState = 'ok' | 'used' | 'expired' | 'unknown' | 'outdated'

export class RecoveryError extends Error {
  constructor(public status: number, message: string, public state?: RecoveryState) {
    super(message)
    this.name = 'RecoveryError'
  }
}

interface RecoveryRecord { at: string; exp: number; gen: number; used: boolean; usedAt?: string }

const hashOf = (token: string) => createHash('sha256').update(`admin-recovery:${token}`).digest('base64url')
const keyOf = (hash: string) => `recovery:${hash}`
const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/

/** The passcode generation now: the saved one's, 0 with none saved here, -1 while damaged; null when it can't be read. */
async function currentGen(): Promise<number | null> {
  const state = await readAdminPasscode()
  if (state === 'unreadable') return null
  if (state.kind === 'set') return state.rec.gen
  return state.kind === 'damaged' ? -1 : 0
}

/** The studio's own Netlify site: its previews (`<branch>--<site>.netlify.app`) are fine link targets too. */
const OWN_HOSTS = /^(?:(?:www\.)?ourhometownstudio\.com|(?:[a-z0-9-]+--)?iridescent-croissant-494fc3\.netlify\.app|localhost|127\.0\.0\.1)$/i

/**
 * Where the emailed link points: the address the request came to only when it
 * is the studio's own site (or a preview of it, or this computer); anything
 * else is the public address. A request with a forged Host can never make the
 * email carry a link to someone else's site (reset-link poisoning).
 */
export function recoveryOrigin(requestUrl: string): string {
  try {
    const u = new URL(requestUrl)
    if (OWN_HOSTS.test(u.hostname) && (u.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.origin
  } catch { /* fall through */ }
  return SITE_URL
}

/** Who gets the link: active Owners' staff-list emails (not those made or changed in the last 72 h); else the site setup. */
export async function recoveryRecipients(now = Date.now()): Promise<string[]> {
  try {
    const { savedOwners } = await import('@lib/staff-directory')
    const owners = await savedOwners()
    if (owners) {
      const ok = owners.filter((o) => {
        if (!o.email) return false
        const since = o.contactSince ? Date.parse(o.contactSince) : NaN
        return !Number.isFinite(since) || now - since >= RECOVERY_NEW_OWNER_MS
      })
      const emails = [...new Set(ok.map((o) => o.email!.trim().toLowerCase()))]
      if (emails.length) return emails
    }
  } catch (err) {
    logger.warn('Staff list unreadable for a recovery link; the site setup gets it', { error: err instanceof Error ? err.message : String(err) })
  }
  return [...siteConfig.ownerEmails]
}

/** Counts this request against the site's limits; false when over. */
async function underSiteLimit(now: number): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { value, etag } = await kv.getWithMeta(REQUESTS)
    let times: number[] = []
    try { const j = value ? JSON.parse(value) : null; if (Array.isArray(j?.times)) times = j.times.filter((t: unknown) => typeof t === 'number') } catch { times = [] }
    times = times.filter((t) => now - t < DAY)
    if (times.length >= RECOVERY_PER_DAY || times.filter((t) => now - t < HOUR).length >= RECOVERY_PER_HOUR) return false
    if (await kv.setIfMatch(REQUESTS, JSON.stringify({ times: [...times, now] }), etag, value !== null)) return true
  }
  return false
}

/**
 * Emails a fresh link to the owners. `origin` is the site's address
 * (https://…). Returns 'sent' or 'limited'. Throws TestSiteStoreError (R41)
 * or RecoveryError(503) when the passcode can't be read.
 */
export async function requestRecovery(origin: string, now = new Date()): Promise<'sent' | 'limited'> {
  if (classWritesRefusal()) throw new TestSiteStoreError()
  const t = now.getTime()
  if (!(await underSiteLimit(t))) return 'limited'
  const gen = await currentGen()
  if (gen === null) throw new RecoveryError(503, RECOVERY_MESSAGES.unreadable)
  const token = randomBytes(32).toString('base64url')
  const hash = hashOf(token)
  const rec: RecoveryRecord = { at: now.toISOString(), exp: t + RECOVERY_TTL_MS, gen, used: false }
  await kv.set(keyOf(hash), JSON.stringify(rec))
  // A new link ends the older one.
  const prev = await kv.get(CURRENT)
  await kv.set(CURRENT, hash)
  if (prev && prev !== hash) await kv.set(keyOf(prev), 'null').catch(() => undefined)

  const to = await recoveryRecipients(t)
  const url = `${origin.replace(/\/+$/, '')}/admin/recover?t=${token}`
  const when = now.toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const lines = [
    `Someone asked for a link to set a new /admin passcode (${when}). It went to every owner.`,
    `Set a new admin passcode: ${url}`,
    'It works once, for 15 minutes. Setting a new passcode signs every phone and iPad out of /admin.',
    'If none of you asked for this, ignore it: nothing changes unless someone opens the link and sets a new passcode.',
  ]
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = [
    `<p>${esc(lines[0])}</p>`,
    `<p><a href="${esc(url)}" style="font-weight:600;">Set a new admin passcode</a></p>`,
    `<p>${esc(lines[2])}</p>`,
    `<p style="color:#6b6259;">${esc(lines[3])}</p>`,
  ].join('')
  const { sendEmail } = await import('@lib/email')
  const { sent } = await sendEmail({ to: to.join(', '), subject: 'Set a new /admin passcode (link inside)', text: lines.join('\n\n'), html })
  logger.info('Admin recovery link asked for', { recipients: to.length, sent })
  return 'sent'
}

async function readRecord(token: unknown): Promise<{ hash: string; rec: RecoveryRecord | null; etag: string | null; raw: string | null } | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  const hash = hashOf(token)
  const { value, etag } = await kv.getWithMeta(keyOf(hash))
  let rec: RecoveryRecord | null = null
  try { const j = value ? JSON.parse(value) : null; if (j && typeof j.exp === 'number' && typeof j.gen === 'number') rec = j } catch { rec = null }
  return { hash, rec, etag: etag ?? null, raw: value }
}

function stateOf(rec: RecoveryRecord | null, gen: number, now: number): RecoveryState {
  if (!rec) return 'unknown'
  if (rec.used) return 'used'
  if (now > rec.exp) return 'expired'
  if (rec.gen !== gen) return 'outdated'
  return 'ok'
}

/** What opening the link shows. NEVER uses the link up (scanners open links). */
export async function checkRecovery(token: unknown, now = Date.now()): Promise<RecoveryState> {
  const r = await readRecord(token)
  if (!r) return 'unknown'
  const gen = await currentGen()
  if (gen === null) throw new RecoveryError(503, RECOVERY_MESSAGES.unreadable)
  return stateOf(r.rec, gen, now)
}

/**
 * Uses the link up (compare-and-set). Call only after the new passcode passed
 * every rule. Throws RecoveryError with the reason when it can't be used.
 */
export async function consumeRecovery(token: unknown, now = Date.now()): Promise<void> {
  if (classWritesRefusal()) throw new TestSiteStoreError()
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await readRecord(token)
    if (!r) throw new RecoveryError(400, RECOVERY_MESSAGES.unknown, 'unknown')
    const gen = await currentGen()
    if (gen === null) throw new RecoveryError(503, RECOVERY_MESSAGES.unreadable)
    const state = stateOf(r.rec, gen, now)
    if (state !== 'ok') throw new RecoveryError(state === 'unknown' ? 400 : 410, RECOVERY_MESSAGES[state], state)
    const next: RecoveryRecord = { ...r.rec!, used: true, usedAt: new Date(now).toISOString() }
    if (await kv.setIfMatch(keyOf(r.hash), JSON.stringify(next), r.etag, true)) return
  }
  throw new RecoveryError(409, RECOVERY_MESSAGES.busy)
}

export const recoveryMessage = (state: Exclude<RecoveryState, 'ok'>) => RECOVERY_MESSAGES[state]
