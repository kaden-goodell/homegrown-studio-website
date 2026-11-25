/**
 * Booking alarms ("something broke"), texted to Kaden. Not the injury
 * reports: those are src/lib/incident-store.ts, store 'incidents'.
 * Who gets them and how often: src/config/alerts.ts.
 *
 *   raiseIncident  — a new problem texts now. The same key while it is open
 *                    only counts (a storm of one failure is one text).
 *   resolveIncident — closes it; a "Fixed" text goes out if anything was sent.
 *   ackIncident    — "Got it" link: stops the repeats, keeps counting.
 *   sweepIncidents — run every 5 minutes: repeats urgent unanswered texts
 *                    (every 10 min ×12, then hourly), tells him once an hour
 *                    when an acknowledged one keeps happening, and closes
 *                    problems that have gone quiet.
 *
 * How it reaches him (Kaden, 17 Nov 2026): Pushover first (src/lib/pushover.ts).
 * Urgent incidents go as Pushover emergencies (ring through silent, Pushover
 * repeats them every 5 minutes for an hour; our own repeats then come hourly);
 * heads-ups, "Fixed" and "Still happening" as normal Pushover notes. When
 * Pushover isn't set up or doesn't take it, the old text goes out instead, so
 * nothing is lost. "Got it" stops both (it cancels Pushover's repeats too).
 *
 * Never throws. If the store can't be read or written, it logs loudly and
 * still tries to send the alarm once.
 *
 * Server only.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { quoConfigured, sendQuoText } from '@lib/quo'
import { studioNight } from '@lib/quiet-hours'
import { cancelPushoverReceipt, EMERGENCY_EXPIRE_SECONDS, sendPushover, type PushoverMessage, type PushoverResult } from '@lib/pushover'
import { SITE_URL } from '@config/site-url'
import {
  ALARM_STORE,
  ALERT_PHONE_DEFAULT,
  LIVE_HOSTS,
  QUIET_CLOSE_MINUTES,
  REPEAT_FAST_MINUTES,
  REPEAT_FAST_TIMES,
  REPEAT_SLOW_MINUTES,
} from '@config/alerts'

const logger = createLogger('booking-alarms')
const MIN = 60_000
const PREFIX = 'inc:'

export interface Incident {
  key: string
  text: string
  urgent: boolean
  openedAt: string
  lastAt: string
  /** How many times it has happened while open. */
  count: number
  /** Texts sent for it (first one included). */
  texts: number
  lastTextAt: string | null
  ackedAt: string | null
  /** count when "Got it" was tapped; more after that get an hourly note. */
  countAtAck: number | null
  /** Clears by itself when the thing works again (watchdog, a booking that went through). */
  autoResolve: boolean
  /** How the last alarm about it went out. */
  via?: 'pushover' | 'text'
  /** Pushover emergency receipt: "Got it" cancels Pushover's own repeats. */
  receipt?: string
}

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

interface Deps {
  store: KvStore
  send: (to: string, content: string) => Promise<void>
  push: (m: PushoverMessage) => Promise<PushoverResult>
  cancelPush: (receipt: string) => Promise<boolean>
  now: () => Date
  phone: () => string
  secret: () => string
}

const defaults = (): Deps => ({
  store: makeKvStore(ALARM_STORE, ALARM_STORE),
  send: async (to, content) => {
    // Test runs never text anyone, whatever keys are in .env.
    if (typeof process !== 'undefined' && (process.env.VITEST || process.env.NODE_ENV === 'test')) throw new Error('texts are off in tests')
    if (!quoConfigured()) throw new Error('Quo is not set up (QUO_API_KEY / QUO_FROM_NUMBER)')
    await sendQuoText({ to, content })
  },
  push: sendPushover,
  cancelPush: cancelPushoverReceipt,
  now: () => new Date(),
  phone: () => env('ALERT_PHONE') || ALERT_PHONE_DEFAULT,
  secret: () => env('LOOKUP_SIGNING_SECRET') || 'dev-only-incident-secret',
})
let deps: Deps | null = null
const d = (): Deps => (deps ??= defaults())

/** Tests only. */
export function _setIncidentDeps(over: Partial<Deps> | null): void {
  deps = over ? { ...defaults(), ...over } : null
}

/** Only the live site texts. Previews, branch deploys and localhost stay quiet. */
export function alertsLiveFor(url: string | URL | undefined | null): boolean {
  if (env('ALERTS_FORCE') === '1') return true
  if (!url) return false
  try {
    return LIVE_HOSTS.includes(new URL(String(url)).hostname)
  } catch {
    return false
  }
}

const storeKey = (key: string) => `${PREFIX}${key.replace(/[^A-Za-z0-9:_-]/g, '_').slice(0, 120)}`

export function ackSignature(key: string, openedAt: string): string {
  return createHmac('sha256', d().secret()).update(`ack:${key}:${openedAt}`).digest('hex').slice(0, 20)
}

export function ackUrl(inc: Pick<Incident, 'key' | 'openedAt'>): string {
  return `${SITE_URL}/api/alerts/ack?k=${encodeURIComponent(inc.key)}&s=${ackSignature(inc.key, inc.openedAt)}`
}

export function ackSignatureOk(key: string, openedAt: string, given: string): boolean {
  const want = Buffer.from(ackSignature(key, openedAt))
  const got = Buffer.from(given)
  return want.length === got.length && timingSafeEqual(want, got)
}

async function text(content: string): Promise<boolean> {
  try {
    await d().send(d().phone(), content)
    return true
  } catch (err) {
    logger.error('ALERT TEXT NOT SENT', { error: err instanceof Error ? err.message : String(err), content: content.slice(0, 200) })
    return false
  }
}

/** "BOOKING FAILED (class)" from "BOOKING FAILED (class): Sarah Lee …". */
function titleOf(content: string): string {
  const head = content.split(':')[0].trim()
  return head && head.length <= 60 && head !== content ? head : 'Hometown Studio'
}

interface Delivery { sent: boolean; via?: 'pushover' | 'text'; receipt?: string }

/**
 * Pushover first, the text if that didn't go. `urgent` = emergency priority
 * (rings through silent). `ack` = the "Got it" link: Pushover's link button,
 * or the end of the text.
 */
async function deliver(content: string, opts: { urgent: boolean; ack?: string }): Promise<Delivery> {
  let pushed: PushoverResult = { sent: false }
  try {
    pushed = await d().push({
      title: titleOf(content),
      message: content,
      // Notes (Fixed, Still happening, heads-ups) arrive silently at night; emergencies always ring.
      priority: opts.urgent ? 2 : studioNight(d().now()) ? -1 : 0,
      ...(opts.ack ? { url: opts.ack, urlTitle: 'Got it (stop the alarm)' } : {}),
    })
  } catch (err) {
    logger.error('Pushover alarm failed — texting instead', { error: err instanceof Error ? err.message : String(err) })
  }
  if (pushed.sent) return { sent: true, via: 'pushover', ...(pushed.receipt ? { receipt: pushed.receipt } : {}) }
  const sent = await text(opts.ack ? `${content} Got it: ${opts.ack}` : content)
  return sent ? { sent, via: 'text' } : { sent: false }
}

async function cancelReceipt(inc: Incident): Promise<void> {
  if (!inc.receipt) return
  try {
    await d().cancelPush(inc.receipt)
  } catch (err) {
    logger.warn('Could not stop Pushover repeats', { key: inc.key, error: err instanceof Error ? err.message : String(err) })
  }
}

async function load(key: string): Promise<Incident | null> {
  const raw = await d().store.get(storeKey(key))
  return raw ? (JSON.parse(raw) as Incident) : null
}
async function save(inc: Incident): Promise<void> {
  await d().store.set(storeKey(inc.key), JSON.stringify(inc))
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })

export interface RaiseInput {
  /** Same key = same problem ("class:unavailable", "watchdog"). */
  key: string
  text: string
  /** Repeat until "Got it" is tapped. */
  urgent?: boolean
  /** Close by itself when things work again. Money problems shouldn't. */
  autoResolve?: boolean
}

/** Never throws. Returns whether a text went out. */
export async function raiseIncident(input: RaiseInput): Promise<boolean> {
  const now = d().now().toISOString()
  let existing: Incident | null = null
  try {
    existing = await load(input.key)
  } catch (err) {
    logger.error('INCIDENT STORE UNREADABLE — alarming anyway', { key: input.key, error: String(err) })
    return (await deliver(input.text, { urgent: input.urgent ?? true })).sent
  }
  if (existing) {
    existing.count += 1
    existing.lastAt = now
    try {
      await save(existing)
    } catch (err) {
      logger.error('INCIDENT STORE UNWRITABLE', { key: input.key, error: String(err) })
    }
    return false
  }
  const inc: Incident = {
    key: input.key,
    text: input.text,
    urgent: input.urgent ?? true,
    openedAt: now,
    lastAt: now,
    count: 1,
    texts: 0,
    lastTextAt: null,
    ackedAt: null,
    countAtAck: null,
    autoResolve: input.autoResolve ?? false,
  }
  const out = await deliver(inc.text, { urgent: inc.urgent, ...(inc.urgent ? { ack: ackUrl(inc) } : {}) })
  const sent = out.sent
  if (sent) {
    inc.texts = 1
    inc.lastTextAt = now
    inc.via = out.via
    if (out.receipt) inc.receipt = out.receipt
  }
  try {
    await save(inc)
  } catch (err) {
    logger.error('INCIDENT STORE UNWRITABLE — it will not repeat', { key: input.key, error: String(err) })
  }
  return sent
}

/** Closes it. A "Fixed" text goes out when anything was sent about it. Never throws. */
export async function resolveIncident(key: string, fixedText?: string): Promise<boolean> {
  try {
    const inc = await load(key)
    if (!inc) return false
    await d().store.delete(storeKey(key))
    await cancelReceipt(inc)
    if (inc.texts > 0) await deliver(fixedText ?? `Fixed: ${short(inc.text)} (${inc.count} time${inc.count === 1 ? '' : 's'} since ${clock(inc.openedAt)}).`, { urgent: false })
    return true
  } catch (err) {
    logger.error('Could not resolve incident', { key, error: String(err) })
    return false
  }
}

/** Closes every open incident whose key starts with `prefix` and that clears by itself. */
export async function resolveIncidentsLike(prefix: string, fixedText: (inc: Incident) => string): Promise<number> {
  let closed = 0
  try {
    const keys = await d().store.list(storeKey(prefix))
    for (const k of keys) {
      const raw = await d().store.get(k)
      if (!raw) continue
      const inc = JSON.parse(raw) as Incident
      if (!inc.autoResolve) continue
      if (await resolveIncident(inc.key, fixedText(inc))) closed += 1
    }
  } catch (err) {
    logger.error('Could not resolve incidents', { prefix, error: String(err) })
  }
  return closed
}

/** "Got it": no more repeats. True when the link matched an open incident. */
export async function ackIncident(key: string, signature: string): Promise<boolean> {
  try {
    const inc = await load(key)
    if (!inc || !ackSignatureOk(inc.key, inc.openedAt, signature)) return false
    if (!inc.ackedAt) {
      inc.ackedAt = d().now().toISOString()
      inc.countAtAck = inc.count
      await save(inc)
      // And stop Pushover's own emergency repeats.
      await cancelReceipt(inc)
    }
    return true
  } catch (err) {
    logger.error('Could not acknowledge incident', { key, error: String(err) })
    return false
  }
}

function short(t: string): string {
  const first = t.split(/(?<=[.:])\s/)[0]
  return first.length > 120 ? `${first.slice(0, 119)}…` : first
}

/** Run every 5 minutes. Never throws. */
export async function sweepIncidents(): Promise<{ open: number; repeated: number; closed: number }> {
  const out = { open: 0, repeated: 0, closed: 0 }
  let keys: string[] = []
  try {
    keys = await d().store.list(PREFIX)
  } catch (err) {
    logger.error('INCIDENT STORE UNREADABLE — repeats skipped', { error: String(err) })
    return out
  }
  const now = d().now()
  for (const k of keys) {
    let inc: Incident
    try {
      const raw = await d().store.get(k)
      if (!raw) continue
      inc = JSON.parse(raw) as Incident
    } catch (err) {
      logger.error('Incident unreadable', { key: k, error: String(err) })
      continue
    }
    const sinceLast = now.getTime() - Date.parse(inc.lastAt)
    // Gone quiet: close without a text (a "Fixed" would be a guess).
    if (inc.autoResolve && sinceLast >= QUIET_CLOSE_MINUTES * MIN && !inc.key.startsWith('watchdog')) {
      await d().store.delete(k).catch(() => undefined)
      out.closed += 1
      continue
    }
    out.open += 1
    const sinceText = inc.lastTextAt ? now.getTime() - Date.parse(inc.lastTextAt) : Infinity
    if (inc.ackedAt) {
      // Acknowledged: one note an hour while it keeps happening.
      const more = inc.count - (inc.countAtAck ?? inc.count)
      if (more > 0 && sinceText >= REPEAT_SLOW_MINUTES * MIN) {
        if ((await deliver(`Still happening: ${short(inc.text)} ${more} more since you tapped Got it.`, { urgent: false })).sent) {
          inc.countAtAck = inc.count
          inc.lastTextAt = now.toISOString()
          inc.texts += 1
          out.repeated += 1
          await save(inc).catch(() => undefined)
        }
      }
      // An acknowledged money problem with nothing new for a day is done.
      if (!inc.autoResolve && sinceLast >= 24 * 60 * MIN) {
        await d().store.delete(k).catch(() => undefined)
        out.closed += 1
        out.open -= 1
      }
      continue
    }
    if (!inc.urgent) continue
    // A Pushover emergency already rings every 5 minutes for an hour by
    // itself: ours comes again once that has run out. A text repeats on our own
    // schedule (every 10 minutes, then hourly).
    const every = inc.via === 'pushover'
      ? Math.max(EMERGENCY_EXPIRE_SECONDS * 1000, REPEAT_SLOW_MINUTES * MIN)
      : (inc.texts <= REPEAT_FAST_TIMES ? REPEAT_FAST_MINUTES : REPEAT_SLOW_MINUTES) * MIN
    if (sinceText < every) continue
    const times = inc.count === 1 ? '' : ` (${inc.count} times since ${clock(inc.openedAt)})`
    const again = await deliver(`STILL BROKEN${times}: ${inc.text}`, { urgent: true, ack: ackUrl(inc) })
    if (again.sent) {
      inc.texts += 1
      inc.lastTextAt = now.toISOString()
      inc.via = again.via
      if (again.receipt) inc.receipt = again.receipt
      else delete inc.receipt
      out.repeated += 1
      await save(inc).catch(() => undefined)
    }
  }
  return out
}
