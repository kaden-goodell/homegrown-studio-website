import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { reconcileClasses } from '@lib/classes/square-events'
import { studioClock } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

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
 * Run by netlify/functions/reconcile-classes.ts at 08:00 and 09:00 UTC; only
 * the run that lands at 3 AM in the studio's time does anything (3 AM all
 * year through daylight saving). Catches counter sales of our classes the
 * webhook missed: every COMPLETED order of the last 48 hours goes through the
 * same sale handler, which never records a seat twice.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 403)
  const now = new Date()
  const hour = studioClock(now.toISOString()).slice(0, 2)
  if (hour !== '03') return json({ data: { skipped: `studio time is ${hour}:00, not 3 AM` } }, 200)
  try {
    const data = await reconcileClasses(now)
    logger.info('Classes reconcile run', { ...data })
    return json({ data }, 200)
  } catch (err) {
    logger.error('Classes reconcile failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'failed' }, 500)
  }
}
