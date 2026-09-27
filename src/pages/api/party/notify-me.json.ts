import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { alertOwners } from '@lib/owner-alert'

const logger = createLogger('api:party:notify-me')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * "Tell me when…" sign-ups: booking not open yet, every party date taken, a
 * sold-out workshop, a party planned further ahead than we take bookings.
 * Deliberately NOT behind the bookings gate — it is what the closed pages use.
 *
 * The sign-up is kept in the customer record (email, plus a note saying what
 * they wanted), and the owners are told by text and by Slack so a person can
 * follow up. An alert failing never fails the sign-up.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`notify-me:${clientAddress}`, 5, 10 * 60_000)) {
    return json({ error: 'Too many sign-ups from this connection. Please try again in a few minutes.' }, 429)
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email' }, 400)

  // Optional context, e.g. "workshop:Kinusaiga 2026-10-16" or "kit-theme:sterling".
  // The longest list tells us what to schedule or stock next.
  const interest = typeof body?.interest === 'string' ? body.interest.trim().slice(0, 80) : ''
  const today = new Date().toISOString().slice(0, 10)
  const note = `${today} Asked to be told: ${interest || 'when booking opens'}`

  let saved = true
  try {
    await providers.customer.subscribe(email, note)
    logger.info('Notify-me sign-up saved', { email, interest: interest || undefined })
  } catch (err) {
    saved = false
    logger.error('Notify-me sign-up could not be saved', {
      email,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  // Best-effort heads-up to the owners on both channels.
  const summary = `Site sign-up: ${email} wants to hear about ${interest || 'booking opening'}.${saved ? '' : ' (not saved to Square — add them by hand)'}`
  const [text] = await Promise.allSettled([
    alertOwners(summary),
    providers.notification.send({
      type: 'corporate-inquiry',
      title: interest ? `Sign-up — ${interest}` : 'Sign-up — tell me when booking opens',
      details: {
        email,
        ...(interest ? { interest } : {}),
        saved: saved ? 'yes' : 'NO — add to Square by hand',
      },
      severity: saved ? 'info' : 'warning',
      timestamp: new Date().toISOString(),
    }),
  ])
  const ownerTold = text.status === 'fulfilled' && text.value.sent > 0

  // Lost only if it was neither saved nor put in front of a person.
  if (!saved && !ownerTold) return json({ error: 'Signup failed' }, 500)
  return json({ data: { ok: true } }, 200)
}
