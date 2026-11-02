// @vitest-environment node
// More › Email, texts and Square: paste a new Gmail app password or Quo key (never the Square token).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'

const { searchMock, audit, transports } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[], transports: [] as any[] }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
const gmail = vi.hoisted(() => ({ goodPass: 'abcdefghijklmnop' as string, envPass: 'old-env-pass' }))
vi.mock('nodemailer', () => {
  const createTransport = (opts: any) => {
    const t = {
      pass: opts.auth.pass,
      sent: [] as any[],
      verify: vi.fn(async () => { if (opts.auth.pass !== gmail.goodPass && opts.auth.pass !== gmail.envPass) throw Object.assign(new Error('Invalid login'), { code: 'EAUTH', responseCode: 535 }); return true }),
      sendMail: vi.fn(async (m: any) => { if (opts.auth.pass !== gmail.goodPass && opts.auth.pass !== gmail.envPass) throw Object.assign(new Error('Invalid login'), { code: 'EAUTH' }); t.sent.push(m); return {} }),
      close: vi.fn(),
    }
    transports.push(t)
    return t
  }
  return { default: { createTransport }, createTransport }
})
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import * as route from '@pages/api/admin/keys.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeForTests } from '@lib/admin-passcode'
import { adminFailedSignInsToday } from '@lib/admin-signin-failures'
import { sendEmail } from '@lib/email'
import { sendQuoText } from '@lib/quo'
import { _forgetKeyCacheForTests, _resetOutboundKeysForTests, storedKey } from '@lib/outbound-keys'
import { _resetHealthForTests, noteFailure, healthStatus } from '@lib/outbound-health'
import { _resetStaffListForTests, staffListForOwners } from '@lib/staff-directory'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'kaden@example.com', phoneNumber: '+14025550101' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false, emailAddress: 'cat@example.com', phoneNumber: '+12565550104' },
]
const NEW_QUO = 'quo-new-key-123'

let ip = 0
const nextIp = () => `10.9.0.${++ip}`
async function call(method: 'GET' | 'POST', body?: unknown, opts: { who?: string; address?: string } = {}) {
  const request = new Request('https://x.test/api/admin/keys.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': opts.who ?? 'Catherine', cookie: adminCookie().split(';')[0] },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request, clientAddress: opts.address ?? nextIp() } as any)
  return { status: res.status, body: await res.json() }
}

/** The Quo API: phone-numbers answers by key; messages record what was sent and with which key. */
const quoCalls: { url: string; auth: string; body: any }[] = []
function quoServer(numbersFor: Record<string, unknown> = { [NEW_QUO]: { data: [{ id: 'PN1', number: '+12564641710' }] } }) {
  return vi.fn(async (url: string, init: any = {}) => {
    const auth = init.headers?.Authorization ?? ''
    quoCalls.push({ url, auth, body: init.body ? JSON.parse(init.body) : null })
    if (url.endsWith('/phone-numbers')) {
      const answer = numbersFor[auth]
      return answer ? new Response(JSON.stringify(answer), { status: 200 }) : new Response('{}', { status: 401 })
    }
    return new Response('{}', { status: auth === NEW_QUO || auth === 'env-quo' ? 202 : 401 })
  })
}

beforeEach(async () => {
  site.context = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('LOOKUP_SIGNING_SECRET', 'server-only-secret-1')
  vi.stubEnv('GMAIL_USER', 'studio@example.com')
  vi.stubEnv('GMAIL_APP_PASSWORD', gmail.envPass)
  vi.stubEnv('QUO_API_KEY', 'env-quo')
  vi.stubEnv('QUO_FROM_NUMBER', '+12564641710')
  vi.stubEnv('STORE_NAMESPACE', '')
  await _resetAdminPasscodeForTests()
  await _resetOutboundKeysForTests()
  await _resetHealthForTests()
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  await staffListForOwners()
  audit.length = 0
  transports.length = 0
  quoCalls.length = 0
  vi.stubGlobal('fetch', quoServer())
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const sentMails = () => transports.flatMap((t) => t.sent.map((m: any) => ({ ...m, pass: t.pass })))

describe('Paste a new Gmail app password', () => {
  it('Test it: signs in to the studio’s own account with it and emails the signed-in owner; Save it needs the admin passcode; then emails use it (over the site setup’s)', async () => {
    const t = await call('POST', { action: 'test', service: 'gmail', value: 'abcd efgh ijkl mnop' })
    expect(t.body.data).toEqual({ ok: true, message: 'Google accepted it, and a test email went to cat@example.com. Check it arrived, then tap Save it.' })
    expect(sentMails()).toEqual([expect.objectContaining({ to: 'cat@example.com', subject: 'Test email: new Gmail app password', pass: 'abcdefghijklmnop' })])
    expect(transports[0].verify).toHaveBeenCalled()

    expect(await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'wrong' })).toMatchObject({ status: 403 })
    expect(await adminFailedSignInsToday()).toBe(1)
    const saved = await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'owner-secret' })
    expect(saved.status).toBe(200)

    // Stored encrypted, never in the audit or the GET.
    const raw = await readFile(`${process.env.BLOB_STORE_FS_DIR}/outbound-keys/gmail.json`, 'utf8')
    expect(raw).not.toContain('abcdefghijklmnop')
    expect(JSON.stringify(audit)).not.toContain('abcdefghijklmnop')
    expect(audit.map((a) => a.action)).toEqual(['keys.tested', 'keys.saved'])
    const view = (await call('GET')).body.data
    expect(view.gmail).toMatchObject({ setInAdmin: true, by: 'Catherine', broken: false })
    expect(JSON.stringify(view)).not.toContain('abcdefghijklmnop')
    expect(view).toMatchObject({ canStore: true, gmailUser: 'studio@example.com', quoFromLast4: '1710' })

    // Every owner hears; the notice itself goes out with the new password.
    const notice = sentMails().find((m) => /new Gmail app password was saved/.test(m.subject))!
    expect(notice).toMatchObject({ to: 'kaden@example.com, cat@example.com', pass: 'abcdefghijklmnop' })
    expect(quoCalls.some((c) => c.url.endsWith('/messages') && /pasted a new Gmail app password/.test(c.body.content))).toBe(true)

    expect(await sendEmail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })).toEqual({ sent: true })
    expect(sentMails().find((m) => m.to === 'a@example.com')!.pass).toBe('abcdefghijklmnop')
  })

  it('a saved password clears an “emails aren’t going out” warning', async () => {
    await noteFailure('email', 'auth')
    await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })
    await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'owner-secret' })
    expect((await healthStatus({ email: true, text: true, square: true })).email.state).toBe('ok')
  })

  it('refuses: not 16 letters, a password Google refuses, saving one that wasn’t tested (or a different one), the Square token', async () => {
    expect((await call('POST', { action: 'test', service: 'gmail', value: 'short' })).body.data).toEqual({ ok: false, message: route.KEY_MESSAGES.gmailShape })
    expect((await call('POST', { action: 'test', service: 'gmail', value: 'zzzzzzzzzzzzzzzz' })).body.data).toEqual({ ok: false, message: route.KEY_MESSAGES.gmailRefused })
    expect(await call('POST', { action: 'save', service: 'gmail', value: 'zzzzzzzzzzzzzzzz', current: 'owner-secret' })).toMatchObject({ status: 400, body: { error: route.KEY_MESSAGES.testFirst } })
    await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })
    expect(await call('POST', { action: 'save', service: 'gmail', value: 'qqqqqqqqqqqqqqqq', current: 'owner-secret' })).toMatchObject({ status: 400, body: { error: route.KEY_MESSAGES.testFirst } })
    expect(await call('POST', { action: 'save', service: 'square', value: 'EAAA-token', current: 'owner-secret' })).toMatchObject({ status: 400 })
    expect(await storedKey('gmail')).toBeNull()
  })

  it('a test counts for one save only', async () => {
    await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })
    expect((await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'owner-secret' })).status).toBe(200)
    expect(await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'owner-secret' })).toMatchObject({ status: 400, body: { error: route.KEY_MESSAGES.testFirst } })
  })

  it('on the muted test site: Test it only signs in (no email sent), and says so', async () => {
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    vi.stubEnv('SQUARE_ENVIRONMENT', 'sandbox')
    await staffListForOwners()
    const t = await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })
    expect(t.body.data).toEqual({ ok: true, message: 'Google accepted the password. No test email was sent: this is a test site.' })
    expect(sentMails()).toHaveLength(0)
  })
})

describe('Paste a new Quo key', () => {
  it('only a key that lists the studio’s own number; then a test text to the owner’s own mobile; once saved, texts use it', async () => {
    const t = await call('POST', { action: 'test', service: 'quo', value: `  ${NEW_QUO} ` }, { who: 'Kaden' })
    expect(t.body.data).toEqual({ ok: true, message: 'Quo accepted it, and a test text went to your mobile ending 0101. Check it arrived, then tap Save it.' })
    const msg = quoCalls.find((c) => c.url.endsWith('/messages'))!
    expect(msg).toMatchObject({ auth: NEW_QUO, body: { from: '+12564641710', to: ['+14025550101'] } })
    expect((await call('POST', { action: 'save', service: 'quo', value: NEW_QUO, current: 'owner-secret' }, { who: 'Kaden' })).status).toBe(200)
    quoCalls.length = 0
    await sendQuoText({ to: '2565550100', content: 'x' })
    expect(quoCalls[0].auth).toBe(NEW_QUO)
  })

  it('a key for another Quo account, or one Quo refuses, is never saved', async () => {
    vi.stubGlobal('fetch', quoServer({ 'other-account': { data: [{ id: 'PN9', number: '+15555550000' }] } }))
    expect((await call('POST', { action: 'test', service: 'quo', value: 'other-account' }, { who: 'Kaden' })).body.data).toEqual({ ok: false, message: route.KEY_MESSAGES.quoWrongAccount })
    expect((await call('POST', { action: 'test', service: 'quo', value: 'refused-key' }, { who: 'Kaden' })).body.data).toEqual({ ok: false, message: route.KEY_MESSAGES.quoRefused })
    expect(quoCalls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(0)
    expect(await call('POST', { action: 'save', service: 'quo', value: 'other-account', current: 'owner-secret' })).toMatchObject({ status: 400, body: { error: route.KEY_MESSAGES.testFirst } })
  })

  it('no mobile for the signed-in owner says where to add it', async () => {
    expect((await call('POST', { action: 'test', service: 'quo', value: NEW_QUO }, { who: 'Catherine' })).body.data.ok).toBe(true) // Catherine has one
    expect(await call('POST', { action: 'test', service: 'quo', value: NEW_QUO }, { who: '' })).toMatchObject({ status: 400, body: { error: route.KEY_MESSAGES.pickWho } })
  })
})

describe('kept safe', () => {
  it('fail closed: with no LOOKUP_SIGNING_SECRET nothing can be saved, and the site setup’s keys are used', async () => {
    vi.stubEnv('LOOKUP_SIGNING_SECRET', '')
    expect((await call('GET')).body.data.canStore).toBe(false)
    await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })
    expect((await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'owner-secret' })).status).toBe(400) // no test could be recorded
    expect(await storedKey('gmail')).toBeNull()
  })

  it('a saved key that can’t be decrypted (the secret changed) is ignored: the site setup’s is used, and the screen says so', async () => {
    await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })
    await call('POST', { action: 'save', service: 'gmail', value: 'abcdefghijklmnop', current: 'owner-secret' })
    vi.stubEnv('LOOKUP_SIGNING_SECRET', 'a-different-secret')
    _forgetKeyCacheForTests()
    expect(await storedKey('gmail')).toBeNull()
    expect((await call('GET')).body.data.gmail).toMatchObject({ setInAdmin: true, broken: true })
    await sendEmail({ to: 'a@example.com', subject: 's', text: 't', html: 'h' })
    expect(sentMails().filter((m) => m.to === 'a@example.com').at(-1)!.pass).toBe(gmail.envPass)
  })

  it('R41: a test site sharing the live stores can’t test or save', async () => {
    site.context = 'deploy-preview'
    expect((await call('GET')).body.data.readOnly).toBe(true)
    expect(await call('POST', { action: 'test', service: 'gmail', value: 'abcdefghijklmnop' })).toMatchObject({ status: 503, body: { error: route.KEY_MESSAGES.readOnly } })
  })
})
