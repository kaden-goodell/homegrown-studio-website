import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Every night just after midnight in Chicago (06:15 UTC: 1:15 AM CDT, 12:15 AM
 * CST), ask the site to roll Craft Café's windows in Square forward from the
 * owners' saved hours (R38). All the deciding happens in
 * src/pages/api/jobs/cafe-windows.json.ts; Netlify functions can't import
 * `@lib/*`, so this only knocks on its door.
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:cafe-windows').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/cafe-windows.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
    if (!res.ok) return { ok: false, reason: `site answered ${res.status}` }
    const data = ((await res.json()) as any)?.data ?? {}
    return { ok: data.status !== 'failed', reason: String(data.status ?? 'done') }
  } catch (err) {
    return { ok: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('cafe-windows', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '15 6 * * *',
}
