import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { SITE_URL } from '@config/site-url'
import { WATCHDOG_EVERY_MINUTES } from '@config/alerts'
import { sweepIncidents } from '@lib/booking-alarms'
import { liveChecks, runWatchdog } from '@lib/watchdog'

export const prerender = false

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

export function alertsTickJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:alerts-tick').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(alertsTickJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** The 5-minute tick lands on the robot customer's run every WATCHDOG_EVERY_MINUTES. */
export function watchdogDue(now: Date, every = WATCHDOG_EVERY_MINUTES): boolean {
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes()
  return minuteOfDay % every < 5
}

/**
 * Run every 5 minutes by netlify/functions/alerts-tick.ts (live site only):
 * repeats unanswered alert texts, and on its turn runs the robot customer.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401)
  const swept = await sweepIncidents()
  const watchdog = watchdogDue(new Date()) ? await runWatchdog(liveChecks(SITE_URL)) : null
  return json({ data: { swept, watchdog } }, 200)
}
