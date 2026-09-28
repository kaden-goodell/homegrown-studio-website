import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { checkInOpenStudio, hereNowCount } from '@lib/open-studio-store'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:open-studio')

function today(): string {
  return studioDate(new Date().toISOString())
}

/** POST { recordId, personIds[] } → log a walk-in household as here today.
 *  Idempotent — re-checking the same household just updates `at`. */
export const POST: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const body = await request.json().catch(() => null)
  const recordId = typeof body?.recordId === 'string' ? body.recordId : ''
  const personIds = Array.isArray(body?.personIds) ? body.personIds.map((s: unknown) => String(s).trim()).filter(Boolean) : []
  if (!recordId || personIds.length === 0) {
    return new Response(JSON.stringify({ error: 'Missing recordId or personIds' }), { status: 400 })
  }

  try {
    await checkInOpenStudio(today(), recordId, personIds, byOf(staff))
  } catch (err) {
    logger.error('Open Studio check-in failed', { recordId, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }

  return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** GET ?date=YYYY-MM-DD → { count } — the Today header's "n here now (open studio)". */
export const GET: APIRoute = async ({ request, url }) => {
  if (!staffAuthorized(request)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const date = url.searchParams.get('date') || today()
  try {
    const count = await hereNowCount(date)
    return new Response(JSON.stringify({ data: { count } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    logger.error('Open Studio count failed', { date, error: err instanceof Error ? err.message : String(err) })
    return new Response(JSON.stringify({ error: 'Couldn’t reach storage — check wifi and try again.' }), { status: 503 })
  }
}
