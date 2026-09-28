import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Every half hour, ask the site to send the emails that "tell me when…"
 * sign-ups were promised. All the deciding happens in the site itself
 * (src/pages/api/jobs/signup-emails.json.ts); this only knocks on its door.
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 */

/** Emails go out between 8 in the morning and 8 at night, studio time. */
const FIRST_HOUR = 8
const LAST_HOUR = 20
const TIME_ZONE = 'America/Chicago'

/** Scheduled functions get 30 seconds. Stop asking well before that. */
const BUDGET_MS = 18_000

export function withinSendingHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TIME_ZONE }).format(now),
  )
  return hour >= FIRST_HOUR && hour < LAST_HOUR
}

export async function run(
  site: string | undefined,
  secret: string | undefined,
  now: () => number = Date.now,
  ask: typeof fetch = fetch,
): Promise<{ calls: number; sent: number; reason: string }> {
  if (!site || !secret) return { calls: 0, sent: 0, reason: 'not configured' }
  if (!withinSendingHours(new Date(now()))) return { calls: 0, sent: 0, reason: 'outside sending hours' }

  const key = createHmac('sha256', secret).update('job:signup-emails').digest('hex')
  const started = now()
  let calls = 0
  let sent = 0
  while (now() - started < BUDGET_MS) {
    calls++
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/signup-emails.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
    if (!res.ok) return { calls, sent, reason: `site answered ${res.status}` }
    const data = ((await res.json()) as any)?.data ?? {}
    sent += Number(data.sent) || 0
    // Go round again only while it is getting somewhere.
    if (!data.left || !data.sent) return { calls, sent, reason: data.bookingOpen === false ? 'booking closed' : 'done' }
  }
  return { calls, sent, reason: 'out of time, more next run' }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('signup-emails', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '*/30 * * * *',
}
