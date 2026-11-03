import type { APIRoute } from 'astro'
import { adminActor, adminAuthorized, checkAdminPasscode } from '@lib/admin-auth'
import { resolveOwner } from '@lib/admin-owners'
import { ADMIN_PASSCODE_BUCKET, ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_MESSAGES, ADMIN_PASSCODE_WINDOW_MS, TOO_MANY_TRIES } from '@lib/admin-passcode'
import { adminSlowdown, noteAdminFailedSignIn } from '@lib/admin-signin-failures'
import { ADMIN_WHO_HEADER } from '@lib/admin-who'
import { recordAudit } from '@lib/audit'
import { classWritesRefusal, TestSiteStoreError } from '@lib/classes/test-site-guard'
import { fromHeader, gmailUser } from '@lib/email'
import { createLogger } from '@lib/logger'
import { noteOk } from '@lib/outbound-health'
import { canStoreKeys, keyStatus, KeyStoreError, noteTested, removeKey, saveKey, wasTested, type KeyService } from '@lib/outbound-keys'
import { deviceSaid, studioWhen, tellOwners } from '@lib/owner-notice'
import { messagesMuted } from '@lib/preview-outbound'
import { QUO_MESSAGES_URL, QUO_PHONE_NUMBERS_URL, quoFromNumber, toE164 } from '@lib/quo'
import { rateLimited } from '@lib/rate-limit'
import { json } from '@lib/staffing/http'

export const prerender = false

const logger = createLogger('api:keys')

/** Tests per address: enough to fix a typo a few times, never a way to spam. */
export const KEY_TEST_MAX = 6
export const KEY_TEST_WINDOW_MS = 10 * 60_000
const QUO_TIMEOUT_MS = 8_000

export const KEY_MESSAGES = {
  pickWho: 'Choose who you are at the top of /admin first.',
  noList: 'Start the staff list in Staff › People and add your email and mobile there first.',
  noEmail: 'There’s no email for you in Staff › People. Add yours there, then try again.',
  noPhone: 'There’s no mobile for you in Staff › People. Add yours there, then try again.',
  empty: 'Paste it in first.',
  gmailShape: 'A Google app password is 16 letters (spaces don’t matter). Check you copied all of it.',
  noGmailUser: 'The sending Google account isn’t in the site setup, so a password can’t be used yet. See What to do.',
  noQuoFrom: 'The studio’s Quo number isn’t in the site setup, so a key can’t be checked yet. See What to do.',
  gmailRefused: 'Google didn’t accept that password for the studio’s account. Make a new app password and paste all 16 letters.',
  gmailDown: 'Couldn’t reach Google just now. Try again in a few minutes.',
  gmailSendFailed: 'Google accepted the password, but the test email didn’t go. Try again in a few minutes.',
  quoRefused: 'Quo didn’t accept that key. Make a new one in Quo › Settings › API and paste all of it.',
  quoWrongAccount: 'That key works, but not for the studio’s Quo number. Make the key in the studio’s Quo account.',
  quoDown: 'Couldn’t reach Quo just now. Try again in a few minutes.',
  quoSendFailed: 'Quo accepted the key, but the test text didn’t go. Check the Quo plan is paid, then try again.',
  testFirst: 'Tap Test it with this exact one first (a test counts for 15 minutes).',
  tooMany: 'That’s a lot of tries. Wait a few minutes and try again.',
  readOnly: 'This test site can’t change the live site’s keys.',
} as const

const SERVICE_LABEL: Record<KeyService, string> = { gmail: 'Gmail app password', quo: 'Quo key' }

class KeyTestFailure extends Error {}

/** Spaces in a pasted app password don't matter; a Quo key loses spaces at the ends only. */
function cleanValue(service: KeyService, raw: unknown): string {
  const v = typeof raw === 'string' ? raw : ''
  return service === 'gmail' ? v.replace(/\s+/g, '') : v.trim()
}

/**
 * "Test it" for a Gmail app password: logs in to the studio's own Google
 * account (GMAIL_USER, fixed) with it, then sends the test email to the
 * signed-in owner's own email. On the muted test site it only logs in.
 */
async function testGmail(pass: string, to: string, muted: boolean): Promise<string> {
  const user = gmailUser()
  if (!user) throw new KeyTestFailure(KEY_MESSAGES.noGmailUser)
  if (!/^[A-Za-z]{16}$/.test(pass)) throw new KeyTestFailure(KEY_MESSAGES.gmailShape)
  const { gmailTransport } = await import('@lib/email')
  const t = await gmailTransport(user, pass)
  try {
    await t.verify()
  } catch (e) {
    const err = e as { code?: string; responseCode?: number }
    throw new KeyTestFailure(err.code === 'EAUTH' || err.responseCode === 535 || err.responseCode === 534 ? KEY_MESSAGES.gmailRefused : KEY_MESSAGES.gmailDown)
  }
  if (muted) return 'Google accepted the password. No test email was sent: this is a test site.'
  try {
    const line = 'This is the test email for the new Gmail app password you pasted in /admin. If you’re reading it, it works. Tap Save it in /admin to use it.'
    await t.sendMail({ from: fromHeader(), to, subject: 'Test email: new Gmail app password', text: line, html: `<p>${line}</p>` })
  } catch {
    throw new KeyTestFailure(KEY_MESSAGES.gmailSendFailed)
  } finally {
    t.close?.()
  }
  return `Google accepted it, and a test email went to ${to}. Check it arrived, then tap Save it.`
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/**
 * "Test it" for a Quo key: the key must list the studio's own number
 * (QUO_FROM_NUMBER) under GET /phone-numbers, so it is provably the studio's
 * account; then a test text goes to the signed-in owner's own mobile. On the
 * muted test site only the number check runs.
 */
async function testQuo(key: string, to: string, muted: boolean): Promise<string> {
  const from = quoFromNumber()
  if (!from) throw new KeyTestFailure(KEY_MESSAGES.noQuoFrom)
  let res: Response
  try {
    res = await fetch(QUO_PHONE_NUMBERS_URL, { headers: { Authorization: key, Accept: 'application/json' }, signal: AbortSignal.timeout(QUO_TIMEOUT_MS) })
  } catch {
    throw new KeyTestFailure(KEY_MESSAGES.quoDown)
  }
  if (res.status === 401 || res.status === 403) throw new KeyTestFailure(KEY_MESSAGES.quoRefused)
  if (!res.ok) throw new KeyTestFailure(KEY_MESSAGES.quoDown)
  const body: any = await res.json().catch(() => null)
  const list: any[] = Array.isArray(body?.data) ? body.data : []
  const want = digits(from).slice(-10)
  const ours = list.some((n) => [n?.number, n?.phoneNumber, n?.formattedNumber].some((x) => x && digits(x).slice(-10) === want))
  if (!ours) throw new KeyTestFailure(KEY_MESSAGES.quoWrongAccount)
  if (muted) return 'Quo accepted the key, and it’s the studio’s number. No test text was sent: this is a test site.'
  const toE = toE164(to)
  let sent: Response
  try {
    sent = await fetch(QUO_MESSAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ content: 'Hometown Studio: this is the test text for the new Quo key you pasted in /admin. Tap Save it in /admin to use it.', from, to: [toE] }),
      signal: AbortSignal.timeout(QUO_TIMEOUT_MS),
    })
  } catch {
    throw new KeyTestFailure(KEY_MESSAGES.quoSendFailed)
  }
  if (!sent.ok) throw new KeyTestFailure(KEY_MESSAGES.quoSendFailed)
  return `Quo accepted it, and a test text went to your mobile ending ${digits(to).slice(-4)}. Check it arrived, then tap Save it.`
}

/**
 * Owners only: More › Email, texts and Square › "Paste a new Gmail app
 * password" / "Paste a new Quo key". NEVER the Square token.
 * GET → { gmail: KeyStatus, quo: KeyStatus, canStore, gmailUser, quoFromLast4, readOnly, muted }
 *   Never a key.
 * POST { action: 'test', service, value } → { ok, message }
 *   Gmail: logs in to the studio's account with it and emails the signed-in
 *   owner's own address. Quo: checks the key lists the studio's number, then
 *   texts the owner's own mobile. Remembers (a fingerprint) that it worked.
 * POST { action: 'save', service, value, current } → { updatedAt }
 *   The current admin passcode again (tries shared with sign-in); only a key
 *   that passed Test it in the last 15 minutes. Encrypted at rest; wins over
 *   the site setup's. Audited (never the key); every owner emailed and texted.
 * POST { action: 'remove', service, current } → { removed }
 *   "Use the hosting setting instead" (N4): the current admin passcode again;
 *   forgets the key saved here so the hosting setting is used. Audited; every
 *   owner emailed and texted.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const [gmail, quo] = await Promise.all([keyStatus('gmail'), keyStatus('quo')])
  return json(200, {
    data: {
      gmail, quo,
      canStore: canStoreKeys(),
      gmailUser: gmailUser() || null,
      quoFromLast4: digits(quoFromNumber()).slice(-4) || null,
      readOnly: !!classWritesRefusal(),
      muted: messagesMuted(),
    },
  })
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!(await adminAuthorized(request))) return json(401, { error: 'Sign in first.' })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return json(400, { error: "We couldn't read that. Try again." })
  const { action, service } = body as { action?: unknown; service?: unknown }
  if (service !== 'gmail' && service !== 'quo') return json(400, { error: 'Pick Gmail or Quo.' })
  if (action !== 'test' && action !== 'save' && action !== 'remove') return json(400, { error: 'Pick Test it or Save it.' })
  if (classWritesRefusal()) return json(503, { error: KEY_MESSAGES.readOnly })
  const value = cleanValue(service, (body as { value?: unknown }).value)
  if (!value && action !== 'remove') return json(400, { error: KEY_MESSAGES.empty })
  const by = await adminActor(request)
  const audit = (what: string, details: Record<string, string | number | boolean | null>) =>
    recordAudit({ by: { ...by, role: 'owner' }, action: `keys.${what}`, target: { kind: 'settings', id: `key-${service}`, label: SERVICE_LABEL[service] }, details })

  if (action === 'test') {
    if (rateLimited(`key-test:${String(clientAddress ?? 'unknown')}`, KEY_TEST_MAX, KEY_TEST_WINDOW_MS)) return json(429, { error: KEY_MESSAGES.tooMany })
    const owner = await resolveOwner(request.headers.get(ADMIN_WHO_HEADER))
    if (!owner) return json(400, { error: KEY_MESSAGES.pickWho })
    if (!owner.id) return json(400, { error: KEY_MESSAGES.noList })
    const to = service === 'gmail' ? owner.email : owner.phone
    if (!to) return json(400, { error: service === 'gmail' ? KEY_MESSAGES.noEmail : KEY_MESSAGES.noPhone })
    try {
      const message = service === 'gmail' ? await testGmail(value, to, messagesMuted()) : await testQuo(value, to, messagesMuted())
      await noteTested(service, value)
      await audit('tested', { ok: true })
      return json(200, { data: { ok: true, message } })
    } catch (e) {
      await audit('tested', { ok: false })
      if (e instanceof KeyTestFailure) return json(200, { data: { ok: false, message: e.message } })
      logger.error('Key test failed oddly', { service, error: e instanceof Error ? e.message : String(e) })
      return json(200, { data: { ok: false, message: service === 'gmail' ? KEY_MESSAGES.gmailDown : KEY_MESSAGES.quoDown } })
    }
  }

  // Save or remove: the current admin passcode again, counted like a sign-in try before anything else.
  if (rateLimited(ADMIN_PASSCODE_BUCKET(clientAddress), ADMIN_PASSCODE_MAX_TRIES, ADMIN_PASSCODE_WINDOW_MS)) return json(429, { error: TOO_MANY_TRIES })
  const slow = await adminSlowdown()
  if (slow) return json(429, slow)
  const current = typeof (body as { current?: unknown }).current === 'string' ? (body as { current: string }).current : ''
  if (!(await checkAdminPasscode(current))) {
    await noteAdminFailedSignIn()
    return json(403, { error: current && current !== current.trim() ? ADMIN_PASSCODE_MESSAGES.currentSpaces : ADMIN_PASSCODE_MESSAGES.current })
  }
  if (action === 'remove') {
    try {
      const removed = await removeKey(service, by)
      await audit('removed', { removed })
      if (removed) {
        await tellOwners({
          subject: `The ${SERVICE_LABEL[service]} pasted in /admin was removed`,
          line: `${deviceSaid(by)} removed the ${SERVICE_LABEL[service]} pasted in /admin (${studioWhen()}). ${service === 'gmail' ? 'Emails' : 'Texts'} from the website now use the one in the hosting settings. If none of you did this, sign in to /admin, change the admin passcode, and check More › Email, texts and Square.`,
        })
      }
      return json(200, { data: { removed } })
    } catch (e) {
      if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
      logger.error('Key could not be removed', { service, error: e instanceof Error ? e.message : String(e) })
      return json(503, { error: 'That didn’t go through. Try again in a minute.' })
    }
  }
  if (!(await wasTested(service, value))) return json(400, { error: KEY_MESSAGES.testFirst })
  try {
    const { updatedAt } = await saveKey(service, value, by)
    await audit('saved', {})
    // It just worked, so a "not going out" warning for it can clear.
    await noteOk(service === 'gmail' ? 'email' : 'text')
    await tellOwners({
      subject: `A new ${SERVICE_LABEL[service]} was saved in /admin`,
      line: `${deviceSaid(by)} pasted a new ${SERVICE_LABEL[service]} (${studioWhen()}). ${service === 'gmail' ? 'Emails' : 'Texts'} from the website now go out with it. If none of you did this, sign in to /admin, change the admin passcode, and check More › Email, texts and Square.`,
    })
    return json(200, { data: { updatedAt } })
  } catch (e) {
    if (e instanceof KeyStoreError) return json(e.status, { error: e.message })
    if (e instanceof TestSiteStoreError) return json(503, { error: e.message })
    logger.error('Key could not be saved', { service, error: e instanceof Error ? e.message : String(e) })
    return json(503, { error: 'That didn’t save. Try again in a minute.' })
  }
}
