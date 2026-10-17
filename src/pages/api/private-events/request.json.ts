import type { APIRoute } from 'astro'
import { rateLimited } from '@lib/rate-limit'
import { checkRequest, saveRequest, emailOwners, emailCustomer, ownerText } from '@lib/event-requests'
import { alertOwners } from '@lib/owner-alert'
import { createLogger } from '@lib/logger'

export const prerender = false
const logger = createLogger('api:private-events:request')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * Someone asks about a private event (/private-events). Saved first, then the
 * owners get every answer by email (photos attached) and a short text, and the
 * customer gets a short "got it". A hidden field ("company") is left blank by
 * people and filled by bots.
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(`event-request:${clientAddress}`, 5, 60 * 60_000)) {
    return json(429, { error: 'That’s a lot of tries in a row. Give it a few minutes, then try again.' })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: 'We couldn’t read that. Please try again.' })
  // A bot filled the field people never see: answer as if it worked, keep nothing.
  if (typeof body.company === 'string' && body.company.trim()) return json(200, { data: { ok: true } })

  const checked = checkRequest(body)
  if (!checked.ok) return json(400, { error: checked.error, field: checked.field })

  let saved
  try {
    saved = await saveRequest(checked.value, checked.photos)
  } catch (err) {
    logger.error('Event request not saved', { error: err instanceof Error ? err.message : String(err) })
    return json(502, { error: 'We couldn’t send that just now. Please try again in a minute.' })
  }
  const adminUrl = `${new URL(request.url).origin}/admin`
  const [owners, customer] = await Promise.all([
    emailOwners(saved, checked.photos, adminUrl),
    emailCustomer(saved),
    alertOwners(ownerText(saved, adminUrl)).catch(() => undefined),
  ])
  logger.info('Event request received', { id: saved.id, ownersEmailed: owners, customerEmailed: customer })
  return json(200, { data: { ok: true } })
}
