import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { getEvent, EVENT_KIND_RE, type EventKind } from '@lib/events'
import { getWaiverRecord } from '@lib/waiver-store'
import { quoConfigured, sendQuoText } from '@lib/quo'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'

export const prerender = false

const logger = createLogger('api:staff:send-waiver-link')

// One shared kind validator (@lib/events) rather than a hand-copied literal,
// so every staff surface widens together when Programs land.
const KIND_RE = EVENT_KIND_RE

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Staff-only: text a household the drop-off addendum link when the roster
 * card shows "Addendum not signed" (HOM-213). Best-effort — an unconfigured
 * Quo account or a send failure comes back as `{ sent: false }`, never a
 * hard error, since there's nothing broken to retry (the waiver itself is
 * already saved regardless).
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => null)
  const recordId = typeof body?.recordId === 'string' ? body.recordId.trim() : ''
  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (!recordId || !KIND_RE.test(kind) || !id) return json({ error: 'Missing recordId/kind/id' }, 400)

  try {
    const [waiver, event] = await Promise.all([getWaiverRecord(recordId), getEvent(kind as EventKind, id)])
    if (!waiver) return json({ error: 'Household not found' }, 404)
    if (!event) return json({ error: 'Event not found' }, 404)

    if (!quoConfigured()) return json({ data: { sent: false } }, 200)

    const link = `${siteConfig.url}/waiver?${kind}=${encodeURIComponent(id)}`
    const content = `Hometown Studio: please read and accept the drop-off addendum before ${event.title}: ${link}`

    try {
      await sendQuoText({ to: waiver.adult.phone, content })
    } catch (err) {
      // Never log the phone number or message content — just that it failed.
      logger.error('Addendum link text failed', { recordId, kind, id, error: String(err) })
      return json({ data: { sent: false } }, 200)
    }
    return json({ data: { sent: true } }, 200)
  } catch (err) {
    logger.error('Send-waiver-link failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t reach storage — try again.' }, 503)
  }
}
