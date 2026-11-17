/**
 * Shared pieces of the admin quote routes (spec §3 Admin): the owner check,
 * the test-site refusal, body reading, and turning a library refusal
 * (QuoteError / QuoteStoreError) into its status code with a plain message.
 * Server only.
 */
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { recordAudit, type AuditEntry } from '@lib/audit'
import { TestSiteStoreError } from '@lib/classes/test-site-guard'
import { createLogger } from '@lib/logger'
import { partyWritesRefusal } from '@lib/parties/test-site'
import { QuoteError } from './admin-quotes'
import { QuoteStoreError } from './menu-store'
import { isExpired, type Quote } from './types'

const logger = createLogger('api:admin:quotes')

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export type Owner = { id: string; name: string }

/** A Response to send back now (signed out, test site, bad body), or the owner and body to go ahead with. */
export async function ownerWrite(request: Request): Promise<Response | { by: Owner; body: Record<string, unknown> }> {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const refusal = partyWritesRefusal(request)
  if (refusal) return json(503, { error: refusal })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Reload the page and try again.' })
  return { by: await adminActor(request), body: body as Record<string, unknown> }
}

export const audit = (by: Owner, action: string, target: AuditEntry['target'], details?: AuditEntry['details']) =>
  recordAudit({ by: { ...by, role: 'owner' }, action, target, ...(details ? { details } : {}) })

export const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200
export const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
export const optBool = (v: unknown): v is boolean | undefined => v === undefined || typeof v === 'boolean'

/** A library refusal → its status and { error, why, clash? }; anything else is logged and answered 503. */
export function refusalResponse(e: unknown, what: string): Response {
  if (e instanceof QuoteError) return json(e.status, { error: e.message, why: e.why, ...(e.clash ? { clash: e.clash } : {}) })
  if (e instanceof QuoteStoreError) {
    const status = e.why === 'stale' ? 409 : e.why === 'invalid' ? 400 : e.why === 'sync_failed' ? 502 : 503
    return json(status, { error: e.message, why: e.why })
  }
  if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
  logger.error(`${what} failed`, { error: e instanceof Error ? e.message : String(e) })
  return json(503, { error: 'That didn’t save. Try again.' })
}

/** What the request sheet shows about its quote: where it stands, and the customer's link. */
export function quoteStatusView(q: Quote, origin: string, now: Date = new Date()) {
  return {
    status: isExpired(q, now) ? ('expired' as const) : q.status,
    views: q.views,
    sentAt: q.sentAt ?? null,
    lastViewedAt: q.lastViewedAt ?? null,
    pickedTierId: q.pickedTierId ?? null,
    expiresAt: q.expiresAt,
    held: q.held,
    paidAt: q.paidAt ?? null,
    url: `${origin.replace(/\/$/, '')}/quote/${q.token}`,
  }
}
