// src/pages/api/admin/magnet-orders.json.ts
import type { APIRoute } from 'astro'
import { adminAuthorized } from '@lib/admin-auth'
import { isPreviewOrDev } from '@lib/deploy-context'
import { listOrders, setOrderStatus, markEmailed, STATUSES, type MagnetStatus } from '@lib/magnet-orders'
import { sendMagnetStatusEmail } from '@lib/magnet-emails'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * GET: every magnet order, newest first (test orders only on preview/dev — previews share prod's stores).
 * POST { id, status }: move one. Ready / shipped email the customer once. Owners only.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { orders: await listOrders({ includeSimulated: isPreviewOrDev(request) }) } })
}

export const POST: APIRoute = async ({ request }) => {
  if (!adminAuthorized(request)) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => ({}))
  if (!STATUSES.includes(body?.status)) return json(400, { error: 'Unknown status.' })
  const status = body.status as MagnetStatus
  const result = await setOrderStatus(String(body?.id ?? ''), status)
  if (result === 'not_found') return json(404, { error: 'Order not found.' })
  if (result === 'wrong_delivery') return json(400, { error: status === 'shipped' ? 'This order is a pickup.' : 'This order ships.' })
  if (result === 'photos_deleted') return json(409, { error: 'The photos for this order were deleted, so it can\'t be reopened.' })
  let emailed = false
  if (result.changed && (status === 'ready' || status === 'shipped') && (await markEmailed(result.order.id, status))) {
    emailed = (await sendMagnetStatusEmail(result.order, status).catch(() => ({ sent: false }))).sent
  }
  return json(200, { data: { order: result.order, emailed } })
}
