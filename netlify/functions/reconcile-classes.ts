import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Nightly classes reconcile (src/pages/api/jobs/reconcile-classes.json.ts):
 * counter sales of our classes the Square webhook missed reach the seat
 * ledger. Netlify functions can't import `@lib/*`, so this only knocks on the
 * site's door. Live site only, never previews.
 *
 * Each knock does about 6 seconds of work and answers `more: true` while some
 * is left; this knocks again until it's done, but starts no knock after
 * KNOCKS_UNTIL_MS, so the whole run stays under Netlify's 30-second limit for
 * scheduled functions. Whatever is still left is carried on by the next
 * scheduled run (08:00–11:00 UTC; the site starts a new pass only at 3 AM in
 * Madison, CDT or CST, and later runs only carry on an unfinished one).
 */
export const KNOCKS_UNTIL_MS = 18_000
/** One knock's longest wait: the site's 6 s of work plus the item in hand. */
export const KNOCK_TIMEOUT_MS = 10_000

export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
  clock: () => number = Date.now,
): Promise<{ ok: boolean; reason: string; knocks: number }> {
  if (!site || !secret) return { ok: false, reason: 'not configured', knocks: 0 }
  const key = createHmac('sha256', secret).update('job:reconcile-classes').digest('hex')
  const began = clock()
  let knocks = 0
  try {
    for (;;) {
      knocks++
      const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/reconcile-classes.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-job-key': key },
        body: '{}',
        signal: AbortSignal.timeout(KNOCK_TIMEOUT_MS),
      })
      if (!res.ok) return { ok: false, reason: `site answered ${res.status}`, knocks }
      const body: any = await res.json().catch(() => null)
      if (!body?.data?.more) return { ok: true, reason: 'done', knocks }
      if (clock() - began >= KNOCKS_UNTIL_MS) return { ok: true, reason: 'more to do; the next scheduled run carries on', knocks }
    }
  } catch (err) {
    return { ok: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}`, knocks }
  }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL, process.env.LOOKUP_SIGNING_SECRET)
  console.log('reconcile-classes', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '0 8,9,10,11 * * *',
}
