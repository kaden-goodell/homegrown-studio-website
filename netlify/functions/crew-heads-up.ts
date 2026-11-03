import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * DV19: the owners' hourly heads-up of crew refunds, comps and gift cards
 * (src/pages/api/jobs/crew-heads-up.json.ts). Hourly at :07; a run with
 * nothing waiting sends nothing. Netlify functions can't import `@lib/*`, so
 * this only knocks on the site's door. Scheduled functions run on the live
 * site only, never on previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:crew-heads-up').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/crew-heads-up.json`, {
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
  console.log('crew-heads-up', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '7 * * * *',
}
