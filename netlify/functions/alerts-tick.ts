import type { Config, Context } from '@netlify/functions'
import { createHmac } from 'node:crypto'

/**
 * Every 5 minutes, knock on the site's alerts job: it repeats any "booking
 * broke" text Kaden hasn't answered, and every 15 minutes (WATCHDOG_EVERY_MINUTES
 * in src/config/alerts.ts) runs the robot-customer check. Netlify functions
 * can't import `@lib/*`, so this only knocks.
 *
 * Netlify runs scheduled functions on the live site only, never on previews.
 * Cost: ~8,600 light knocks a month ≈ 1 credit, plus the robot customer's
 * ~2,900 runs ≈ 4–5 credits.
 */
export async function run(
  site: string | undefined,
  secret: string | undefined,
  ask: typeof fetch = fetch,
): Promise<{ ok: boolean; reason: string }> {
  if (!site || !secret) return { ok: false, reason: 'not configured' }
  const key = createHmac('sha256', secret).update('job:alerts-tick').digest('hex')
  try {
    const res = await ask(`${site.replace(/\/$/, '')}/api/jobs/alerts-tick.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-job-key': key },
      body: '{}',
    })
    return { ok: res.ok, reason: res.ok ? 'ran' : `site answered ${res.status}` }
  } catch (err) {
    return { ok: false, reason: `site unreachable: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * If the site itself is down, the site can't text anyone, so this does: the
 * second failed knock in a row texts Kaden straight through Quo, then once an
 * hour while it stays down, and "Fixed" when it answers again.
 */
export function siteDownAction(failsBefore: number, ok: boolean): { fails: number; send: 'down' | 'fixed' | null } {
  if (ok) return { fails: 0, send: failsBefore >= 2 ? 'fixed' : null }
  const fails = failsBefore + 1
  return { fails, send: fails === 2 || (fails > 2 && (fails - 2) % 12 === 0) ? 'down' : null }
}

async function textKaden(content: string): Promise<void> {
  const key = process.env.QUO_API_KEY
  const from = process.env.QUO_FROM_NUMBER
  if (!key || !from) return console.log('alerts-tick', 'Quo not set up; could not text')
  const to = process.env.ALERT_PHONE || '+14029802907'
  const res = await fetch('https://api.quo.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ content, from, to: [to] }),
  }).catch(() => null)
  if (!res?.ok) console.log('alerts-tick', 'site-down text failed', res?.status ?? 'unreachable')
}

export default async (_req: Request, context: Context) => {
  const site = context?.site?.url ?? process.env.URL
  const outcome = await run(site, process.env.LOOKUP_SIGNING_SECRET)
  if (!outcome.ok) console.log('alerts-tick', JSON.stringify(outcome))
  if (outcome.reason === 'not configured') return
  try {
    const { getStore } = await import('@netlify/blobs')
    // 'booking-alarms', never 'incidents' (the injury reports).
    const store = getStore({ name: 'booking-alarms', consistency: 'strong' })
    const before = Number(await store.get('site-down-fails')) || 0
    const next = siteDownAction(before, outcome.ok)
    if (next.fails !== before) await store.set('site-down-fails', String(next.fails))
    if (next.send === 'down') await textKaden(`SITE DOWN: ourhometownstudio.com isn't answering (${outcome.reason}, ${next.fails} checks in a row, 5 min apart). Nobody can book. Check Netlify.`)
    if (next.send === 'fixed') await textKaden('Fixed: ourhometownstudio.com is answering again.')
  } catch (err) {
    console.log('alerts-tick', 'site-down tracking failed', err instanceof Error ? err.message : String(err))
  }
}

export const config: Config = {
  schedule: '*/5 * * * *',
}
