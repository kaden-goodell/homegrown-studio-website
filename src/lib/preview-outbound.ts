/**
 * Email and texts from test sites.
 *
 * The sandbox preview (STORE_NAMESPACE set AND Square in the sandbox, never a
 * production deploy) sends NOTHING: every email and text is dropped, written to
 * a small list the owners can read on that site (/admin › More › Messages) and
 * to the log, and the caller is told it was sent so flows carry on. Kaden's
 * rule (2 Nov 2026): no emails or texts from tests. PREVIEW_MESSAGES=on turns
 * sending back on for that preview, and then every message goes to Kaden only,
 * marked with who it was meant for (his rule: test texts only to (402) 980-2907).
 *
 * Production (no STORE_NAMESPACE, Square live, CONTEXT=production) is untouched:
 * every real email and text goes exactly as before.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { deployContext, type DeployContext } from '@lib/deploy-context'

export const PREVIEW_EMAIL_TO = 'kaden.goodell@gmail.com'
export const PREVIEW_SMS_TO = '+14029802907'

export type OutboundEnv = {
  STORE_NAMESPACE?: string
  SQUARE_ENVIRONMENT?: string
  CONTEXT?: string
  PREVIEW_MESSAGES?: string
}

const logger = createLogger('preview-outbound')

function previewNamespace(env: OutboundEnv): string {
  return (env.STORE_NAMESPACE ?? '').trim()
}

/** The process env (server side), for the senders. */
export function outboundEnv(): OutboundEnv {
  return typeof process !== 'undefined' ? (process.env as OutboundEnv) : {}
}

/**
 * A Netlify deploy preview or branch deploy with NO store namespace of its own
 * (M9): it shares the live stores, so anything it sends would reach real
 * customers. It is muted like the sandbox preview, whatever its Square.
 */
function bareTestSite(env: OutboundEnv, context: DeployContext): boolean {
  if (previewNamespace(env)) return false
  const fromEnv = (env.CONTEXT ?? '').trim()
  if (fromEnv === 'production') return false
  return fromEnv === 'deploy-preview' || fromEnv === 'branch-deploy' || context === 'deploy-preview' || context === 'branch-deploy'
}

function messagesOn(env: OutboundEnv): boolean {
  return (env.PREVIEW_MESSAGES ?? '').trim().toLowerCase() === 'on'
}

/**
 * True on the sandbox preview: a store namespace of its own, Square in the
 * sandbox (unset counts as sandbox, as the site's Square config reads it), and
 * not a production deploy, unless PREVIEW_MESSAGES is 'on'. Also true on any
 * preview or branch deploy without a namespace (M9).
 */
export function messagesMuted(env: OutboundEnv = outboundEnv(), context: DeployContext = deployContext()): boolean {
  if (bareTestSite(env, context)) return !messagesOn(env)
  if (!previewNamespace(env)) return false
  if ((env.CONTEXT ?? '').trim() === 'production') return false
  if (((env.SQUARE_ENVIRONMENT ?? '').trim() || 'sandbox') !== 'sandbox') return false
  return !messagesOn(env)
}

/** The label a rerouted message carries: the namespace, or 'test-site' for a bare preview. */
function rerouteLabel(env: OutboundEnv, context: DeployContext): string {
  return previewNamespace(env) || (bareTestSite(env, context) ? 'test-site' : '')
}

export function previewEmail<T extends { to: string; subject: string }>(msg: T, env: OutboundEnv, context: DeployContext = deployContext()): T {
  const ns = rerouteLabel(env, context)
  if (!ns) return msg
  return { ...msg, to: PREVIEW_EMAIL_TO, subject: `[${ns} → ${msg.to}] ${msg.subject}` }
}

export function previewText(msg: { to: string; content: string }, env: OutboundEnv, context: DeployContext = deployContext()): { to: string; content: string } {
  const ns = rerouteLabel(env, context)
  if (!ns) return msg
  return { to: PREVIEW_SMS_TO, content: `[${ns} → ${msg.to}] ${msg.content}` }
}

// ---------------------------------------------------------------- the muted list

/** One message the sandbox preview would have sent. */
export interface MutedMessage {
  id: string
  kind: 'email' | 'text'
  /** who it was meant for (the customer's address or number) */
  to: string
  /** emails only */
  subject?: string
  /** the first line of the body, trimmed, web addresses replaced by "[link]" */
  firstLine: string
  at: string
}

/** How many are kept (newest). */
export const MUTED_KEEP = 200
const KEY = 'log'
const kv = makeKvStore('preview-messages', 'preview-messages')

/**
 * Only the first line is ever kept (list and log), and any web address in it
 * becomes "[link]": a muted message's links and tokens (a recovery link, a
 * payment link) are never stored, so they can't be used from More › Messages.
 * On purpose: don't widen this to the whole body (N5).
 */
function firstLineOf(body: string): string {
  const line = (String(body ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? '').replace(/\bhttps?:\/\/\S+/gi, '[link]')
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

/** Record a dropped message (never throws: the message is dropped either way). */
export async function recordMuted(msg: { kind: 'email' | 'text'; to: string; subject?: string; body: string }, now = new Date()): Promise<MutedMessage> {
  const entry: MutedMessage = {
    id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    kind: msg.kind,
    to: msg.to,
    ...(msg.subject !== undefined ? { subject: msg.subject } : {}),
    firstLine: firstLineOf(msg.body),
    at: now.toISOString(),
  }
  logger.info(`Test site: ${msg.kind} not sent (messages are muted here)`, {
    to: entry.to, ...(entry.subject !== undefined ? { subject: entry.subject } : {}), firstLine: entry.firstLine,
  })
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { value, etag } = await kv.getWithMeta(KEY)
      const list = parse(value)
      const next = [entry, ...list].slice(0, MUTED_KEEP)
      if (await kv.setIfMatch(KEY, JSON.stringify(next), etag, value !== null)) return entry
    }
    logger.warn('Muted message not listed (busy); it is in the log', { to: entry.to })
  } catch (err) {
    logger.warn('Muted message not listed; it is in the log', { to: entry.to, error: err instanceof Error ? err.message : String(err) })
  }
  return entry
}

function parse(value: string | null): MutedMessage[] {
  if (!value) return []
  try {
    const j = JSON.parse(value)
    return Array.isArray(j) ? j : []
  } catch {
    return []
  }
}

/** The messages this site would have sent, newest first. */
export async function listMuted(): Promise<MutedMessage[]> {
  return parse(await kv.get(KEY))
}
