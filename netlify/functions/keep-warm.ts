import type { Config, Context } from '@netlify/functions'

/**
 * Every 5 minutes from 6 AM to midnight Central (11:00–04:59 UTC; an hour
 * earlier in winter), knock on /api/ping.json so the page server stays awake.
 * Netlify puts it to sleep after a few quiet minutes, and the next visitor
 * then waited 1–3 s (5.7 s seen right after a deploy) with nothing on screen —
 * worst in the booking steps, which can't be cached. About 2–3 credits a month
 * (Kaden OK'd, 11 Oct 2026).
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 */
export async function run(site: string | undefined, ask: typeof fetch = fetch): Promise<{ ok: boolean; ms: number; reason: string }> {
  if (!site) return { ok: false, ms: 0, reason: 'not configured' }
  const started = Date.now()
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/ping.json`, { headers: { 'Cache-Control': 'no-cache' } })
    return { ok: res.ok, ms: Date.now() - started, reason: res.ok ? 'awake' : `site answered ${res.status}` }
  } catch (err) {
    return { ok: false, ms: Date.now() - started, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export default async (_req: Request, context: Context) => {
  const outcome = await run(context?.site?.url ?? process.env.URL)
  // Only worth a log line when something's off or it had to wake up slowly.
  if (!outcome.ok || outcome.ms > 1000) console.log('keep-warm', JSON.stringify(outcome))
}

export const config: Config = {
  schedule: '*/5 0-4,11-23 * * *',
}
