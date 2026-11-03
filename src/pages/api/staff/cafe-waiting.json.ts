import type { APIRoute } from 'astro'
import { staffAuthorized, byOf } from '@lib/staff-auth'
import { addCafeWaiting, markCafeWaitingSent, removeCafeWaiting, setCafeWaitingSigned, CafeWaitingFullError, WAITING_CAP } from '@lib/open-studio-store'
import { rateLimited } from '@lib/rate-limit'
import { getWaiverRecord } from '@lib/waiver-store'
import { classWritesRefusal } from '@lib/classes/test-site-guard'
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
/** Café waiver texts per crew member: 20 in 10 minutes (a stolen session can't text the town). */
export const CAFE_TEXTS_MAX = 20
export const CAFE_TEXTS_WINDOW_MS = 10 * 60_000
/** Every POST per crew member: 60 in 10 minutes. */
const CAFE_STARTS_MAX = 60
export const WAITING_FULL = `Waiting on a waiver is full today (${WAITING_CAP} families). Remove anyone who has left, then try again.`
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
 * A texted family already waiting isn't texted twice (a double tap) — unless
 * their last text didn't go: then a retry sends it again.
 */
export const POST: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const refusal = classWritesRefusal(request)
  if (refusal) return json({ error: refusal, code: 'NO_TEST_STORE' }, 503)
  const body = await request.json().catch(() => null)
  const how = typeof body?.how === 'string' && HOW.has(body.how) ? (body.how as 'ipad' | 'text' | 'qr') : null
  const name = (typeof body?.name === 'string' ? body.name : '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const digits = (typeof body?.phone === 'string' ? body.phone : '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  if (!how) return json({ error: 'Pick how they’ll sign.' }, 400)
  if (how === 'text' && digits.length !== 10) return json({ error: 'Type their 10-digit mobile number.' }, 400)
  if (how !== 'ipad' && name.length < 2) return json({ error: 'Type their name, so you can find them once they’ve signed.' }, 400)
  if (rateLimited(`cafe-waiting:${staff.id}`, CAFE_STARTS_MAX, CAFE_TEXTS_WINDOW_MS)) {
    return json({ error: 'That’s a lot at once. Wait a few minutes and try again.' }, 429)
  }

  let added
  try {
    added = await addCafeWaiting(today(), { name: name || 'New family', how, by: byOf(staff), ...(how === 'text' ? { phone: digits } : {}) })
  } catch (err) {
    if (err instanceof CafeWaitingFullError) return json({ error: WAITING_FULL }, 409)
    logger.error('Craft Café waiting not saved', { how, error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }

  // Texted already (and it went): nothing to send, nothing to log.
  if (added.existing && added.entry.sent !== false) {
    return json({ data: { id: added.entry.id, existing: true, alreadySent: true } }, 200)
  }

  let sent: boolean | null = null
  if (how === 'text') {
    if (rateLimited(`cafe-texts:${staff.id}`, CAFE_TEXTS_MAX, CAFE_TEXTS_WINDOW_MS)) {
      if (!added.existing) await markCafeWaitingSent(today(), added.entry.id, false).catch(() => {})
      return json({ error: 'That’s a lot of texts at once. Tap Show QR and let them scan it instead.' }, 429)
    }
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
    // Remember whether it went, so a retry after a failed text sends again.
    await markCafeWaitingSent(today(), added.entry.id, sent).catch((err) => {
      logger.error('Craft Café text result not saved', { error: err instanceof Error ? err.message : String(err) })
    })
  }
  await recordAudit({
    by: staff,
    action: how === 'text' ? 'waiver-link.sent' : 'waiver.started',
    target: { kind: 'craft-cafe-waiting', id: added.entry.id, label: added.entry.name },
    details: { where: 'craft-cafe', how, ...(sent !== null ? { sent } : {}), ...(added.existing ? { retry: true } : {}) },
    ...(paymentBypassEnabled(request) ? { simulated: true as const } : {}),
  })
  return json({ data: { id: added.entry.id, existing: added.existing, ...(sent !== null ? { sent } : {}) } }, 200)
}

/**
 * PATCH { id, recordId } → the iPad (kiosk) just finished a café waiver for
 * a waiting family: their row remembers the waiver and takes the signer's
 * name when the crew typed none, so it turns "✓ Signed" even if the check-in
 * that follows doesn't go through. Staff session only (the kiosk has it).
 */
export const PATCH: APIRoute = async ({ request }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const refusal = classWritesRefusal(request)
  if (refusal) return json({ error: refusal, code: 'NO_TEST_STORE' }, 503)
  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' && /^cw_[0-9a-f-]{1,16}$/.test(body.id) ? body.id : ''
  const recordId = typeof body?.recordId === 'string' ? body.recordId.trim() : ''
  if (!id || !recordId) return json({ error: 'Missing id or recordId' }, 400)
  try {
    const w = await getWaiverRecord(recordId)
    if (!w) return json({ error: 'We couldn’t find that waiver.' }, 404)
    const ok = await setCafeWaitingSigned(today(), id, { recordId, name: `${w.adult.firstName} ${w.adult.lastName}`.trim() })
    return json({ data: { ok } }, 200)
  } catch (err) {
    logger.error('Craft Café waiting not updated', { error: err instanceof Error ? err.message : String(err) })
    return json({ error: STORAGE }, 503)
  }
}

/** DELETE ?id= → take a family off "Waiting on a waiver" (they left, or it was a mistake). */
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await staffAuthorized(request)
  if (!staff) return json({ error: 'Unauthorized' }, 401)
  const refusal = classWritesRefusal(request)
  if (refusal) return json({ error: refusal, code: 'NO_TEST_STORE' }, 503)
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
