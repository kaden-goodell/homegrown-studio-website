import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { addCafeWaiting, removeCafeWaiting } from '@lib/open-studio-store'
import { quoConfigured, sendQuoText } from '@lib/quo'
import { siteConfig } from '@config/site.config'
import { withUtm } from '@lib/utm'
import { studioDate } from '@lib/studio-time'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import { paymentBypassEnabled } from '@lib/dev-flags'

export const prerender = false

const logger = createLogger('api:staff:cafe-waiting')
const STORAGE = 'Couldn’t reach storage — check wifi and try again.'
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const HOW = new Set(['ipad', 'text', 'qr'])
const today = () => studioDate(new Date().toISOString())

/** The link a Craft Café walk-in signs from (no event: signing covers the café). */
export function cafeWaiverLink(): string {
  return withUtm(`${siteConfig.url}/waiver`, { source: 'text', medium: 'sms', campaign: 'waiver_link' })
}

/**
 * POST { name, how: 'ipad' | 'text' | 'qr', phone? } → a new family at Craft
 * Café today is starting the waiver: they go on "Waiting on a waiver" until
 * they're checked in. `text` also texts them the waiver link (needs a mobile
 * number). Waiver first, always: nobody is checked in here.
 * A texted family already waiting isn't texted twice (a double tap).
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const body = await request.json().catch(() => null)
  const how = typeof body?.how === 'string' && HOW.has(body.how) ? (body.how as 'ipad' | 'text' | 'qr') : null
  const name = (typeof body?.name === 'string' ? body.name : '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const digits = (typeof body?.phone === 'string' ? body.phone : '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  if (!how) return json({ error: 'Pick how they’ll sign.' }, 400)
  if (how === 'text' && digits.length !== 10) return json({ error: 'Type their 10-digit mobile number.' }, 400)
  if (how !== 'ipad' && name.length < 2) return json({ error: 'Type their name, so you can find them once they’ve signed.' }, 400)

  let added
  try {
    added = await addCafeWaiting(today(), { name: name || 'New family', how, by: byOf(staff), ...(how === 'text' ? { phone: digits } : {}) })
  } catch (err) {
    logger.error('Craft Café waiting not saved', { how, error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }

  let sent: boolean | null = null
  if (how === 'text' && !added.existing) {
    sent = false
    if (quoConfigured()) {
      try {
        await sendQuoText({ to: digits, content: `Hometown Studio here. Please sign the participation agreement for Craft Café ${cafeWaiverLink()}` })
        sent = true
      } catch (err) {
        // Never log the phone number or message content — just that it failed.
        logger.error('Craft Café waiver text failed', { error: String(err) })
      }
    }
  }
  await recordAudit({
    by: staff,
    action: how === 'text' ? 'waiver-link.sent' : 'waiver.started',
    target: { kind: 'craft-cafe-waiting', id: added.entry.id, label: added.entry.name },
    details: { where: 'craft-cafe', how, ...(sent !== null ? { sent } : {}) },
    ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
  })
  return json({ data: { id: added.entry.id, existing: added.existing, ...(sent !== null ? { sent } : {}) } }, 200)
}

/** DELETE ?id= → take a family off "Waiting on a waiver" (they left, or it was a mistake). */
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const id = (url ?? new URL(request.url)).searchParams.get('id') ?? ''
  if (!id) return json({ error: 'Missing id' }, 400)
  let gone
  try {
    gone = await removeCafeWaiting(today(), [id])
  } catch (err) {
    logger.error('Craft Café waiting not removed', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }
  if (gone.length) {
    await recordAudit({
      by: staff,
      action: 'waiver.waiting-removed',
      target: { kind: 'craft-cafe-waiting', id, label: gone[0].name },
      details: { where: 'craft-cafe' },
      ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
    })
  }
  return json({ data: { ok: true } }, 200)
}
