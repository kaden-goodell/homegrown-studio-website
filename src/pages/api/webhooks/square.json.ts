import type { APIRoute } from 'astro'
import { createLogger } from '@lib/logger'
import { verifySquareSignature } from '@lib/webhook-verify'
import { providers } from '@config/providers'

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
])

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now()
  const body = await request.text()

  // Verify signature
  const signature = request.headers.get('x-square-hmacsha256-signature') ?? ''

  if (SIGNATURE_KEY && !verifySquareSignature(body, signature, SIGNATURE_KEY, WEBHOOK_URL)) {
    logger.warn('Webhook signature verification failed', {
      duration_ms: Date.now() - startTime,
    })
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse event
  let event: { type?: string; data?: Record<string, unknown> }
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
        details: { eventType, data: event.data },
        severity: 'info',
        timestamp: new Date().toISOString(),
      })
    } catch (notifyError) {
      logger.error('Failed to send webhook notification', {
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      })
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
