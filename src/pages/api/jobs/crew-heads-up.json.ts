import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { flushCrewHeadsUp } from '@lib/crew-heads-up'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:jobs:crew-heads-up')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function crewHeadsUpJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:crew-heads-up').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(crewHeadsUpJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * DV19: sends the owners what the crew did (refunds, comps, gift cards) that
 * is still waiting, once an hour has passed since the last heads-up. Run
 * hourly by netlify/functions/crew-heads-up.ts. Nothing waiting: nothing sent.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 403)
  try {
    const data = await flushCrewHeadsUp(new Date())
    if (data.sent) logger.info('Crew heads-up run', data)
    return json({ data }, 200)
  } catch (err) {
    logger.error('Crew heads-up run failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'failed' }, 500)
  }
}
