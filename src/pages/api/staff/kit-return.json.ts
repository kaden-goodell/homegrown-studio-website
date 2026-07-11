import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { providers } from '@config/providers'
import { getKitOrder, mutateKitOrder, type KitOrderRecord } from '@lib/kit-store'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:staff:kit-return')

export const prerender = false

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Staff-only kit check-in / pickup console (LR-4).
 * POST { orderId, action, withheldCents?, note?, byStaff? }
 *   pickup   — hand the kit over. Themed orders go 'out' (starts the return
 *              clock); crafts-only orders settle immediately ('returned', no
 *              deposit, no return tracking).
 *   complete — pieces came home clean: refund the full deposit, status 'returned'.
 *   partial  — refund deposit minus a withheld amount (note required), 'returned'.
 *   forfeit  — pieces never came back: no refund, status 'forfeited'.
 *   undo     — reverse a forfeit / no-refund return back to 'out'. ONLY while no
 *              refund has been sent; once a deposit refund exists it can't be
 *              reversed by the app (Square dashboard only) → 409 with instructions.
 * Refunds use a stable idempotency key (kitret-<orderId>) so a retry never
 * double-refunds.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => null)
  const orderId = str(body?.orderId)
  const action = str(body?.action)
  const byStaff = str(body?.byStaff) || undefined
  if (!orderId) return json({ error: 'Missing orderId' }, 400)

  const order = await getKitOrder(orderId)
  if (!order) return json({ error: 'Kit order not found' }, 404)

  const nowIso = new Date().toISOString()

  try {
    switch (action) {
      case 'pickup': {
        if (order.status !== 'upcoming') return json({ error: `Can’t mark picked up — order is ${order.status}.` }, 409)
        // LR-4: a theme-less kit has no rental to return, so pickup settles it.
        const settleDirectly = !order.theme
        const updated = await mutateKitOrder(orderId, (o) => {
          if (o.status !== 'upcoming') return
          o.status = settleDirectly ? 'returned' : 'out'
          o.events.push({ at: nowIso, action: 'pickup', byStaff })
        })
        return json({ data: { order: publicOrder(updated) } }, 200)
      }

      case 'complete':
      case 'partial': {
        if (!order.theme) return json({ error: 'Crafts-only kits have no deposit to return.' }, 400)
        if (order.status !== 'out') return json({ error: `Can’t check in — order is ${order.status}.` }, 409)
        const deposit = order.theme.depositCents

        let refundAmount = deposit
        let note: string | undefined
        if (action === 'partial') {
          const withheld = Number(body?.withheldCents)
          if (!Number.isInteger(withheld) || withheld <= 0 || withheld > deposit) {
            return json({ error: 'withheldCents must be a whole number between 1 and the deposit.' }, 400)
          }
          note = str(body?.note)
          if (!note) return json({ error: 'A note is required when withholding from the deposit.' }, 400)
          refundAmount = deposit - withheld
        }

        let depositRefund: KitOrderRecord['depositRefund']
        if (refundAmount > 0) {
          const refund = await providers.payment.refundPayment({
            paymentId: order.paymentId,
            amountCents: refundAmount,
            idempotencyKey: `kitret-${orderId}`,
            reason: 'Kit rental deposit return',
          })
          depositRefund = { amountCents: refundAmount, refundId: refund.id, at: nowIso }
        }

        const updated = await mutateKitOrder(orderId, (o) => {
          if (o.status !== 'out') return
          o.status = 'returned'
          if (depositRefund) o.depositRefund = depositRefund
          o.events.push({
            at: nowIso,
            action: action === 'complete' ? 'return-complete' : 'return-partial',
            note,
            byStaff,
            amountCents: refundAmount,
          })
        })
        return json({ data: { order: publicOrder(updated) } }, 200)
      }

      case 'forfeit': {
        if (!order.theme) return json({ error: 'Crafts-only kits have no deposit to forfeit.' }, 400)
        if (order.status !== 'out') return json({ error: `Can’t forfeit — order is ${order.status}.` }, 409)
        const updated = await mutateKitOrder(orderId, (o) => {
          if (o.status !== 'out') return
          o.status = 'forfeited'
          o.events.push({ at: nowIso, action: 'forfeit', note: str(body?.note) || undefined, byStaff, amountCents: 0 })
        })
        return json({ data: { order: publicOrder(updated) } }, 200)
      }

      case 'undo': {
        // A sent refund can't be reversed through the app — be honest about it.
        if (order.depositRefund) {
          return json(
            { error: 'A deposit refund was already sent. Square can’t reverse it from here — reverse it in the Square dashboard, then adjust.' },
            409,
          )
        }
        if (!order.theme) return json({ error: 'Nothing to undo on a crafts-only kit.' }, 400)
        if (order.status !== 'forfeited' && order.status !== 'returned') {
          return json({ error: `Nothing to undo — order is ${order.status}.` }, 400)
        }
        const updated = await mutateKitOrder(orderId, (o) => {
          if (o.depositRefund) return
          o.status = 'out' // its pre-mistake value — matters for the overdue ledger clause
          o.events.push({ at: nowIso, action: 'undo', byStaff })
        })
        return json({ data: { order: publicOrder(updated) } }, 200)
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('Concurrent update')) {
      return json({ error: 'Another device just updated this order — refresh and try again.' }, 409)
    }
    logger.error('kit-return failed', { orderId, action, error: msg })
    return json({ error: 'Couldn’t complete the return — please try again.' }, 502)
  }
}

/** Staff-facing view of an order — everything except the raw payment id. */
function publicOrder(o: KitOrderRecord) {
  const { paymentId, ...rest } = o
  return rest
}
