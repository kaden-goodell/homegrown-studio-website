import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { reconcileClasses, reconcileUnfinished } from '@lib/classes/square-events'
import { studioClock } from '@lib/studio-time'
import { createLogger } from '@lib/logger'
import { adminAuthorized } from '@lib/admin-auth'

export const prerender = false
const logger = createLogger('api:jobs:reconcile-classes')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function reconcileClassesJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:reconcile-classes').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(reconcileClassesJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * How long one call keeps starting new work. Every call (the scheduled job's,
 * an owner's, the sandbox harness's) is an ordinary web request, so it stays
 * far under the web function limit: at this point it finishes the item in
 * hand, saves where it stopped and answers `more: true`; calling again
 * carries on (the scheduled job calls again until done, within its own limit).
 */
export const CALL_BUDGET_MS = 6_000

/**
 * Run by netlify/functions/reconcile-classes.ts from 08:00 UTC; a new pass
 * starts only on the run that lands at 3 AM in the studio's time (3 AM all
 * year through daylight saving), and an unfinished pass is carried on by any
 * job call. Catches what the webhook missed: every COMPLETED or OPEN order and
 * every refund of the last 48 hours go through the same handlers, which never
 * record anything twice.
 *
 * An owner signed in to /admin can run it now with POST ?force=1 (call again
 * while it answers `more: true`).
 */
export const POST: APIRoute = async ({ request, url }) => {
  const job = allowed(request)
  const owner = !job && (await adminAuthorized(request))
  if (!job && !owner) return json({ error: 'Not allowed' }, 403)
  const force = owner && (url ?? new URL(request.url)).searchParams.get('force') === '1'
  const now = new Date()
  const hour = studioClock(now.toISOString()).slice(0, 2)
  try {
    if (!force && hour !== '03' && !(job && (await reconcileUnfinished()))) {
      return json({ data: { skipped: `studio time is ${hour}:00, not 3 AM` } }, 200)
    }
    const data = await reconcileClasses(now, { budgetMs: CALL_BUDGET_MS })
    logger.info('Classes reconcile run', { ...data, manual: force })
    return json({ data }, 200)
  } catch (err) {
    logger.error('Classes reconcile failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'failed' }, 500)
  }
}
