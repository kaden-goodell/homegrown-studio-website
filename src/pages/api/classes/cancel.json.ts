import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
import { askToCancel, cancelView, CancelError, CANCEL_MESSAGES, selfCancel } from '@lib/classes/self-cancel'

export const prerender = false
const logger = createLogger('api:classes:cancel')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })

function fail(err: unknown): Response {
  if (err instanceof CancelError) return json(err.status, { error: err.message, code: err.code, ...(err.view ? { view: err.view } : {}) })
  logger.error('Cancel request failed', { error: err instanceof Error ? err.message : String(err) })
  return json(503, { error: CANCEL_MESSAGES.unavailable, code: 'unavailable' })
}

/**
 * D2, the customer's "Can't make it?" link (public; the signed token is the key).
 *   GET ?t=TOKEN → 200 { data: CancelView } · a wrong token and a missing booking are the same 404
 *   POST { t, action: 'cancel', lineIds, attempt } → 200 { data: { result: 'cancelled' | 'cancelling', cents, view } }
 *        409 { code: 'changed' | 'request-only', view } · 502 { code: 'square', view } (the refund was turned down; nothing changed)
 *   POST { t, action: 'request', note, lineIds? } → 200 { data: { result: 'requested', view } }
 * Amounts come from the booking, never the page. Works while bookings are closed (it never sells anything).
 */
export const GET: APIRoute = async ({ url, clientAddress }) => {
  if (rateLimited(`cancel-view:${clientAddress}`, 30, 60_000)) return json(429, { error: 'That’s a lot of tries in a row. Give it a minute, then try again.', code: 'unavailable' })
  try {
    return json(200, { data: await cancelView(url.searchParams.get('t') ?? '') })
  } catch (err) {
    return fail(err)
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const testSite = classWritesRefusal(request)
  if (testSite) return json(503, { error: testSite, code: 'unavailable' })
  if (rateLimited(`cancel:${clientAddress}`, 10, 60_000)) return json(429, { error: 'That’s a lot of tries in a row. Give it a minute, then try again.', code: 'unavailable' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: CANCEL_MESSAGES.unavailable, code: 'invalid' })
  try {
    if (body.action === 'cancel') return json(200, { data: await selfCancel({ token: body.t, lineIds: body.lineIds, attempt: body.attempt }) })
    if (body.action === 'request') return json(200, { data: await askToCancel({ token: body.t, note: body.note, lineIds: body.lineIds }) })
    return json(400, { error: CANCEL_MESSAGES.unavailable, code: 'invalid' })
  } catch (err) {
    return fail(err)
  }
}
