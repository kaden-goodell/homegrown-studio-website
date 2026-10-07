import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Every morning at 12:00 UTC (7 AM CDT, 6 AM CST), ask the site to scan the
 * next 60 days and email the owners if anything needs attention. All the
 * deciding happens in src/pages/api/jobs/daily-warnings.json.ts; Netlify
 * functions can't import `@lib/*`, so this only knocks on its door.
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ count: number; sent: boolean; reason: string }> {
  if (!site || !secret) return { count: 0, sent: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:daily-warnings').digest('hex')
  let res: Response
  try {
    res = await ask(`${site.replace(/\/$/, '')}/api/jobs/daily-warnings.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
  } catch (err) {
    return { count: 0, sent: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!res.ok) return { count: 0, sent: false, reason: `site answered ${res.status}` }
  const data = ((await res.json()) as any)?.data ?? {}
  const count = Number(data.count) || 0
  const sent = data.sent === true
  return { count, sent, reason: count === 0 ? 'nothing to report' : sent ? 'emailed' : 'email not sent' }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('daily-warnings', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '0 12 * * *',
}
