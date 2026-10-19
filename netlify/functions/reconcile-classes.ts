import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Nightly classes reconcile (src/pages/api/jobs/reconcile-classes.json.ts):
 * counter sales of our classes the Square webhook missed reach the seat
 * ledger. Runs at 08:00 and 09:00 UTC; the site acts only on the one that is
 * 3 AM in Madison (CDT or CST). Netlify functions can't import `@lib/*`, so
 * this only knocks on the site's door. Live site only, never previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:reconcile-classes').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/reconcile-classes.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
    return { ok: res.ok, reason: res.ok ? 'done' : `site answered ${res.status}` }
  } catch (err) {
    return { ok: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('reconcile-classes', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '0 8,9 * * *',
}
