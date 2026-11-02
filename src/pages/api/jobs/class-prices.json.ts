import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { followCurrentPricesOnPos } from '@lib/classes/pos-prices'
import { createLogger } from '@lib/logger'
import { adminAuthorized } from '@lib/admin-auth'

export const prerender = false
const logger = createLogger('api:jobs:class-prices')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function classPricesJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:class-prices').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(classPricesJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * D4: keeps each class's POS seat prices on the current price (early-bird
 * while it runs, regular after). Run hourly by netlify/functions/class-prices.ts,
 * so the flip lands a minute after the early-bird ends at Chicago midnight.
 * Writes to Square only when a price differs (idempotent). An owner signed in
 * to /admin can run it now.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request) && !adminAuthorized(request)) return json({ error: 'Not allowed' }, 403)
  try {
    const data = await followCurrentPricesOnPos(new Date())
    if (data.updated.length || data.failed.length) logger.info('Class POS prices run', data)
    return json({ data }, 200)
  } catch (err) {
    logger.error('Class POS prices run failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'failed' }, 500)
  }
}
