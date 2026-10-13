import type { APIRoute } from 'astro'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { runWaiverReminders } from '@lib/waiver-reminders'
import { studioClock } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:jobs:waiver-reminders')

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

function env(name: string): string {
  const meta: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  return meta[name] || (typeof process !== 'undefined' ? process.env[name] : '') || ''
}

/** The key the scheduled function sends: made from a secret only the site holds. */
export function waiverRemindersJobKey(secret: string): string {
  return createHmac('sha256', secret).update('job:waiver-reminders').digest('hex')
}

function allowed(request: Request): boolean {
  const secret = env('LOOKUP_SIGNING_SECRET')
  if (!secret) return false
  const given = Buffer.from(request.headers.get('x-job-key') ?? '')
  const wanted = Buffer.from(waiverRemindersJobKey(secret))
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/**
 * Run by netlify/functions/waiver-reminders.ts at 14:00 and 15:00 UTC; only
 * the run that lands at 9 AM in the studio's time does anything, so it is
 * 9 AM all year through daylight saving (src/lib/waiver-reminders.ts).
 */
export const POST: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Not allowed' }, 403)
  const now = new Date()
  const hour = studioClock(now.toISOString()).slice(0, 2)
  if (hour !== '09') return json({ data: { skipped: `studio time is ${hour}:00, not 9 AM` } }, 200)
  try {
    const run = await runWaiverReminders(now, new URL(request.url).origin)
    const data = {
      day: run.plan.day,
      reminded: run.sent.map((s) => ({ family: s.family.key, email: s.email, text: s.text })),
      signed: run.plan.signed.length,
      alreadyReminded: run.plan.alreadyReminded.length,
      unsure: run.plan.unsure.map((f) => ({ family: f.key, why: f.why })),
      summarySent: run.summarySent,
    }
    logger.info('Waiver reminders run', data)
    return json({ data }, 200)
  } catch (err) {
    logger.error('Waiver reminders failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'failed' }, 500)
  }
}
