import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { mergeVisit, visitFromBeacon, visitKey, visitStore, type Visit } from '@lib/quote/corky-visits'
import { createLogger } from '@lib/logger'

/**
 * POST /api/quote/corky-visit.json — the visit beacon from /quote/corky-christmas
 * (src/lib/quote/corky-visit-client.ts). Body (sent as text/plain JSON by
 * navigator.sendBeacon): { visitorId, sessionId, device, referrer, activeSeconds,
 * scroll, events[], pick }. Everything is checked and clamped
 * (src/lib/quote/corky-visits.ts); the record for this page load is upserted
 * keeping the larger totals. No IP is stored. Always 204 when accepted.
 */

export const prerender = false

const logger = createLogger('api:quote:corky-visit')
const MAX_BYTES = 16_000

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`corky-visit:${clientAddress}`, 60, 10 * 60_000)) return new Response(null, { status: 429 })
  let text: string
  try {
    text = await request.text()
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!text || text.length > MAX_BYTES) return new Response(null, { status: 400 })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  const visit = visitFromBeacon(body, Date.now())
  if (!visit) return new Response(null, { status: 400 })

  try {
    const kv = visitStore()
    const key = visitKey(visit.visitorId, visit.sessionId)
    const raw = await kv.get(key)
    let old: Visit | null = null
    if (raw) try { old = JSON.parse(raw) } catch { old = null }
    await kv.set(key, JSON.stringify(mergeVisit(old, visit)))
  } catch (err) {
    // A visit log is nice to have: never an error the page would see.
    logger.warn('Visit not saved', { error: err instanceof Error ? err.message : String(err) })
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
