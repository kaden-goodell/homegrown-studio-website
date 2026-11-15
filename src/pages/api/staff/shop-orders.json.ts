// src/pages/api/staff/shop-orders.json.ts
import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { recordAudit } from '@lib/audit'
import { isPreviewOrDev } from '@lib/deploy-context'
import { listOrders, setOrderStatus, markEmailed, STATUSES, type MagnetStatus } from '@lib/magnet-orders'
import { sendMagnetStatusEmail } from '@lib/magnet-emails'

export const prerender = false
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Shop orders (photo magnets and framed silhouettes) for the /staff Orders tab.
 * Anyone signed in at /staff, not just the owners (Kaden, 15 Nov 2026).
 * GET: every order, newest first (test orders only on preview/dev; previews share prod's stores).
 * POST { id, status }: move one, recorded in the audit log. Ready / shipped email the customer once.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { orders: await listOrders({ includeSimulated: isPreviewOrDev(request) }) } })
}

export const POST: APIRoute = async ({ request }) => {
  const member = staffAuthorized(request)
  if (!member) return json(401, { error: 'Sign in first.' })
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
  if (result.changed) {
    await recordAudit({
      by: member,
      action: 'shop-order.status',
      target: { kind: 'shop-order', id: result.order.id, label: result.order.contact.name },
      details: { status, emailed },
      ...(result.order.simulated ? { simulated: true as const } : {}),
    })
  }
  return json(200, { data: { order: result.order, emailed } })
}
