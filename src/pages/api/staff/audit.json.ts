import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { listAudit } from '@lib/audit'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:audit')
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Staff-only, read-only: the audit log of staff actions, newest first.
 * GET ?limit=200&by=<staffId>&since=<ISO>. No screen uses this yet — it's
 * here so the owners (or a future page) can check who did what.
 */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)
  const limitRaw = Number(url.searchParams.get('limit'))
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 200
  const byId = url.searchParams.get('by') || undefined
  const since = url.searchParams.get('since') || undefined
  try {
    const entries = await listAudit({ limit, byId, since })
    return json({ data: { entries } })
  } catch (err) {
    logger.error('Audit list failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Could not load the audit log' }, 503)
  }
}
