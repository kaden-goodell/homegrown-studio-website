/**
 * Are emails, texts and Square calls getting through? (G2)
 *
 * Every send or call reports how it went: email.ts (Gmail), quo.ts (texts)
 * and the Square calls (classes/square-api.ts and the Square SDK client, only
 * when Square refuses the site's key itself: squareAnswerKind). One small record per service
 * in kv `outbound-health`: since when it has been failing, how many in a row,
 * auth (the key or password was refused) or other (network, Square/Google
 * hiccup), and when it last worked. A success clears it. Never the message,
 * the address or the key.
 *
 * Home shows a warning (with Send me a test email / Send me a test text /
 * Check Square and What to do) while one is failing, so it never depends on
 * email working. The moment one starts failing, the owners also hear by the
 * other way: a text when emails stop, an email when texts stop, both for
 * Square. At most once per service per 12 hours (ALERT_GAP_MS), however
 * often it flaps.
 *
 * Best effort: nothing here ever throws or slows a send down beyond one small
 * read a minute. Never written from a test site that shares the live stores
 * (R41).
 *
 * Server only.
 */
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { CAS_ATTEMPTS, casPause } from '@lib/cas-retry'

const logger = createLogger('outbound-health')

export const SERVICES = ['email', 'text', 'square'] as const
export type Service = (typeof SERVICES)[number]
export type FailureKind = 'auth' | 'other'

export interface HealthRecord {
  /** First failure of the current run; null while working. */
  failingSince: string | null
  lastFailureAt: string | null
  lastOkAt: string | null
  /** Failures in a row. */
  count: number
  kind: FailureKind | null
  /** When the owners were told by the other way, for this run. */
  toldAt: string | null
  /** The last time the owners were told about this service, kept when a run clears (H1: at most one alert per 12 hours). */
  lastToldAt: string | null
}

const EMPTY: HealthRecord = { failingSince: null, lastFailureAt: null, lastOkAt: null, count: 0, kind: null, toldAt: null, lastToldAt: null }

/** At most one "the other way" alert per service in this long, however often it flaps (H1: Kaden, "you're blowing up my phone"). */
export const ALERT_GAP_MS = 12 * 60 * 60_000

let store: KvStore | null = null
const kv = (): KvStore => (store ??= makeKvStore('outbound-health', 'outbound-health'))

/** What this server last knew, so a success costs nothing while all is well. */
const known = new Map<Service, { failing: boolean; at: number }>()
const KNOWN_MS = 60_000

/** @internal test-only */
export function _resetHealthMemory(): void {
  known.clear()
}

/** @internal test-only: forget every record. */
export async function _resetHealthForTests(): Promise<void> {
  known.clear()
  for (const s of SERVICES) await kv().set(s, 'null')
}

function parse(json: string | null): HealthRecord | null {
  if (!json) return null
  try {
    const r = JSON.parse(json)
    if (!r || typeof r !== 'object' || typeof r.count !== 'number') return null
    return { ...EMPTY, ...r }
  } catch {
    return null
  }
}

/** True when a run of failures is worth a warning: a refused key or password at once; anything else after two in a row. */
export function isFailing(r: HealthRecord | null): boolean {
  if (!r || !r.failingSince) return false
  return r.kind === 'auth' ? r.count >= 1 : r.count >= 2
}

/** Connection-level nodemailer codes: Gmail itself can't be reached or dropped us. */
const EMAIL_CONNECTION_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'])

/**
 * Does a Gmail error mean emails aren't going out? A refused login (EAUTH,
 * 534/535) is auth; Gmail unreachable or saying "try later" (connection
 * codes, 421/454, 4.4.x/5.4.x) is other; anything else is null and doesn't
 * count (H1): a rejected recipient (EENVELOPE, 550–553) is one customer's
 * odd address, not the service failing, and a customer can type one.
 */
export function emailFailureKind(err: unknown): FailureKind | null {
  const e = err as { code?: unknown; responseCode?: unknown; message?: unknown; response?: unknown } | null
  if (!e) return null
  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) return 'auth'
  if (typeof e.message === 'string' && /Invalid login|Username and Password not accepted|BadCredentials/i.test(e.message)) return 'auth'
  if (e.code === 'EENVELOPE') return null
  if (typeof e.code === 'string' && EMAIL_CONNECTION_CODES.has(e.code)) return 'other'
  if (e.responseCode === 421 || e.responseCode === 454) return 'other'
  const text = `${typeof e.response === 'string' ? e.response : ''} ${typeof e.message === 'string' ? e.message : ''}`
  if (/\b[45]\.4\.\d{1,3}\b/.test(text)) return 'other'
  return null
}

/** An HTTP status from Quo: 401/403 are auth. */
export const statusKind = (status: number): FailureKind => (status === 401 || status === 403 ? 'auth' : 'other')

/** Square error codes that mean the site's key itself is refused (H1). */
const SQUARE_KEY_REFUSED = new Set(['UNAUTHORIZED', 'ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_REVOKED'])

/**
 * How a Square answer counts (H1): 'refused' only when Square refuses the
 * site's key (401, or a 403 whose first error is UNAUTHORIZED /
 * ACCESS_TOKEN_EXPIRED / ACCESS_TOKEN_REVOKED); 'ignore' for any other 403
 * (a permission the key lacks for one endpoint, e.g. INSUFFICIENT_SCOPES,
 * says nothing about the key working); 'ok' for every other answer.
 */
export function squareAnswerKind(status: number, body: unknown): 'refused' | 'ignore' | 'ok' {
  if (status === 401) return 'refused'
  if (status !== 403) return 'ok'
  const code = (body as { errors?: { code?: unknown }[] } | null)?.errors?.[0]?.code
  return typeof code === 'string' && SQUARE_KEY_REFUSED.has(code) ? 'refused' : 'ignore'
}

/** Report one Square answer to the health record. Never throws. */
export async function noteSquareAnswer(status: number, body: unknown): Promise<void> {
  const k = squareAnswerKind(status, body)
  if (k === 'refused') await noteFailure('square', 'auth')
  else if (k === 'ok') await noteOk('square')
}

/** Count one failure. Never throws. */
export async function noteFailure(service: Service, kind: FailureKind, now = new Date()): Promise<void> {
  if (classWritesRefusal()) return
  let becameFailing = false
  let rec: HealthRecord | null = null
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await casPause(attempt)
      const { value, etag } = await kv().getWithMeta(service)
      const cur = parse(value) ?? EMPTY
      const next: HealthRecord = {
        ...cur,
        failingSince: cur.failingSince ?? now.toISOString(),
        lastFailureAt: now.toISOString(),
        count: Math.min(cur.count + 1, 10_000),
        kind: kind === 'auth' || cur.kind === 'auth' ? 'auth' : 'other',
      }
      if (isFailing(next) && !cur.toldAt) {
        // One alert per service per 12 hours, whatever happens in between (a fail → ok → fail flap is still one).
        const quiet = cur.lastToldAt && now.getTime() - Date.parse(cur.lastToldAt) < ALERT_GAP_MS
        becameFailing = !quiet
        next.toldAt = quiet ? cur.lastToldAt : now.toISOString()
        if (!quiet) next.lastToldAt = now.toISOString()
      } else becameFailing = false
      if (await kv().setIfMatch(service, JSON.stringify(next), etag, value !== null)) {
        rec = next
        known.set(service, { failing: true, at: Date.now() })
        break
      }
    }
  } catch (err) {
    logger.warn('Could not note a send failure', { service, error: err instanceof Error ? err.message : String(err) })
    return
  }
  if (rec && becameFailing) {
    logger.error('Outbound service failing', { service, kind: rec.kind, since: rec.failingSince })
    await tellOwnersTheOtherWay(service, rec).catch(() => undefined)
  }
}

/** A send or call worked: clears a failure run. Costs one read a minute at most while all is well. Never throws. */
export async function noteOk(service: Service, now = new Date()): Promise<void> {
  if (classWritesRefusal()) return
  const k = known.get(service)
  if (k && !k.failing && Date.now() - k.at < KNOWN_MS) return
  try {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      await casPause(attempt)
      const { value, etag } = await kv().getWithMeta(service)
      const cur = parse(value)
      if (!cur || !cur.failingSince) {
        known.set(service, { failing: false, at: Date.now() })
        return
      }
      const next: HealthRecord = { ...cur, failingSince: null, count: 0, kind: null, toldAt: null, lastOkAt: now.toISOString() }
      if (await kv().setIfMatch(service, JSON.stringify(next), etag, true)) {
        known.set(service, { failing: false, at: Date.now() })
        logger.info('Outbound service working again', { service })
        return
      }
    }
  } catch (err) {
    logger.warn('Could not note a send that worked', { service, error: err instanceof Error ? err.message : String(err) })
  }
}

export interface ServiceHealth {
  /** 'ok', 'failing' (warn), 'not-set' (no key or password on this site), 'unknown' (couldn't read). */
  state: 'ok' | 'failing' | 'not-set' | 'unknown'
  since: string | null
  kind: FailureKind | null
  count: number
  lastOkAt: string | null
}

/** Each service now. `configured` = whether its key or password is set on this site. Never throws. */
export async function healthStatus(configured: Record<Service, boolean>): Promise<Record<Service, ServiceHealth>> {
  const out = {} as Record<Service, ServiceHealth>
  await Promise.all(SERVICES.map(async (s) => {
    if (!configured[s]) {
      out[s] = { state: 'not-set', since: null, kind: null, count: 0, lastOkAt: null }
      return
    }
    try {
      const r = parse(await kv().get(s))
      out[s] = { state: isFailing(r) ? 'failing' : 'ok', since: r?.failingSince ?? null, kind: r?.kind ?? null, count: r?.count ?? 0, lastOkAt: r?.lastOkAt ?? null }
    } catch {
      out[s] = { state: 'unknown', since: null, kind: null, count: 0, lastOkAt: null }
    }
  }))
  return out
}

/** "Tue 3:10 PM" at the studio. */
export function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

const ADMIN_PLACE = '/admin › More › Email, texts and Square'

/** One plain line per failing service (the owner text, the other-way email, the morning email). */
export function failingLine(service: Service, h: { since: string | null }): string {
  const since = h.since ? ` since ${whenLabel(h.since)}` : ''
  if (service === 'email') return `Emails from the website aren’t going out${since}. Customers aren’t getting confirmations, payment links or refund emails. See ${ADMIN_PLACE}.`
  if (service === 'text') return `Texts from the website aren’t going out${since}. See ${ADMIN_PLACE}.`
  return `Square is refusing the website${since}, so bookings, payments and refunds can’t go through online. See ${ADMIN_PLACE}.`
}

/** The moment a service starts failing: tell the owners by a way that still works. */
async function tellOwnersTheOtherWay(service: Service, rec: HealthRecord): Promise<void> {
  const line = failingLine(service, { since: rec.failingSince })
  if (service !== 'text') {
    const { alertOwners } = await import('@lib/owner-alert')
    await alertOwners(`Hometown Studio: ${line}`).catch(() => undefined)
  }
  if (service !== 'email') {
    const [{ sendEmail }, { emailsFor }] = await Promise.all([import('@lib/email'), import('@lib/notify-settings')])
    const to = await emailsFor('warnings-email')
    const subject = service === 'text' ? '⚠ Texts from the website aren’t going out' : '⚠ Square is refusing the website'
    await sendEmail({ to, subject, text: line, html: `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` }).catch(() => undefined)
  }
}
