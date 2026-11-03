import type { APIRoute } from 'astro'
import { providers } from '@config/providers'
import { SITE_URL } from '@config/site-url'
import { createLogger } from '@lib/logger'
import { rateLimited } from '@lib/rate-limit'
import { remember } from '@lib/short-memory'
import { reportServerEvent } from '@lib/posthog-server'
import { sendClassLinkEmail, type ClassForEmail } from '@lib/class-link-email'
import { getClass } from '@lib/classes/class-store'
import { ownClassForEmail } from '@lib/classes/class-for-email'

export const prerender = false
const logger = createLogger('api:workshops:email-me')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OWN_CLASS_ID = /^cls_[a-z0-9]{4,40}$/

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * "Not ready to book? Email me this class." Sends one email about one class to
 * the address given, and (only if they ticked the box) adds them to the
 * new-classes list. The class is looked up by id, never taken from the request,
 * so this can't be used to email anyone words of our choosing — and an
 * address only gets a few of these a day, so it can't flood someone's inbox.
 *
 * Our own classes (ids `cls_…`) are read from our class store: open or
 * stopped, link-only too (the visitor is on its page), with a date still to
 * come; the email links to its own page. Anything else is a Square class.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`class-email:${clientAddress}`, 5, 10 * 60_000)) {
    return json({ error: 'Too many emails from this connection. Please try again in a few minutes.' }, 429)
  }

  const body = await request.json().catch(() => null)
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const classId = typeof body?.classId === 'string' ? body.classId.trim() : ''
  const alsoNews = body?.alsoNews === true
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'Invalid email' }, 400)
  if (!classId || classId.length > 100) return json({ error: 'Which class?' }, 400)

  if (rateLimited(`class-email-to:${email.toLowerCase()}`, 3, 24 * 60 * 60_000)) {
    return json({ error: 'We have already sent a few of these to that address today.' }, 429)
  }

  let found: ClassForEmail | undefined
  try {
    if (OWN_CLASS_ID.test(classId)) {
      found = ownClassForEmail(await getClass(classId), new Date())
    } else {
      const list = await remember('workshops:list', 30_000, () => providers.workshop.listWorkshops())
      found = list.find((w) => w.id === classId)
    }
  } catch (err) {
    logger.error('Class list unreadable for email-me', { classId, error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Could not send' }, 502)
  }
  if (!found) return json({ error: 'That class is no longer listed.' }, 404)

  const { sent } = await sendClassLinkEmail(email, found, SITE_URL)
  if (!sent) {
    logger.error('Class email not sent', { classId, email })
    return json({ error: 'Could not send' }, 502)
  }

  // The box is optional and unticked by default; a failure here never undoes the email.
  let subscribed = false
  if (alsoNews) {
    try {
      await providers.customer.subscribe(email)
      subscribed = true
    } catch (err) {
      logger.error('New-classes sign-up from class email failed (email still sent)', { email, error: err instanceof Error ? err.message : String(err) })
    }
  }

  logger.info('Class emailed', { classId, className: found.name, email, alsoNews })
  await reportServerEvent({
    requestUrl: request.url,
    event: 'class_emailed',
    distinctId: email,
    posthogId: body?.posthogId,
    properties: { item_id: found.id, item_name: found.name, also_news: alsoNews, subscribed },
  })
  return json({ data: { sent: true, subscribed } }, 200)
}
