import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Stage 4: the waitlist sweep (src/pages/api/jobs/waitlist-sweep.json.ts),
 * every 10 minutes: asks Square again about unclear waitlist charges, closes
 * passed cutoffs, adds and charges the next people who fit a free seat.
 * Netlify functions can't import `@lib/*`, so this only knocks on the site's
 * door. Scheduled functions run on the live site only, never on previews
 * (there, an owner's "Run the waitlist now" does the same).
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:waitlist-sweep').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/waitlist-sweep.json`, {
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
  console.log('waitlist-sweep', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '*/10 * * * *',
}
