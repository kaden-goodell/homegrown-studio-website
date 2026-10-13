import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Class-day waiver reminders (src/pages/api/jobs/waiver-reminders.json.ts).
 * Runs at 14:00 and 15:00 UTC; the site acts only on the one that is 9 AM in
 * Madison (CDT or CST). Netlify functions can't import `@lib/*`, so this only
 * knocks on the site's door. Live site only, never previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:waiver-reminders').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/waiver-reminders.json`, {
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
  console.log('waiver-reminders', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '0 14,15 * * *',
}
