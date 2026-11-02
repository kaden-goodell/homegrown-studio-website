import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * D4: class POS prices follow the early-bird (src/pages/api/jobs/class-prices.json.ts).
 * Hourly at :01, so an early-bird that ends at Chicago midnight is off the
 * register a minute later, all year through daylight saving; a run that finds
 * nothing to change writes nothing. Netlify functions can't import `@lib/*`,
 * so this only knocks on the site's door. Scheduled functions run on the live
 * site only, never on previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:class-prices').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/class-prices.json`, {
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
  console.log('class-prices', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '1 * * * *',
}
