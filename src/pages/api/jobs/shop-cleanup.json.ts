// src/pages/api/jobs/shop-cleanup.json.ts
import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cleanup } from '@lib/magnet-orders'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:jobs:shop-cleanup')
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function shopCleanupJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:shop-cleanup').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = process.env.LOOKUP_SIGNING_SECRET || (import.meta as any).env?.LOOKUP_SIGNING_SECRET || ''
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(shopCleanupJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** Daily: delete abandoned magnet drafts (24 h) and finished orders' photos (30 days). */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Forbidden' }, 403)
  const dryRun = new URL(request.url).searchParams.get('dryRun') === '1'
  const result = await cleanup(new Date(), { dryRun })
  logger.info('shop cleanup', result)
  return json({ data: result }, 200)
}
