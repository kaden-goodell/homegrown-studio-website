import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { getKitOrder, mutateKitOrder, type KitOrderRecord } from '@lib/kit-store'
import { quoConfigured, sendQuoText } from '@lib/quo'
import { kitConfig } from '@config/kit.config'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:staff:kit-remind')

export const prerender = false

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** "Wednesday, July 29" — UTC-noon arithmetic, no TZ traps. */
function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

const REMIND_COOLDOWN_MS = 20 * 60 * 60 * 1000 // one nudge per day is plenty

/**
 * Staff-only: text the customer a return reminder FROM the business Quo
 * number. POST { orderId, byStaff? }. Human-triggered on purpose — no cron,
 * no TCPA-automation questions, staff pick the moment. The send lands in the
 * order's custody log, and a 20h cooldown stops double-taps from double-texting.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!staffAuthorized(request)) return json({ error: 'Unauthorized' }, 401)

  if (!quoConfigured()) {
    return json({ error: 'Quo texting isn’t configured (set QUO_API_KEY + QUO_FROM_NUMBER) — text them manually for now.' }, 503)
  }

  const body = await request.json().catch(() => null)
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''
  const byStaff = typeof body?.byStaff === 'string' ? body.byStaff.trim() || undefined : undefined
  if (!orderId) return json({ error: 'Missing orderId' }, 400)

  const order = await getKitOrder(orderId)
  if (!order) return json({ error: 'Kit order not found' }, 404)
  if (order.status !== 'out') {
    return json({ error: `Reminders are for checked-out kits — this order is ${order.status}.` }, 409)
  }

  const lastReminder = [...order.events].reverse().find((e) => e.action === 'reminder')
  if (lastReminder && Date.now() - Date.parse(lastReminder.at) < REMIND_COOLDOWN_MS) {
    return json({ error: 'Already reminded in the last day — give them a beat.' }, 409)
  }

  const firstName = order.contact.name.trim().split(/\s+/)[0] || 'there'
  const content =
    `Hi ${firstName}! Homegrown Studio here — friendly reminder that your kit's rental pieces ` +
    `come home to us by ${formatDay(order.returnBy)}, ${kitConfig.returnWindow}. ` +
    `Reply here if the window won't work and we'll figure something out!`

  try {
    await sendQuoText({ to: order.contact.phone, content })
  } catch (err) {
    logger.error('Reminder send failed', { orderId, error: String(err) })
    return json({ error: 'The text didn’t send — try again, or text them manually.' }, 502)
  }

  const updated = await mutateKitOrder(orderId, (o) => {
    o.events.push({ at: new Date().toISOString(), action: 'reminder', byStaff, note: 'return reminder texted via Quo' })
  })
  return json({ data: { order: publicOrder(updated) } }, 200)
}

/** Staff-facing view of an order — everything except the raw payment id. */
function publicOrder(o: KitOrderRecord) {
  const { paymentId, ...rest } = o
  return rest
}
