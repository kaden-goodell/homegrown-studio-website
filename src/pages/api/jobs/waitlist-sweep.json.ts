import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createLogger } from '@lib/logger'
import { adminAuthorized } from '@lib/admin-auth'
import { sweepWaitlists } from '@lib/classes/waitlist-runner'

export const prerender = false
const logger = createLogger('api:jobs:waitlist-sweep')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function waitlistSweepJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:waitlist-sweep').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(waitlistSweepJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * Stage 4: every 10 minutes (netlify/functions/waitlist-sweep.ts) each class
 * with people waiting is run: unclear charges are asked about again (never
 * charged twice), passed cutoffs close (cards off), and the next people who
 * fit a free seat are added and charged. Catches seats freed with no hook
 * (an expired checkout hold). An owner signed in to /admin can run it now.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request) && !(await adminAuthorized(request))) return json({ error: 'Not allowed' }, 403)
  try {
    const data = await sweepWaitlists(new Date())
    if (data.classes) logger.info('Waitlist sweep', data)
    return json({ data }, 200)
  } catch (err) {
    logger.error('Waitlist sweep failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'failed' }, 500)
  }
}
