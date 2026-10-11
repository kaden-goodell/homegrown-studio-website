import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * On the 1st of each month at 14:00 UTC (9 AM CDT, 8 AM CST), ask the site
 * to email last month's tax split (src/pages/api/jobs/tax-report.json.ts).
 * Netlify functions can't import `@lib/*`, so this only knocks on its door.
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:tax-report').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/tax-report.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
    return { ok: res.ok, reason: res.ok ? 'sent' : `site answered ${res.status}` }
  } catch (err) {
    return { ok: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('tax-report', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '0 14 1 * *',
}
