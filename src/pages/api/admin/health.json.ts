import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized } from '@lib/admin-auth'
import { resolveOwner } from '@lib/admin-owners'
import { ADMIN_WHO_HEADER } from '@lib/admin-who'
import { recordAudit } from '@lib/audit'
import { squareFetch, squareSettings } from '@lib/classes/square-api'
import { sendEmail } from '@lib/email'
import { createLogger } from '@lib/logger'
import { outboundConfigured, outboundHealthNow } from '@lib/outbound-status'
import { messagesMuted } from '@lib/preview-outbound'
import { sendQuoText } from '@lib/quo'
import { rateLimited } from '@lib/rate-limit'
import { json } from '@lib/staffing/http'

export const prerender = false

const logger = createLogger('api:health')

/** Test sends per address: enough to try a fix twice over, never a way to spam anyone. */
export const TEST_MAX = 6
export const TEST_WINDOW_MS = 10 * 60_000

export const HEALTH_MESSAGES = {
  pickWho: 'Choose who you are at the top of /admin first.',
  noEmail: 'There’s no email for you in Staff › People. Add yours there, then try again.',
  noPhone: 'There’s no mobile for you in Staff › People. Add yours there, then try again.',
  noList: 'Start the staff list in Staff › People and add your email and mobile there first.',
  emailNotSet: 'Emails aren’t set up on this site, so none can go out. See What to do.',
  textNotSet: 'Texts aren’t set up on this site, so none can go out. See What to do.',
  squareNotSet: 'Square isn’t set up on this site. See What to do.',
  emailFailed: 'The test email didn’t go. Emails aren’t going out: see What to do.',
  textFailed: 'The test text didn’t go. Texts aren’t going out: see What to do.',
  squareRefused: 'Square refused the website’s key. See What to do.',
  squareDown: 'Couldn’t reach Square just now. Try again in a few minutes. If it keeps happening, see What to do.',
  tooMany: 'That’s a lot of tests. Wait a few minutes and try again.',
  /** M5: the sandbox preview sends nothing at all, so a test there proves nothing and is never a success. */
  muted: 'Not sent — this is a test site, so no emails or texts go out here. It’s listed in More › Messages.',
} as const

/** A test site with messages turned back on (PREVIEW_MESSAGES=on): everything goes to the test inbox and phone (preview-outbound.ts). */
const onTestSite = () => !!(typeof process !== 'undefined' && (process.env.STORE_NAMESPACE ?? '').trim())

const configured = outboundConfigured

/**
 * Owners only: are emails, texts and Square getting through (G2)?
 * GET → { email, text, square: { state: ok|failing|not-set|unknown, since, kind, count, lastOkAt }, testSite }
 * POST { action: 'test-email' | 'test-text' | 'check-square' } → { ok, message }
 *   The test email and text go to the signed-in owner's own email and mobile
 *   on the staff list (on a test site with messages on, to the test inbox and
 *   phone instead; on the muted test site nothing is sent and the answer says
 *   "Not sent", never a success).
 *   Check Square makes one read. Each result also updates the health record
 *   (a working send clears the warning). Rate limited; audited (never contact details).
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  return json(200, { data: { ...(await outboundHealthNow()), testSite: onTestSite(), muted: messagesMuted() } })
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  const action = body && typeof body === 'object' ? (body as { action?: unknown }).action : null
  if (action !== 'test-email' && action !== 'test-text' && action !== 'check-square') return json(400, { error: 'Pick a test.' })
  if (rateLimited(`health-test:${String(clientAddress ?? 'unknown')}`, TEST_MAX, TEST_WINDOW_MS)) return json(429, { error: HEALTH_MESSAGES.tooMany })
  const by = await adminActor(request)
  const audit = (ok: boolean) => recordAudit({ by: { ...by, role: 'owner' }, action: `health.${action}`, target: { kind: 'settings', id: 'health', label: 'Email, texts and Square' }, details: { ok } })

  if (action === 'check-square') {
    if (!(await configured()).square) return json(200, { data: { ok: false, message: HEALTH_MESSAGES.squareNotSet } })
    const { locationId } = squareSettings()
    try {
      await squareFetch(locationId ? `/locations/${encodeURIComponent(locationId)}` : '/locations')
      await audit(true)
      return json(200, { data: { ok: true, message: 'Square answered. The website’s connection to Square is working.' } })
    } catch (e) {
      const { status, keyRefused } = e as { status?: number; keyRefused?: boolean }
      await audit(false)
      logger.warn('Check Square failed', { status })
      return json(200, { data: { ok: false, message: keyRefused ? HEALTH_MESSAGES.squareRefused : HEALTH_MESSAGES.squareDown } })
    }
  }

  const owner = await resolveOwner(request.headers.get(ADMIN_WHO_HEADER))
  if (!owner) return json(400, { error: HEALTH_MESSAGES.pickWho })
  if (!owner.id) return json(400, { error: HEALTH_MESSAGES.noList })
  const note = onTestSite() ? ' This is a test site, so it goes to the test inbox and phone instead.' : ''
  // M5: on the muted test site nothing is sent; say so, never "Sent", and never count it as working.
  const mutedAnswer = async () => {
    await recordAudit({ by: { ...by, role: 'owner' }, action: `health.${action}`, target: { kind: 'settings', id: 'health', label: 'Email, texts and Square' }, details: { ok: false, muted: true } })
    return json(200, { data: { ok: false, muted: true, message: HEALTH_MESSAGES.muted } })
  }

  if (action === 'test-email') {
    if (!owner.email) return json(400, { error: HEALTH_MESSAGES.noEmail })
    if (messagesMuted()) return mutedAnswer()
    if (!(await configured()).email) return json(200, { data: { ok: false, message: HEALTH_MESSAGES.emailNotSet } })
    const line = `This is the test email you asked for from /admin. If you’re reading it, emails from the website are going out.`
    const { sent } = await sendEmail({ to: owner.email, subject: 'Test email from the Hometown Studio website', text: line, html: `<p>${line}</p>` })
    await audit(sent)
    return json(200, { data: { ok: sent, message: sent ? `Sent to ${owner.email}. Check your inbox (and spam) in a minute.${note}` : HEALTH_MESSAGES.emailFailed } })
  }

  if (!owner.phone) return json(400, { error: HEALTH_MESSAGES.noPhone })
  if (messagesMuted()) return mutedAnswer()
  if (!(await configured()).text) return json(200, { data: { ok: false, message: HEALTH_MESSAGES.textNotSet } })
  try {
    await sendQuoText({ to: owner.phone, content: 'Hometown Studio: this is the test text you asked for from /admin. Texts from the website are going out.' })
    await audit(true)
    return json(200, { data: { ok: true, message: `Sent to your mobile ending ${owner.phone.replace(/\D/g, '').slice(-4)}.${note}` } })
  } catch (e) {
    await audit(false)
    logger.warn('Test text failed', { error: e instanceof Error ? e.message : String(e) })
    return json(200, { data: { ok: false, message: HEALTH_MESSAGES.textFailed } })
  }
}
