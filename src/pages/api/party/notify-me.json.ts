import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { alertOwners } from '@lib/owner-alert'
import { sendSignupConfirmationEmail } from '@lib/email'
import { signupPromise } from '@lib/signup-promise'
import { askedLine } from '@lib/signup-ledger'
import { remember } from '@lib/short-memory'
import { longDate } from '@lib/notify-context'
import { OPENING_DATE } from '@config/opening'
import { partyConfig } from '@config/party.config'

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
 * they wanted), the owners are told by text and by Slack so a person can
 * follow up, and the visitor gets one email confirming what they will hear
 * about. An alert or the email failing never fails the sign-up.
 *
 * The LATER email ("booking is open", "a seat opened") is sent by the
 * scheduled job (api/jobs/signup-emails), which reads the same note.
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
  // The line the scheduled sign-up emails look for (see signup-ledger.ts).
  const note = askedLine(today, interest)

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

  // Tell them they're on the list, and what for. Never confirm a sign-up that was lost.
  let emailSent = false
  try {
    emailSent = (await sendSignupConfirmationEmail({ to: email, ...(await promiseFor(interest)), opensOn: openingDay() })).sent
  } catch (err) {
    logger.error('Sign-up confirmation email failed (sign-up still saved)', {
      email,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return json({ data: { ok: true, emailSent } }, 200)
}

/** "Friday, October 16" until the studio has opened; nothing after. */
function openingDay(): string | undefined {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: partyConfig.timezone })
  return today < OPENING_DATE ? longDate(OPENING_DATE) : undefined
}

/**
 * A workshop is named in the email only if we list one by that name. If the
 * list can't be had in a couple of seconds, the email does without the name.
 */
async function promiseFor(interest: string) {
  let workshopNames: string[] = []
  if (/^workshop(-soon|-waitlist)?:/.test(interest)) {
    try {
      const list = await Promise.race([
        remember('workshops:list', 30_000, () => providers.workshop.listWorkshops()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), 2500)),
      ])
      workshopNames = list.map((w) => w.name)
    } catch {
      /* no name, then */
    }
  }
  return signupPromise(interest, { workshopNames, timeZone: partyConfig.timezone })
}
