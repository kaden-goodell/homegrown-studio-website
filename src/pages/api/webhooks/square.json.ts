import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { verifySquareSignature } from '@lib/webhook-verify'
import { providers } from '@config/providers'
import { CLASS_EVENTS, handleSquareEvent } from '@lib/classes/square-events'

const logger = createLogger('api:webhooks:square')

const SIGNATURE_KEY =
  (typeof process !== 'undefined' && process.env?.SQUARE_WEBHOOK_SIGNATURE_KEY) || ''

const WEBHOOK_URL =
  (typeof process !== 'undefined' && process.env?.SQUARE_WEBHOOK_URL) || ''

const HANDLED_EVENTS = new Set([
  'booking.created',
  'booking.updated',
  'payment.created',
  'payment.updated',
  'order.created',
  'order.updated',
  'refund.created',
  'refund.updated',
])

export const POST: APIRoute = async ({ request, locals }) => {
  const startTime = Date.now()
  const body = await request.text()

  // Verify signature
  const signature = request.headers.get('x-square-hmacsha256-signature') ?? ''

  if (!SIGNATURE_KEY) {
    logger.error('Webhook rejected: SQUARE_WEBHOOK_SIGNATURE_KEY not configured', {
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Webhook verification not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!verifySquareSignature(body, signature, SIGNATURE_KEY, WEBHOOK_URL)) {
    logger.warn('Webhook signature verification failed', {
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse event
  let event: { type?: string; event_id?: string; data?: { type?: unknown; id?: unknown; [k: string]: unknown } }
  try {
    event = JSON.parse(body)
  } catch {
    logger.error('Webhook body is not valid JSON', {
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const eventType = event.type ?? 'unknown'

  logger.info('Webhook received', {
    eventType,
    handled: HANDLED_EVENTS.has(eventType),
    duration_ms: Date.now() - startTime,
  })

  // Acknowledge quickly — Square requires response within 10 seconds
  // For handled events, send a notification so the team is aware
  if (HANDLED_EVENTS.has(eventType)) {
    try {
      await providers.notification.send({
        type: 'webhook',
        title: `Square webhook: ${eventType}`,
        // Ids and the type only: the event's data can hold customer details.
        details: Object.fromEntries(Object.entries({
          eventType,
          eventId: event.event_id,
          objectType: event.data?.type,
          objectId: event.data?.id,
        }).filter(([, v]) => typeof v === 'string' && v)),
        severity: 'info',
        timestamp: new Date().toISOString(),
      })
    } catch (notifyError) {
      logger.error('Failed to send webhook notification', {
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      })
    }
  }

  // Our own classes: POS sales and Square refunds reach the seat ledger. The
  // work runs after the 200 when Netlify gives us waitUntil; a failure is
  // logged, never a non-2xx (Square would retry the event).
  if (CLASS_EVENTS.has(eventType)) {
    const work = Promise.resolve().then(() => handleSquareEvent(event)).catch((err) => {
      logger.error('Class webhook processing failed', { eventType, error: err instanceof Error ? err.message : String(err) })
    })
    const netlify = (locals as { netlify?: { context?: { waitUntil?: (p: Promise<unknown>) => void } } } | undefined)?.netlify?.context
    if (typeof netlify?.waitUntil === 'function') netlify.waitUntil(work)
    else await work // local dev and tests: finish before replying
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
