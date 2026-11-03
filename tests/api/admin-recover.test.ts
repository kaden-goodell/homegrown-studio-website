// @vitest-environment node
// "Forgot the passcode?" (audit B M3): the emailed, single-use, 15-minute link.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { searchMock, audit, sendMail } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[], sendMail: vi.fn() }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) }, createTransport: () => ({ sendMail }) }))
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import * as recover from '@pages/api/admin/recover.json'
import * as loginRoute from '@pages/api/admin/login.json'
import * as accessRoute from '@pages/api/admin/admin-access.json'
import * as toDecide from '@pages/api/admin/to-decide.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeForTests, _writeRawAdminPasscodeForTests, ADMIN_PASSCODE_MESSAGES } from '@lib/admin-passcode'
import { RECOVERY_MESSAGES, RECOVERY_PER_HOUR, RECOVERY_TTL_MS, recoveryOrigin } from '@lib/admin-recovery'
import { adminFailedSignInsToday } from '@lib/admin-signin-failures'
import { _resetStaffListForTests, addPerson, staffListForOwners } from '@lib/staff-directory'
import { _resetPasscodeForTests } from '@lib/staff-passcode'
import { _resetHealthForTests } from '@lib/outbound-health'
import { makeKvStore } from '@lib/blob-store'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'kaden@example.com', phoneNumber: '+14025550101' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false, emailAddress: 'cat@example.com', phoneNumber: '+12565550104' },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false, emailAddress: 'jess@example.com', phoneNumber: '+12565550102' },
]
const BY = { id: 'owner-catherine', name: 'Catherine' }

let ip = 0
const nextIp = () => `10.8.0.${++ip}`
const texts: { to: string[]; content: string }[] = []

async function call(body: unknown, opts: { address?: string; url?: string } = {}) {
  const request = new Request(opts.url ?? 'https://ourhometownstudio.com/api/admin/recover.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const res = await recover.POST({ request, clientAddress: opts.address ?? nextIp() } as any)
  return { status: res.status, body: await res.json(), cookie: res.headers.get('Set-Cookie')?.split(';')[0] ?? null, headers: res.headers }
}
async function login(passcode: string) {
  const res = await loginRoute.POST({ request: new Request('https://x.test/api/admin/login.json', { method: 'POST', body: JSON.stringify({ passcode }) }), clientAddress: nextIp() } as any)
  return { status: res.status }
}
const signedIn = async (cookie: string) => (await (toDecide as any).GET({ request: new Request('https://x.test/api/admin/to-decide.json', { headers: { cookie } }), url: new URL('https://x.test/api/admin/to-decide.json') })).status
const mails = () => sendMail.mock.calls.map((c) => c[0])
/** The link in the last recovery email. */
function lastToken(): string {
  const m = [...mails()].reverse().find((x) => /Set a new \/admin passcode/.test(x.subject))
  const t = /\/admin\/recover\?t=([A-Za-z0-9_-]+)/.exec(m?.text ?? '')
  if (!t) throw new Error('no link sent')
  return t[1]
}
const use = (token: string, passcode: string, again = passcode, address?: string) => call({ action: 'use', token, passcode, again }, { address })
/** Forget the live link (as if it ran out), so the next request sends a new one. */
const forgetLiveLink = () => makeKvStore('admin-access', 'admin-access').set('recovery-current', 'null')

beforeEach(async () => {
  site.context = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  vi.stubEnv('GMAIL_USER', 'bot@example.com')
  vi.stubEnv('GMAIL_APP_PASSWORD', 'app-pass')
  vi.stubEnv('QUO_API_KEY', 'k')
  vi.stubEnv('QUO_FROM_NUMBER', '+12564641710')
  vi.stubEnv('STORE_NAMESPACE', '')
  await _resetAdminPasscodeForTests()
  await _resetPasscodeForTests()
  await _resetStaffListForTests()
  await _resetHealthForTests()
  await makeKvStore('admin-access', 'admin-access').set('recovery-requests', 'null')
  await makeKvStore('admin-access', 'admin-access').set('recovery-current', 'null')
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  sendMail.mockReset()
  sendMail.mockResolvedValue({})
  audit.length = 0
  texts.length = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => { texts.push(JSON.parse(init.body)); return new Response('{}', { status: 202 }) }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Forgot the passcode? › Email the owners a link', () => {
  it('goes to every active Owner’s staff-list email (never crew), one email, the same answer every time; audited without the link or emails', async () => {
    await staffListForOwners()
    const r = await call({ action: 'request' })
    expect(r).toMatchObject({ status: 200, body: { data: { message: RECOVERY_MESSAGES.sent } } })
    expect(mails()).toHaveLength(1)
    expect(mails()[0].to).toBe('kaden@example.com, cat@example.com')
    expect(mails()[0].text).toMatch(/https:\/\/ourhometownstudio\.com\/admin\/recover\?t=/)
    expect(mails()[0].text).toMatch(/It works once, for 15 minutes/)
    expect(audit.map((a) => a.action)).toEqual(['admin.recovery-requested'])
    const token = lastToken()
    expect(JSON.stringify(audit)).not.toContain(token)
    expect(JSON.stringify(audit)).not.toContain('cat@example.com')
    // Only a hash of the link is stored.
    const keys = await makeKvStore('admin-access', 'admin-access').list()
    expect(keys.join(' ')).not.toContain(token)
  })

  it('skips an owner added (or whose email changed) in the last 72 hours; with no staff list, the site setup’s owner emails', async () => {
    expect((await call({ action: 'request' })).status).toBe(200)
    expect(mails()[0].to).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    await staffListForOwners()
    await addPerson({ givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '', email: 'dana@example.com' }, BY)
    await forgetLiveLink()
    await call({ action: 'request' })
    expect(mails()[1].to).toBe('kaden@example.com, cat@example.com')
  })

  it('rate limited in the store for the whole site (3 an hour), not just per address', async () => {
    for (let i = 0; i < RECOVERY_PER_HOUR; i++) {
      expect((await call({ action: 'request' })).status).toBe(200)
      await forgetLiveLink()
    }
    expect(await call({ action: 'request' })).toMatchObject({ status: 429, body: { error: RECOVERY_MESSAGES.limited } })
    expect(mails()).toHaveLength(RECOVERY_PER_HOUR)
  })

  it('N2: while a link is still good, asking again sends nothing and isn’t counted, with the same answer', async () => {
    await staffListForOwners()
    expect((await call({ action: 'request' })).status).toBe(200)
    const token = lastToken()
    for (let i = 0; i < 10; i++) expect(await call({ action: 'request' })).toMatchObject({ status: 200, body: { data: { message: RECOVERY_MESSAGES.sent } } })
    expect(mails()).toHaveLength(1)
    expect((await call({ action: 'check', token })).body.data.state).toBe('ok') // the first link still works
    const raw = await makeKvStore('admin-access', 'admin-access').get('recovery-requests')
    expect(JSON.parse(raw!).times).toHaveLength(1)
    expect(RECOVERY_MESSAGES.sent).toMatch(/an owner added or changed in the last 3 days isn’t sent one/)
  })

  it('N2: no daily cap: links asked for all day (each after the last ran out) keep going out, within 3 an hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = Date.now()
    for (let i = 0; i < 15; i++) {
      vi.setSystemTime(start + i * 21 * 60_000) // every 21 minutes: the last link has run out
      expect((await call({ action: 'request' })).status).toBe(200)
    }
    expect(mails()).toHaveLength(15)
  })

  it('N2: a used link doesn’t block a new one', async () => {
    await call({ action: 'request' })
    expect((await use(lastToken(), 'fresh-start-9')).status).toBe(200)
    await call({ action: 'request' })
    expect(mails().filter((m) => /Set a new \/admin passcode/.test(m.subject))).toHaveLength(2)
  })

  it('the link always points at the studio’s own site, never a forged Host', () => {
    expect(recoveryOrigin('https://evil.example/api/admin/recover.json')).toBe('https://ourhometownstudio.com')
    expect(recoveryOrigin('https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app/api/x')).toBe('https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app')
    expect(recoveryOrigin('http://ourhometownstudio.com/api/x')).toBe('https://ourhometownstudio.com')
    expect(recoveryOrigin('http://localhost:4321/api/x')).toBe('http://localhost:4321')
  })

  it('R41: a test site sharing the live stores sends nothing', async () => {
    site.context = 'deploy-preview'
    expect((await call({ action: 'request' })).status).toBe(503)
    expect(mails()).toHaveLength(0)
  })

  it('the muted test site lists the email instead of sending it', async () => {
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    vi.stubEnv('SQUARE_ENVIRONMENT', 'sandbox')
    expect((await call({ action: 'request' }, { url: 'https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app/api/admin/recover.json' })).status).toBe(200)
    expect(sendMail).not.toHaveBeenCalled()
    // N5: only the first line is kept, never the link or its token.
    const { listMuted } = await import('@lib/preview-outbound')
    const entry = (await listMuted()).find((m) => /Set a new \/admin passcode/.test(m.subject ?? ''))!
    expect(entry.firstLine).toMatch(/^Someone asked for a link/)
    expect(JSON.stringify(await listMuted())).not.toMatch(/recover\?t=/)
  })
})

describe('the link', () => {
  it('opening it (twice, like an email scanner) never uses it up; submitting a good passcode does, signs this device in and everyone else out, and tells every owner', async () => {
    await staffListForOwners()
    const other = (await loginRoute.POST({ request: new Request('https://x.test/', { method: 'POST', body: JSON.stringify({ passcode: 'owner-secret' }) }), clientAddress: nextIp() } as any)).headers.get('Set-Cookie')!.split(';')[0]
    await call({ action: 'request' })
    const token = lastToken()
    expect((await call({ action: 'check', token })).body.data).toEqual({ state: 'ok' })
    expect((await call({ action: 'check', token })).body.data).toEqual({ state: 'ok' })
    sendMail.mockClear()
    const r = await use(token, 'fresh-start-9')
    expect(r.status).toBe(200)
    expect(r.cookie).toMatch(/^hg_admin=/)
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(await signedIn(r.cookie!)).toBe(200)
    expect(await signedIn(other)).toBe(401)
    expect((await login('owner-secret')).status).toBe(401)
    expect((await login('fresh-start-9')).status).toBe(200)
    expect(audit.map((a) => a.action)).toEqual(['admin.recovery-requested', 'admin.recovery-used'])
    const notice = mails().find((m) => /reset with an emailed link/.test(m.subject))!
    expect(notice.to).toBe('kaden@example.com, cat@example.com') // every owner, nobody left out
    expect(texts.filter((t) => /reset with the emailed link/.test(t.content)).map((t) => t.to[0]).sort()).toEqual(['+12565550104', '+14025550101'])
    const status = await (await (accessRoute as any).GET({ request: new Request('https://x.test/', { headers: { cookie: r.cookie! } }) })).json()
    expect(status.data).toMatchObject({ setInAdmin: true, by: 'Emailed link' })
  })

  it('used once: a second use (or a second tab) is refused', async () => {
    await call({ action: 'request' })
    const token = lastToken()
    expect((await use(token, 'fresh-start-9')).status).toBe(200)
    expect(await use(token, 'another-one-1')).toMatchObject({ status: 410, body: { error: RECOVERY_MESSAGES.used, state: 'used' } })
    expect((await call({ action: 'check', token })).body.data).toEqual({ state: 'used', message: RECOVERY_MESSAGES.used })
    expect((await login('another-one-1')).status).toBe(401)
  })

  it('a passcode that breaks the rules doesn’t use the link up (she can fix it and try again)', async () => {
    await call({ action: 'request' })
    const token = lastToken()
    expect(await use(token, 'short')).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.short } })
    expect(await use(token, 'good-pass-1', 'good-pass-2')).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.mismatch } })
    expect(await use(token, 'crew-secret')).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.staff } })
    expect(await use(token, ' spaced-pass ')).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.spaces } })
    expect((await use(token, 'good-pass-1')).status).toBe(200)
  })

  it('runs out after 15 minutes', async () => {
    await call({ action: 'request' })
    const token = lastToken()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + RECOVERY_TTL_MS + 1000)
    expect((await call({ action: 'check', token })).body.data.state).toBe('expired')
    expect(await use(token, 'fresh-start-9')).toMatchObject({ status: 410, body: { error: RECOVERY_MESSAGES.expired } })
  })

  it('a newer link ends the older one; a passcode change in Admin access ends it too', async () => {
    await call({ action: 'request' })
    const first = lastToken()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + RECOVERY_TTL_MS + 1000)
    await call({ action: 'request' })
    const second = lastToken()
    expect(second).not.toBe(first)
    expect((await call({ action: 'check', token: first })).body.data.state).toBe('unknown')
    const changed = await (accessRoute as any).POST({
      request: new Request('https://x.test/', { method: 'POST', headers: { cookie: adminCookie().split(';')[0], 'X-Admin-Who': 'Catherine' }, body: JSON.stringify({ current: 'owner-secret', passcode: 'changed-here-1', again: 'changed-here-1', expectedUpdatedAt: null }) }),
      clientAddress: nextIp(),
    })
    expect(changed.status).toBe(200)
    expect(await use(second, 'fresh-start-9')).toMatchObject({ status: 410, body: { state: 'outdated' } })
  })

  it('a wrong or made-up link counts as a wrong passcode for the whole site', async () => {
    expect(await use('x'.repeat(43), 'fresh-start-9')).toMatchObject({ status: 400, body: { state: 'unknown' } })
    expect(await use('nope', 'fresh-start-9')).toMatchObject({ status: 400 })
    expect(await adminFailedSignInsToday()).toBe(2)
  })

  it('works when the saved passcode is damaged (the honest way back), and the sign-in page says to use it', async () => {
    const saved = await (accessRoute as any).POST({
      request: new Request('https://x.test/', { method: 'POST', headers: { cookie: adminCookie().split(';')[0] }, body: JSON.stringify({ current: 'owner-secret', passcode: 'q1-in-admin', again: 'q1-in-admin', expectedUpdatedAt: null }) }),
      clientAddress: nextIp(),
    })
    expect(saved.status).toBe(200)
    await _writeRawAdminPasscodeForTests('{"hash":')
    await call({ action: 'request' })
    expect((await use(lastToken(), 'repaired-pass-1')).status).toBe(200)
    expect((await login('repaired-pass-1')).status).toBe(200)
  })
})
