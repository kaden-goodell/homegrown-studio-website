// @vitest-environment node
// Audit B fix round: change notices to the other owners (M1), passcode fallbacks (M4),
// sign-in messages (M3), the site-wide wrong-passcode count (L1), owners from the import (L4).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { searchMock, audit, sendMail } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[], sendMail: vi.fn() }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) }, createTransport: () => ({ sendMail }) }))
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import * as accessRoute from '@pages/api/admin/admin-access.json'
import * as loginRoute from '@pages/api/admin/login.json'
import * as peopleRoute from '@pages/api/admin/staff-people.json'
import * as notifyRoute from '@pages/api/admin/notify.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetAdminPasscodeCache, _resetAdminPasscodeForTests, _resetTakeoverMemory, _writeRawAdminPasscodeForTests, ENV_SEEN_CAP } from '@lib/admin-passcode'
import { ADMIN_FAILURE_LOCK, ADMIN_LOCKED_MESSAGE, MANY_ADMIN_FAILURES, adminFailedSignInsToday } from '@lib/admin-signin-failures'
import { _resetNotifyForTests } from '@lib/notify-settings'
import { _resetStaffListForTests, staffListForOwners } from '@lib/staff-directory'
import { _resetPasscodeForTests } from '@lib/staff-passcode'
import { _resetHealthForTests } from '@lib/outbound-health'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'kaden@example.com', phoneNumber: '+14025550101' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false, emailAddress: 'cat@example.com', phoneNumber: '+12565550104' },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false, emailAddress: 'jess@example.com', phoneNumber: '+12565550102' },
]

let ip = 0
const nextIp = () => `10.7.0.${++ip}`
const texts: { to: string[]; content: string }[] = []

async function post(route: any, url: string, body: unknown, opts: { cookie?: string | null; who?: string; address?: string } = {}) {
  const cookie = opts.cookie === undefined ? adminCookie().split(';')[0] : opts.cookie
  const request = new Request(`https://x.test${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': opts.who ?? 'Catherine', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  const res = await route.POST({ request, clientAddress: opts.address ?? nextIp() } as any)
  return { status: res.status, body: await res.json(), cookie: res.headers.get('Set-Cookie')?.split(';')[0] ?? null }
}
async function login(passcode: string, address = nextIp()) {
  const res = await loginRoute.POST({ request: new Request('https://x.test/api/admin/login.json', { method: 'POST', body: JSON.stringify({ passcode }) }), clientAddress: address } as any)
  return { status: res.status, body: await res.json(), cookie: res.headers.get('Set-Cookie')?.split(';')[0] ?? null }
}
const changePasscode = (current: string, passcode: string, extra: Record<string, unknown> = {}, opts: { cookie?: string | null } = {}) =>
  post(accessRoute, '/api/admin/admin-access.json', { current, passcode, again: passcode, expectedUpdatedAt: null, ...extra }, opts)
const people = (body: unknown, who = 'Catherine') => post(peopleRoute, '/api/admin/staff-people.json', body, { who })
const person = async (id: string) => (await staffListForOwners()).people.find((p) => p.id === id)!

beforeEach(async () => {
  site.context = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  vi.stubEnv('GMAIL_USER', 'bot@example.com')
  vi.stubEnv('GMAIL_APP_PASSWORD', 'app-pass')
  vi.stubEnv('QUO_API_KEY', 'k')
  vi.stubEnv('QUO_FROM_NUMBER', '+12564641710')
  vi.stubEnv('OWNER_ALERT_NUMBERS', '+14029802907')
  vi.stubEnv('STORE_NAMESPACE', '')
  await _resetAdminPasscodeForTests()
  await _resetPasscodeForTests()
  await _resetStaffListForTests()
  await _resetNotifyForTests()
  await _resetHealthForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  sendMail.mockReset()
  sendMail.mockResolvedValue({})
  audit.length = 0
  texts.length = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    texts.push(JSON.parse(init.body))
    return new Response('{}', { status: 202 })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

const mails = () => sendMail.mock.calls.map((c) => c[0])

describe('M1: the other owners hear about owner and Notifications changes, at the addresses they had', () => {
  it('making someone an owner: Kaden (not Catherine, who did it) gets an email and a text', async () => {
    await staffListForOwners()
    const r = await people({ action: 'add', givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '256-555-0123', email: 'dana@example.com' })
    expect(r.status).toBe(200)
    expect(mails()).toHaveLength(1)
    expect(mails()[0]).toMatchObject({ to: 'kaden@example.com', subject: 'The studio’s owners changed in /admin' })
    expect(mails()[0].text).toMatch(/^Catherine made Dana an owner in \/admin \(.+\)\. If that wasn’t expected, check \/admin › More › Staff › People and Notifications, and change the admin passcode\.$/)
    expect(texts.map((t) => t.to)).toEqual([['+14025550101']])
    expect(texts[0].content).toMatch(/^Hometown Studio: Catherine made Dana an owner/)
  })

  it('changing an owner’s email: told at the OLD address (and the other owner), never the new one', async () => {
    await staffListForOwners()
    const cat = await person('TM4')
    await people({ action: 'edit', id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', role: 'owner', phone: '+12565550104', email: 'attacker@example.com', expectedUpdatedAt: cat.updatedAt }, 'Kaden')
    expect(mails()).toHaveLength(1)
    expect(mails()[0].to).toBe('cat@example.com') // Kaden made the change, so Catherine hears, at her old address
    expect(mails()[0].to).not.toContain('attacker')
    expect(mails()[0].text).toMatch(/^Kaden changed Catherine’s email in \/admin/)
    expect(texts.map((t) => t.to)).toEqual([['+12565550104']])
  })

  it('an unknown actor (“Owner”): every owner hears', async () => {
    await staffListForOwners()
    await people({ action: 'add', givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '', email: 'dana@example.com' }, '')
    expect(mails()[0].to).toBe('kaden@example.com, cat@example.com')
  })

  it('taking an owner off, or bringing one back, is told; a crew change isn’t', async () => {
    await staffListForOwners()
    const jess = await person('TM2')
    await people({ action: 'edit', id: 'TM2', givenName: 'Jessica', familyName: 'Lane', role: 'crew', phone: '+12565550199', email: 'jess@example.com', expectedUpdatedAt: jess.updatedAt })
    expect(mails()).toHaveLength(0)
    await people({ action: 'leave', id: 'TM1' })
    expect(mails()).toHaveLength(1)
    expect(mails()[0].to).toBe('kaden@example.com') // told at the address Kaden had, before he was taken off
    expect(mails()[0].text).toMatch(/^Catherine took Kaden off as an owner/)
    await people({ action: 'return', id: 'TM1' })
    expect(mails()).toHaveLength(2)
    expect(mails()[1].text).toMatch(/made Kaden an owner/)
  })

  it('an owner’s notice says what they now get, the archive “from tomorrow”', async () => {
    await staffListForOwners()
    const rows = { 'owner-texts': ['TM1', 'TM4'], 'booking-alerts': ['TM4'], 'warnings-email': ['TM1', 'TM4'], 'tax-report': ['TM4'], archive: ['TM1', 'TM4'] }
    await post(notifyRoute, '/api/admin/notify.json', { rows, expectedUpdatedAt: null })
    await people({ action: 'leave', id: 'TM1' })
    sendMail.mockClear()
    await people({ action: 'return', id: 'TM1' })
    expect(mails()[0].text).toMatch(/Kaden now gets: Texts when something needs you, Morning warnings and heads-up emails, Weekly records archive \(from tomorrow\)\./)
    // Someone added after the save isn't picked for anything.
    sendMail.mockClear()
    await people({ action: 'add', givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '', email: 'dana@example.com' })
    expect(mails()[0].text).not.toMatch(/Dana now gets/)
  })

  it('saving Notifications tells the other owners which rows go to whom', async () => {
    await staffListForOwners()
    const rows = { 'owner-texts': ['TM1', 'TM4'], 'booking-alerts': ['TM1', 'TM4'], 'warnings-email': ['TM1', 'TM4'], 'tax-report': ['TM1', 'TM4'], archive: ['TM4'] }
    const r = await post(notifyRoute, '/api/admin/notify.json', { rows, expectedUpdatedAt: null })
    expect(r.status).toBe(200)
    const notice = mails().find((m) => m.subject === 'Who gets the studio’s alerts changed in /admin')!
    expect(notice.to).toBe('kaden@example.com')
    expect(notice.text).toMatch(/^Catherine changed who gets alerts and reports in \/admin \(.+\): .*Weekly records archive now goes to Catherine\. If that wasn’t expected/)
    expect(texts.some((t) => t.to[0] === '+14025550101' && /changed who gets alerts/.test(t.content))).toBe(true)
  })

  it('the only owner making a change: the site setup hears (nobody is left out of the loop)', async () => {
    await staffListForOwners()
    await people({ action: 'leave', id: 'TM1' })
    sendMail.mockClear()
    texts.length = 0
    await people({ action: 'add', givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '', email: 'dana@example.com' })
    expect(mails()[0].to).toBe('kaden@ourhometownstudio.com, catherine@ourhometownstudio.com')
    expect(texts.map((t) => t.to)).toEqual([['+14029802907']])
  })
})

describe('M4: the hosting setting as the last resort', () => {
  it('reverting the setting to any of the last few never reopens /admin (P0 → P1 takeover → Q2 → back to P0)', async () => {
    expect((await changePasscode('owner-secret', 'q1-in-admin')).status).toBe(200) // P0 = owner-secret in force
    vi.stubEnv('ADMIN_PASSCODE', 'p1-takeover-setting')
    _resetAdminPasscodeCache()
    const back = await login('p1-takeover-setting')
    expect(back.status).toBe(200)
    const status = await (await (accessRoute as any).GET({ request: new Request('https://x.test/', { headers: { cookie: back.cookie! } }) })).json()
    expect((await changePasscode('p1-takeover-setting', 'q2-in-admin', { expectedUpdatedAt: status.data.updatedAt }, { cookie: back.cookie })).status).toBe(200)
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret') // put the old one back
    _resetAdminPasscodeCache()
    expect((await login('owner-secret')).status).toBe(401)
    expect((await login('q2-in-admin')).status).toBe(200)
    vi.stubEnv('ADMIN_PASSCODE', 'p1-takeover-setting')
    _resetAdminPasscodeCache()
    expect((await login('p1-takeover-setting')).status).toBe(401)
    expect((await login('q2-in-admin')).status).toBe(200)
    expect(ENV_SEEN_CAP).toBe(5)
  })

  it('a setting shorter than 8 never takes over', async () => {
    expect((await changePasscode('owner-secret', 'q1-in-admin')).status).toBe(200)
    vi.stubEnv('ADMIN_PASSCODE', 'abc')
    _resetAdminPasscodeCache()
    expect((await login('abc')).status).toBe(401)
    expect((await login('q1-in-admin')).status).toBe(200)
  })

  it('a takeover emails and texts every owner once (not again on other sign-ins or servers), and never from a test site', async () => {
    await staffListForOwners()
    expect((await changePasscode('owner-secret', 'q1-in-admin')).status).toBe(200)
    sendMail.mockClear()
    texts.length = 0
    vi.stubEnv('ADMIN_PASSCODE', 'new-hosting-pass')
    _resetAdminPasscodeCache()
    expect((await login('new-hosting-pass')).status).toBe(200)
    const told = mails().filter((m) => /hosting settings/.test(m.subject))
    expect(told).toHaveLength(1)
    expect(told[0].to).toBe('kaden@example.com, cat@example.com')
    expect(told[0].text).not.toContain('new-hosting-pass')
    expect(texts.filter((t) => /hosting settings/.test(t.content)).map((t) => t.to[0]).sort()).toEqual(['+12565550104', '+14025550101'])
    _resetAdminPasscodeCache()
    _resetTakeoverMemory() // another server
    expect((await login('new-hosting-pass')).status).toBe(200)
    expect(mails().filter((m) => /hosting settings/.test(m.subject))).toHaveLength(1)

    // A branch deploy sharing the live stores with its own setting isn't a takeover of the live site: nobody is told.
    vi.stubEnv('ADMIN_PASSCODE', 'branch-own-setting')
    _resetAdminPasscodeCache()
    site.context = 'deploy-preview'
    await login('branch-own-setting')
    expect(mails().filter((m) => /hosting settings/.test(m.subject))).toHaveLength(1)
  })
})

describe('M3 (sign-in messages) and L3', () => {
  it('a damaged saved passcode and an unreadable one say different things', async () => {
    expect((await changePasscode('owner-secret', 'q1-in-admin')).status).toBe(200)
    await _writeRawAdminPasscodeForTests('{"hash":')
    expect(await login('q1-in-admin')).toMatchObject({ status: 503, body: { door: 'damaged', error: loginRoute.LOGIN_MESSAGES.damaged } })
    expect(loginRoute.LOGIN_MESSAGES.damaged).toMatch(/Forgot the passcode/)
    await _resetAdminPasscodeForTests()
    vi.stubEnv('ADMIN_PASSCODE', '')
    expect(await login('x')).toMatchObject({ status: 503, body: { door: 'none' } })
  })

  it('nothing is trimmed: a passcode typed with a space at an end is refused, and says so', async () => {
    expect(await login('owner-secret ')).toMatchObject({ status: 401, body: { error: loginRoute.LOGIN_MESSAGES.wrongSpaces } })
    expect(await login('owner-secrex')).toMatchObject({ status: 401, body: { error: loginRoute.LOGIN_MESSAGES.wrong } })
    expect((await changePasscode(' owner-secret', 'q1-in-admin')).body.error).toMatch(/starts or ends with a space/)
  })
})

describe('L1: wrong admin passcodes for the whole site (in the store, not just per server)', () => {
  it('counts across addresses; at 20 the owners hear once; at 200 sign-in pauses for the day; a passcode change starts it over', async () => {
    await staffListForOwners()
    for (let i = 0; i < MANY_ADMIN_FAILURES; i++) expect((await login(`guess-${i}`)).status).toBe(401)
    expect(await adminFailedSignInsToday()).toBe(MANY_ADMIN_FAILURES)
    const told = mails().filter((m) => /wrong \/admin passcodes/.test(m.subject))
    expect(told).toHaveLength(1)
    for (let i = 0; i < 3; i++) await login(`more-${i}`)
    expect(mails().filter((m) => /wrong \/admin passcodes/.test(m.subject))).toHaveLength(1)
    const view = await (await (accessRoute as any).GET({ request: new Request('https://x.test/', { headers: { cookie: adminCookie().split(';')[0] } }) })).json()
    expect(view.data).toMatchObject({ manyFailed: true, failedToday: MANY_ADMIN_FAILURES + 3 })

    const kv = (await import('@lib/blob-store')).makeKvStore('admin-access', 'admin-access')
    const { studioDay } = await import('@lib/staff-signin-failures')
    await kv.set('failed-signins', JSON.stringify({ day: studioDay(), count: ADMIN_FAILURE_LOCK, told: true }))
    expect(await login('owner-secret')).toMatchObject({ status: 429, body: { error: ADMIN_LOCKED_MESSAGE, locked: true } })
    expect((await changePasscode('owner-secret', 'q1-in-admin')).status).toBe(429)
    await kv.set('failed-signins', JSON.stringify({ day: studioDay(), count: 3, told: false }))
    expect((await changePasscode('owner-secret', 'q1-in-admin')).status).toBe(200)
    expect(await adminFailedSignInsToday()).toBe(0)
  })

  it('R41: a test site sharing the live stores counts nothing', async () => {
    site.context = 'deploy-preview'
    await login('guess')
    site.context = 'dev'
    expect(await adminFailedSignInsToday()).toBe(0)
  })
})

describe('L4: owners from the first Square import', () => {
  it('only Square’s own owner, or the ONE person with an owner’s first name, comes in as Owner', async () => {
    searchMock.mockResolvedValue({ teamMembers: [
      { id: 'A', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
      { id: 'B', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false },
      { id: 'C', givenName: 'Catherine', familyName: 'Smith', status: 'ACTIVE', isOwner: false },
      { id: 'D', givenName: 'Kaden', familyName: 'Other', status: 'ACTIVE', isOwner: false },
    ] })
    const list = (await staffListForOwners()).people
    const role = (id: string) => list.find((p) => p.id === id)!.role
    expect([role('A'), role('B'), role('C'), role('D')]).toEqual(['owner', 'crew', 'crew', 'crew'])
  })
  it('one Catherine: she comes in as Owner', async () => {
    const list = (await staffListForOwners()).people
    expect(list.find((p) => p.id === 'TM4')!.role).toBe('owner')
    expect(list.find((p) => p.id === 'TM2')!.role).toBe('crew')
  })
})
