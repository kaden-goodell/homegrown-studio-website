import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { createLogger } from '@lib/logger'

const logger = createLogger('api:party:notify-me')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Party-date waitlist: when every date is booked, capture the visitor's email
 * instead of dead-ending them. Creates a minimal (email-only) Square customer
 * and pings Slack so Kaden can follow up when dates open.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim() : ''
    if (!EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 })
    }
    // Optional context, e.g. "kit-theme:sterling" from a theme waitlist card —
    // the longest waitlist tells us which table to stock next.
    const interest = typeof body?.interest === 'string' ? body.interest.trim().slice(0, 80) : ''

    await providers.customer.subscribe(email)
    logger.info('Party waitlist signup', { email, interest: interest || undefined })

    // Best-effort heads-up — a missing Slack webhook must not fail the signup.
    try {
      await providers.notification.send({
        type: 'corporate-inquiry',
        title: interest ? `Waitlist signup — ${interest}` : 'Party waitlist signup',
        details: {
          email,
          ...(interest ? { interest } : {}),
          note: interest ? 'Waitlisted for a specific offering.' : 'Asked to be notified when party dates open.',
        },
        severity: 'info',
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      logger.error('Waitlist Slack notify failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 })
  } catch (err) {
    logger.error('Party waitlist signup failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return new Response(JSON.stringify({ error: 'Signup failed' }), { status: 500 })
  }
}
