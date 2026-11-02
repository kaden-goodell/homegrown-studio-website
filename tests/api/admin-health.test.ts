// @vitest-environment node
// /api/admin/health.json (G2): status, and the test buttons (to the signed-in owner's own contact).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { searchMock, audit, sendMail } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[], sendMail: vi.fn() }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) }, createTransport: () => ({ sendMail }) }))
vi.mock('@lib/owner-alert', () => ({ alertOwners: vi.fn(async () => ({ attempted: 0, sent: 0 })) }))

import * as route from '@pages/api/admin/health.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeForTests } from '@lib/admin-passcode'
import { _resetHealthForTests, noteFailure } from '@lib/outbound-health'
import { _resetStaffListForTests, staffListForOwners } from '@lib/staff-directory'
import { siteConfig } from '@config/site.config'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'kaden@example.com', phoneNumber: '+14025550101' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false, emailAddress: 'cat@example.com' },
]

let ip = 0
async function call(method: 'GET' | 'POST', body?: unknown, opts: { cookie?: string | null; who?: string; address?: string } = {}) {
  const cookie = opts.cookie === undefined ? adminCookie().split(';')[0] : opts.cookie
  const request = new Request('https://x.test/api/admin/health.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': opts.who ?? 'Catherine', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request, clientAddress: opts.address ?? `10.2.0.${++ip}` } as any)
  return { status: res.status, body: await res.json() }
}

const cfg = siteConfig.providers.catalog.config as any
const wasToken = cfg.accessToken
beforeEach(async () => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('GMAIL_USER', 'bot@example.com')
  vi.stubEnv('GMAIL_APP_PASSWORD', 'app-pass')
  vi.stubEnv('QUO_API_KEY', 'k')
  vi.stubEnv('QUO_FROM_NUMBER', '+12564641710')
  vi.stubEnv('STORE_NAMESPACE', '')
  cfg.accessToken = 'sq-token'
  await _resetAdminPasscodeForTests()
  await _resetHealthForTests()
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  sendMail.mockReset()
  sendMail.mockResolvedValue({})
  audit.length = 0
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); cfg.accessToken = wasToken })

describe('/api/admin/health.json', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, { cookie: null })).status).toBe(401)
    expect((await call('POST', { action: 'test-email' }, { cookie: null })).status).toBe(401)
  })

  it('GET: each service’s state, with since', async () => {
    await noteFailure('square', 'auth')
    const { body } = await call('GET')
    expect(body.data).toMatchObject({ email: { state: 'ok' }, text: { state: 'ok' }, square: { state: 'failing', kind: 'auth', since: expect.any(String) }, testSite: false })
    vi.stubEnv('QUO_API_KEY', '')
    expect((await call('GET')).body.data.text.state).toBe('not-set')
  })

  it('Send me a test email: to the signed-in owner’s own email on the staff list; a send that works clears the warning', async () => {
    await staffListForOwners()
    await noteFailure('email', 'auth')
    const r = await call('POST', { action: 'test-email' })
    expect(r.body.data).toEqual({ ok: true, message: 'Sent to cat@example.com. Check your inbox (and spam) in a minute.' })
    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0]).toMatchObject({ to: 'cat@example.com', subject: 'Test email from the Hometown Studio website' })
    expect((await call('GET')).body.data.email.state).toBe('ok')
    expect(audit).toEqual([expect.objectContaining({ action: 'health.test-email', details: { ok: true } })])
    expect(JSON.stringify(audit)).not.toContain('cat@example.com')
  })

  it('a test email that fails says so in plain words (and keeps the warning)', async () => {
    await staffListForOwners()
    sendMail.mockRejectedValue(Object.assign(new Error('Invalid login'), { code: 'EAUTH' }))
    const r = await call('POST', { action: 'test-email' })
    expect(r.body.data).toEqual({ ok: false, message: route.HEALTH_MESSAGES.emailFailed })
    expect((await call('GET')).body.data.email.state).toBe('failing')
  })

  it('M5: on the muted test site nothing is sent, the answer says “Not sent”, it is never a success, and the warning stays', async () => {
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    vi.stubEnv('SQUARE_ENVIRONMENT', 'sandbox')
    await staffListForOwners()
    await noteFailure('email', 'auth')
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await call('POST', { action: 'test-email' })
    expect(r.body.data).toEqual({ ok: false, muted: true, message: route.HEALTH_MESSAGES.muted })
    expect(r.body.data.message).toMatch(/^Not sent — this is a test site/)
    expect(sendMail).not.toHaveBeenCalled()
    const t = await call('POST', { action: 'test-text' }, { who: 'Kaden' })
    expect(t.body.data).toEqual({ ok: false, muted: true, message: route.HEALTH_MESSAGES.muted })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(audit.map((a) => a.details)).toEqual([{ ok: false, muted: true }, { ok: false, muted: true }])
    expect((await call('GET')).body.data).toMatchObject({ muted: true, email: { state: 'failing' } })
  })

  it('on a test site with messages turned on, the message goes to the test inbox, and the answer says so', async () => {
    vi.stubEnv('STORE_NAMESPACE', 'preview')
    vi.stubEnv('PREVIEW_MESSAGES', 'on')
    await staffListForOwners()
    const r = await call('POST', { action: 'test-email' })
    expect(r.body.data.message).toMatch(/goes to the test inbox and phone instead/)
    expect(sendMail.mock.calls[0][0].to).toBe('kaden.goodell@gmail.com')
  })

  it('Send me a test text: to the owner’s own mobile; no mobile on file says where to add it', async () => {
    await staffListForOwners()
    expect((await call('POST', { action: 'test-text' })).body).toEqual({ error: route.HEALTH_MESSAGES.noPhone })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await call('POST', { action: 'test-text' }, { who: 'Kaden' })
    expect(r.body.data).toEqual({ ok: true, message: 'Sent to your mobile ending 0101.' })
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body).to).toEqual(['+14025550101'])
  })

  it('no staff list yet / nobody picked: says what to do first; nothing is sent', async () => {
    expect((await call('POST', { action: 'test-email' })).body).toEqual({ error: route.HEALTH_MESSAGES.noList })
    expect((await call('POST', { action: 'test-email' }, { who: '' })).body).toEqual({ error: route.HEALTH_MESSAGES.pickWho })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('Check Square: one read; a refused key says so and warns; an answer clears it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: 'UNAUTHORIZED' }] }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    expect((await call('POST', { action: 'check-square' })).body.data).toEqual({ ok: false, message: route.HEALTH_MESSAGES.squareRefused })
    expect((await call('GET')).body.data.square.state).toBe('failing')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ location: { id: 'L1' } }), { status: 200 }))
    expect((await call('POST', { action: 'check-square' })).body.data.ok).toBe(true)
    expect((await call('GET')).body.data.square.state).toBe('ok')
  })

  it('Check Square: a 403 for one missing permission is “couldn’t reach”, not a refused key, and doesn’t warn', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errors: [{ code: 'INSUFFICIENT_SCOPES' }] }), { status: 403 })))
    expect((await call('POST', { action: 'check-square' })).body.data).toEqual({ ok: false, message: route.HEALTH_MESSAGES.squareDown })
    expect((await call('GET')).body.data.square.state).toBe('ok')
  })

  it('rate limited per address', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < route.TEST_MAX; i++) expect((await call('POST', { action: 'check-square' }, { address: '10.9.9.9' })).status).toBe(200)
    expect(await call('POST', { action: 'check-square' }, { address: '10.9.9.9' })).toMatchObject({ status: 429, body: { error: route.HEALTH_MESSAGES.tooMany } })
  })
})
