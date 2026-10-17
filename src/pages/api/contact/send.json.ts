import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { checkMessage, saveMessage, emailOwners, emailSender, ownerText } from '@lib/contact-messages'
import { alertOwners } from '@lib/owner-alert'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:contact:send')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * A message from the contact form (/contact). Saved first, then the owners
 * get it by email (Reply goes to the sender) and a short text, and the sender
 * gets a short "got it". A hidden field ("company") catches bots.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`contact:${clientAddress}`, 5, 60 * 60_000)) {
    return json(429, { error: 'That’s a lot of tries in a row. Give it a few minutes, then try again.' })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: 'We couldn’t read that. Please try again.' })
  if (typeof body.company === 'string' && body.company.trim()) return json(200, { data: { ok: true } })

  const checked = checkMessage(body)
  if (!checked.ok) return json(400, { error: checked.error, field: checked.field })

  let saved
  try {
    saved = await saveMessage(checked.value)
  } catch (err) {
    logger.error('Contact message not saved', { error: err instanceof Error ? err.message : String(err) })
    return json(502, { error: 'We couldn’t send that just now. Please try again in a minute.' })
  }
  const adminUrl = `${new URL(request.url).origin}/admin`
  const [owners, sender] = await Promise.all([
    emailOwners(saved, adminUrl),
    emailSender(saved),
    alertOwners(ownerText(saved, adminUrl)).catch(() => undefined),
  ])
  logger.info('Contact message received', { id: saved.id, ownersEmailed: owners, senderEmailed: sender })
  return json(200, { data: { ok: true } })
}
