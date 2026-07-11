import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { providers } from '@config/providers'
import { getKitOrder, mutateKitOrder, releaseWeekClaim, type KitOrderRecord } from '@lib/kit-store'
import { addDays } from '@lib/kit-dates'
import { kitConfig } from '@config/kit.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:staff:kit-cancel')

export const prerender = false

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function studioToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: kitConfig.timezone })
}

/**
 * Staff-only kit cancellation.
 * POST { orderId, byStaff? }
 * Precondition: status === 'upcoming' (a picked-up/returned/cancelled order is
 * rejected with 409; the missed-pickup bucket is still 'upcoming', so those
 * cancel through here too). Policy refund: full charge if we're still ≥ lead
 * time before pickup, otherwise the charge minus the (already-spent) assembly
 * fee. Idempotency key kitcancel-<orderId> makes a double-submit money-safe.
 *
 * Ordering is crash-safe: refund → release the ledger week → flip status LAST,
 * so a mid-flight failure leaves the order still 'upcoming' and a retry re-runs
 * every step idempotently. The claim ref is the order's `reference` (the id used
 * when the week was claimed pre-order).
 */
export const POST: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => null)
  const orderId = str(body?.orderId)
  const byStaff = str(body?.byStaff) || undefined
  if (!orderId) return json({ error: 'Missing orderId' }, 400)

  const order = await getKitOrder(orderId)
  if (!order) return json({ error: 'Kit order not found' }, 404)
  if (order.status !== 'upcoming') {
    return json({ error: `Can’t cancel — order is ${order.status}. Only upcoming orders can be cancelled.` }, 409)
  }

  const today = studioToday()
  const nowIso = new Date().toISOString()
  // Full refund while still ≥ lead time before pickup; else keep the assembly fee.
  const freeCancel = today <= addDays(order.pickupDate, -kitConfig.leadTimeDays)
  const refundAmount = freeCancel ? order.totalChargedCents : Math.max(0, order.totalChargedCents - kitConfig.assemblyFeeCents)

  try {
    if (refundAmount > 0) {
      await providers.payment.refundPayment({
        paymentId: order.paymentId,
        amountCents: refundAmount,
        idempotencyKey: `kitcancel-${orderId}`,
        reason: 'Kit order cancellation',
      })
    }
    // Free the ledger week (themed orders only — crafts-only never claimed one).
    if (order.theme) {
      await releaseWeekClaim(order.theme.ledgerThemeId, order.weekKey, order.reference)
    }
    const updated = await mutateKitOrder(orderId, (o) => {
      if (o.status !== 'upcoming') return
      o.status = 'cancelled'
      o.events.push({
        at: nowIso,
        action: 'cancel',
        amountCents: refundAmount,
        byStaff,
        note: freeCancel ? 'full refund' : 'assembly fee withheld',
      })
    })
    return json({ data: { order: publicOrder(updated), refundCents: refundAmount, assemblyWithheld: !freeCancel } }, 200)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Concurrent update')) {
      return json({ error: 'Another device just updated this order — refresh and try again.' }, 409)
    }
    logger.error('kit-cancel failed', { orderId, error: msg })
    return json({ error: 'Couldn’t cancel the order — please try again.' }, 502)
  }
}

/** Staff-facing view of an order — everything except the raw payment id. */
function publicOrder(o: KitOrderRecord) {
  const { paymentId, ...rest } = o
  return rest
}
