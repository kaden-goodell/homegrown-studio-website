import type { APIRoute } from 'astro'
import { staffAuthorized } from '@lib/staff-auth'
import { getEvent, EVENT_KIND_RE, type EventKind } from '@lib/events'
import { getWaiverRecord } from '@lib/waiver-store'
import { quoConfigured, sendQuoText } from '@lib/quo'
import { siteConfig } from '@config/site.config'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import { withUtm } from '@lib/utm'
import { paymentBypassEnabled } from '@lib/dev-flags'
import { listSeatChoicesByEvent } from '@lib/seat-choices'
import { getLedger } from '@lib/classes/seat-ledger'
import type { StudioEvent } from '@lib/events'

export const prerender = false

const logger = createLogger('api:staff:send-waiver-link')

// One shared kind validator (@lib/events) rather than a hand-copied literal,
// so every staff surface widens together when Programs land.
const KIND_RE = EVENT_KIND_RE

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * A class booker who hasn't signed yet (the roster's "Paid or comped, not
 * signed in yet" row): their name and phone from the booking itself. The
 * phone never goes back to the browser.
 */
async function bookedContact(event: StudioEvent, email: string): Promise<{ name: string; phone: string } | null> {
  const want = email.trim().toLowerCase()
  if (event.own) {
    const line = (await getLedger(event.id)).lines.find((l) => l.customer?.email.trim().toLowerCase() === want && l.customer.phone)
    return line?.customer ? { name: `${line.customer.givenName} ${line.customer.familyName}`.trim(), phone: line.customer.phone } : null
  }
  const rec = (await listSeatChoicesByEvent('workshop', event.id)).find((r) => r.customer.email.trim().toLowerCase() === want && r.customer.phone)
  return rec ? { name: `${rec.customer.givenName} ${rec.customer.familyName}`.trim(), phone: rec.customer.phone } : null
}

/**
 * Staff-only: text a household the link to sign the participation agreement
 * for an event. Best-effort — an unconfigured
 * Quo account or a send failure comes back as `{ sent: false }`, never a
 * hard error, since there's nothing broken to retry (the waiver itself is
 * already saved regardless).
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)

  const body = await request.json().catch(() => null)
  const recordId = typeof body?.recordId === 'string' ? body.recordId.trim() : ''
  // A class booker with no waiver yet: found by the email on their booking instead.
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const kind = typeof body?.kind === 'string' ? body.kind : ''
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if ((!recordId && !email) || !KIND_RE.test(kind) || !id) return json({ error: 'Missing recordId/kind/id' }, 400)

  try {
    const [waiver, event] = await Promise.all([recordId ? getWaiverRecord(recordId) : Promise.resolve(null), getEvent(kind as EventKind, id, { squareParties: true })])
    if (recordId && !waiver) return json({ error: 'Household not found' }, 404)
    if (!event) return json({ error: 'Event not found' }, 404)
    const booked = !recordId && kind === 'workshop' ? await bookedContact(event, email) : null
    if (!recordId && !booked) return json({ error: 'There’s no phone number on their booking. Show them the QR code instead.' }, 404)
    const to = waiver ? waiver.adult.phone : booked!.phone
    const who = waiver ? `${waiver.adult.firstName} ${waiver.adult.lastName}`.trim() : booked!.name

    if (!quoConfigured()) return json({ data: { sent: false } }, 200)

    const link = withUtm(`${siteConfig.url}/waiver?${kind}=${encodeURIComponent(id)}`, { source: 'text', medium: 'sms', campaign: 'waiver_link' })
    const content = `Hometown Studio here. Please sign the participation agreement for ${event.title} ${link}`

    try {
      await sendQuoText({ to, content })
    } catch (err) {
      // Never log the phone number or message content — just that it failed.
      logger.error('Waiver link text failed', { recordId: recordId || null, kind, id, error: String(err) })
      return json({ data: { sent: false } }, 200)
    }
    await recordAudit({
      by: staff,
      action: 'waiver-link.sent',
      target: { kind: 'household', id: recordId || `booking:${email.toLowerCase()}`, label: who },
      details: { eventKind: kind, eventId: id, eventTitle: event.title },
      ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
    })
    return json({ data: { sent: true } }, 200)
  } catch (err) {
    logger.error('Send-waiver-link failed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Couldn’t reach storage — try again.' }, 503)
  }
}
