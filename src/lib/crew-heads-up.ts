/**
 * Owners hear about every crew refund, comp and gift card (final crew review
 * I6, DV19). Crew keep the power (refunds with a reason, comps, giveaway
 * cards: no new limits); the owners simply always find out.
 *
 * `recordAudit` hands every crew entry here. A watched one becomes one line
 * ("Sam refunded $85.00 on Pottery Sat: “no-show”") in a small queue. The
 * queue goes to the owners picked in /admin › More › Notifications, a text
 * ('owner-texts') and an email ('warnings-email'), AT MOST once an hour: the
 * first crew action after a quiet hour goes at once, later ones wait and go
 * together (the hourly job, netlify/functions/crew-heads-up.ts, sends what's
 * waiting). Never throws: an alert never fails the action.
 *
 * Server only.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { afterReply } from '@lib/after-reply'
import { alertOwners } from '@lib/owner-alert'
import { emailsFor } from '@lib/notify-settings'
import { sendEmail } from '@lib/email'
import { activityWhat } from '@lib/activity'
import type { AuditEntry } from '@lib/audit'

const logger = createLogger('crew-heads-up')
const kv = makeKvStore('crew-heads-up', 'crew-heads-up')
const KEY = 'queue'

/** At most one heads-up an hour. */
export const HEADS_UP_EVERY_MS = 60 * 60_000
/** Lines kept waiting at most (a runaway loop can't grow it forever). */
const QUEUE_CAP = 200

/** The crew actions the owners always hear about. */
export const HEADS_UP_ACTIONS: ReadonlySet<string> = new Set([
  'class-refund', 'party-refund', 'seat.reader-refund', 'class-paid-not-seated-refund', 'party-paid-elsewhere-refund',
  'seat.comped', 'gift-card.minted',
])

export interface HeadsUpLine { at: string; line: string }
interface Queue { pending: HeadsUpLine[]; lastSentAt: string | null }

/** The line for an entry, or null when the owners aren't told about it. */
export function headsUpLine(e: AuditEntry): string | null {
  if (e.simulated === true) return null
  if (e.by?.role !== 'crew') return null
  if (!HEADS_UP_ACTIONS.has(e.action)) return null
  const what = activityWhat(e)
  return `${e.by.name}: ${what[0].toLowerCase()}${what.slice(1)}`
}

function parse(value: string | null): Queue {
  if (!value) return { pending: [], lastSentAt: null }
  try {
    const q = JSON.parse(value)
    return { pending: Array.isArray(q?.pending) ? q.pending : [], lastSentAt: typeof q?.lastSentAt === 'string' ? q.lastSentAt : null }
  } catch {
    return { pending: [], lastSentAt: null }
  }
}

async function change<T>(fn: (q: Queue) => { next: Queue | null; result: T }): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, etag } = await kv.getWithMeta(KEY)
    const { next, result } = fn(parse(value))
    if (!next) return result
    if (await kv.setIfMatch(KEY, JSON.stringify(next), etag, value !== null)) return result
  }
  throw new Error('crew heads-up queue busy')
}

const due = (q: Queue, now: Date) => !q.lastSentAt || now.getTime() - Date.parse(q.lastSentAt) >= HEADS_UP_EVERY_MS

/** Called by recordAudit for every entry. Never throws. */
export async function noteCrewAction(e: AuditEntry, now = new Date()): Promise<void> {
  const line = headsUpLine(e)
  if (!line) return
  try {
    const sendNow = await change((q) => ({
      next: { ...q, pending: [...q.pending, { at: e.at || now.toISOString(), line }].slice(-QUEUE_CAP) },
      result: due(q, now),
    }))
    if (sendNow) await afterReply(() => flushCrewHeadsUp(now))
  } catch (err) {
    logger.error('Crew heads-up not queued', { action: e.action, error: err instanceof Error ? err.message : String(err) })
  }
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** The text and email for some lines. */
export function headsUpMessage(lines: HeadsUpLine[]): { text: string; subject: string; body: string; html: string } {
  const one = lines.length === 1
  const text = one
    ? `Crew heads-up: ${lines[0].line}. Admin › More › Activity has the details.`
    : `Crew heads-up, ${lines.length} things: ${lines.map((l) => l.line).join('; ')}. Admin › More › Activity has the details.`
  const subject = one ? 'Crew heads-up: 1 refund, comp or gift card' : `Crew heads-up: ${lines.length} refunds, comps or gift cards`
  const rows = lines.map((l) => `${when(l.at)}: ${l.line}`)
  const body = `What the crew did:\n\n${rows.join('\n')}\n\nAll of it is in /admin › More › Activity.`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const html = `<p>What the crew did:</p><ul>${rows.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><p>All of it is in /admin › More › Activity.</p>`
  return { text, subject, body, html }
}

/**
 * Sends what's waiting, if an hour has passed since the last heads-up (or
 * `force`). Lines are taken off the queue first (two runs never send the same
 * line twice); if neither the text nor the email went, they go back.
 */
export async function flushCrewHeadsUp(now = new Date(), opts: { force?: boolean } = {}): Promise<{ sent: number; text: boolean; email: boolean }> {
  let taken: HeadsUpLine[] = []
  try {
    taken = await change((q) => {
      if (!q.pending.length || (!opts.force && !due(q, now))) return { next: null, result: [] as HeadsUpLine[] }
      return { next: { pending: [], lastSentAt: now.toISOString() }, result: q.pending }
    })
  } catch (err) {
    logger.error('Crew heads-up queue unreadable', { error: err instanceof Error ? err.message : String(err) })
    return { sent: 0, text: false, email: false }
  }
  if (!taken.length) return { sent: 0, text: false, email: false }
  const msg = headsUpMessage(taken)
  const [text, email] = await Promise.all([
    alertOwners(msg.text).then((r) => r.sent > 0).catch(() => false),
    emailsFor('warnings-email')
      .then((to) => (to ? sendEmail({ to, subject: msg.subject, text: msg.body, html: msg.html }).then((r) => r.sent) : false))
      .catch(() => false),
  ])
  if (!text && !email) {
    logger.warn('Crew heads-up reached nobody; kept for the next run', { lines: taken.length })
    await change((q) => ({ next: { ...q, pending: [...taken, ...q.pending].slice(-QUEUE_CAP) }, result: null })).catch(() => undefined)
    return { sent: 0, text, email }
  }
  logger.info('Crew heads-up sent', { lines: taken.length, text, email })
  return { sent: taken.length, text, email }
}

/** What's waiting (tests, and the hourly job's log). */
export async function pendingHeadsUp(): Promise<HeadsUpLine[]> {
  return parse(await kv.get(KEY)).pending
}

export async function _resetHeadsUpForTests(): Promise<void> {
  await kv.set(KEY, JSON.stringify({ pending: [], lastSentAt: null }))
}
