// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real local staff list and calendar-link stores (fs-backed); Square is a fake used only by the first import.
const { searchMock, audit } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[] }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
// Upcoming shifts for the "still on something" warning.
const shifts = vi.hoisted(() => ({ rows: [] as any[] }))
vi.mock('@lib/staffing/events', () => ({ staffingRows: vi.fn(async () => shifts.rows) }))
// Lets a test make stopping a calendar link fail.
const feedFail = vi.hoisted(() => ({ on: false }))
vi.mock('@lib/staffing/feed-store', async (orig) => {
  const real = await orig<typeof import('@lib/staffing/feed-store')>()
  return { ...real, revokeFeed: async (...a: Parameters<typeof real.revokeFeed>) => { if (feedFail.on) throw new Error('blob blip'); return real.revokeFeed(...a) } }
})

import * as route from '@pages/api/admin/staff-people.json'
import * as loginRoute from '@pages/api/staff/login.json'
import * as pickRoute from '@pages/api/staff/pick.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetStaffListForTests, _setImportFailuresForTests, STAFF_MESSAGES } from '@lib/staff-directory'
import { feedStatus, findFeed, makeFeed } from '@lib/staffing/feed-store'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true, emailAddress: 'k@example.com', phoneNumber: '+12565550100' },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false, emailAddress: 'jess@example.com', phoneNumber: '+12565550199' },
]

async function call(method: 'GET' | 'POST', body?: unknown, cookie: string | null = adminCookie().split(';')[0]) {
  const request = new Request('https://x.test/api/admin/staff-people.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request } as any)
  return { status: res.status, body: await res.json() }
}

beforeEach(async () => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  audit.length = 0
  shifts.rows = []
  feedFail.on = false
})

describe('GET /api/admin/staff-people.json', () => {
  it('owners only: no admin cookie → 401', async () => {
    expect((await call('GET', undefined, null)).status).toBe(401)
  })

  it('lists everyone with contacts and calendar link status (first use brings the Square team in)', async () => {
    const { status, body } = await call('GET')
    expect(status).toBe(200)
    expect(body.data.saved).toBe(true)
    expect(body.data.people.map((p: any) => [p.id, p.name, p.phone])).toEqual([
      ['TM1', 'Kaden', '+12565550100'], ['TM4', 'Catherine', null], ['TM2', 'Jessica', '+12565550199'],
    ])
    expect(body.data.people[2].feed).toEqual({ has: false, createdAt: null, lastUsedAt: null })
  })

  it('offers a fresh start only after the import has failed 3 times over at least 10 minutes', async () => {
    searchMock.mockRejectedValue(new Error('square down'))
    const { status, body } = await call('GET')
    expect(status).toBe(503)
    // One failure (a short blip) never offers it, and the server refuses it too.
    expect(body.canStartFresh).toBe(false)
    const early = await call('POST', { action: 'start-fresh' })
    expect(early.status).toBe(409)
    expect(early.body.error).toBe(STAFF_MESSAGES.tooSoon)
    // Three quick tries: still not offered.
    await call('GET'); await call('GET')
    expect((await call('GET')).body.canStartFresh).toBe(false)
    // Failing for over 10 minutes, 3+ tries: offered.
    await _setImportFailuresForTests(3, Date.now() - 11 * 60_000)
    expect((await call('GET')).body.canStartFresh).toBe(true)
    const fresh = await call('POST', { action: 'start-fresh' })
    expect(fresh.status).toBe(200)
    expect(fresh.body.data.people.map((p: any) => p.givenName)).toEqual(['Catherine', 'Kaden'])
    expect((await call('POST', { action: 'start-fresh' })).status).toBe(409)
  })
})

describe('POST add / edit', () => {
  it('adds someone and audits it; a bad phone names the field', async () => {
    const bad = await call('POST', { action: 'add', givenName: 'Sam', familyName: '', role: 'crew', phone: '12', email: '' })
    expect(bad.status).toBe(400)
    expect(bad.body.field).toBe('phone')
    const ok = await call('POST', { action: 'add', givenName: 'Sam', familyName: 'Park', role: 'crew', phone: '256-555-0111', email: '' })
    expect(ok.status).toBe(200)
    expect(ok.body.data.person).toMatchObject({ givenName: 'Sam', phone: '+12565550111', active: true })
    expect(audit.map((a) => a.action)).toContain('staff.add')
    expect(JSON.stringify(audit)).not.toContain('+12565550111')
  })

  it('a stale edit gets 409 with the latest', async () => {
    const list = (await call('GET')).body.data.people
    const jess = list.find((p: any) => p.id === 'TM2')
    await new Promise((r) => setTimeout(r, 5))
    expect((await call('POST', { action: 'edit', id: 'TM2', givenName: 'Jessica', familyName: 'Lane', role: 'crew', phone: '2565550123', email: '', expectedUpdatedAt: jess.updatedAt })).status).toBe(200)
    const stale = await call('POST', { action: 'edit', id: 'TM2', givenName: 'Jess', familyName: 'Lane', role: 'crew', phone: '', email: '', expectedUpdatedAt: jess.updatedAt })
    expect(stale.status).toBe(409)
    expect(stale.body.stale).toBe(true)
    expect(stale.body.current.phone).toBe('+12565550123')
  })
})

describe('No longer working here', () => {
  it('stops their calendar link, takes them off the picker, keeps the record, warns about upcoming shifts', async () => {
    await call('GET')
    const { token } = await makeFeed({ staffId: 'TM2' }, { id: 'x', name: 'Jessica' })
    shifts.rows = [{ event: { status: 'on', endIso: new Date(Date.now() + 86_400_000).toISOString() }, entry: { assigned: [{ staffId: 'TM2' }] } }]
    const res = await call('POST', { action: 'leave', id: 'TM2' })
    expect(res.status).toBe(200)
    expect(res.body.data.person.active).toBe(false)
    expect(res.body.warning).toMatch(/Jessica is still on one class or party coming up/)
    expect(await findFeed(token)).toBeNull()
    expect((await feedStatus({ staffId: 'TM2' })).has).toBe(false)
    expect(audit.map((a) => a.action)).toContain('staff.leave')

    const login = await loginRoute.POST({ request: new Request('https://x.test/api/staff/login.json', { method: 'POST', body: JSON.stringify({ passcode: 'crew-secret' }) }), clientAddress: '9.9.9.9' } as any)
    const staff = (await login.json()).data.staff
    expect(staff.map((m: any) => m.id)).toEqual(['TM1', 'TM4'])
    // The picker can't sign in someone who left.
    const pick = await pickRoute.POST({ request: new Request('https://x.test/api/staff/pick.json', { method: 'POST', body: JSON.stringify({ passcode: 'crew-secret', staffId: 'TM2' }) }), clientAddress: '9.9.9.9' } as any)
    expect(pick.status).not.toBe(200)

    const all = (await call('GET')).body.data.people
    expect(all.find((p: any) => p.id === 'TM2')).toMatchObject({ active: false, givenName: 'Jessica' })
    expect((await call('POST', { action: 'return', id: 'TM2' })).body.data.person.active).toBe(true)
  })

  it("a link that couldn't be stopped on leave is said, and it's stopped when they come back", async () => {
    await call('GET')
    const { token } = await makeFeed({ staffId: 'TM2' }, { id: 'x', name: 'Jessica' })
    feedFail.on = true
    const res = await call('POST', { action: 'leave', id: 'TM2' })
    expect(res.status).toBe(200)
    expect(res.body.warning).toBe('Jessica’s calendar link couldn’t be stopped just now. It shows nothing while Jessica isn’t working here, and it’s stopped for good if Jessica comes back.')
    expect(await findFeed(token)).not.toBeNull()
    feedFail.on = false
    const back = await call('POST', { action: 'return', id: 'TM2' })
    expect(back.body.warning).toBeUndefined()
    // The old link never wakes up.
    expect(await findFeed(token)).toBeNull()
  })

  it("coming back when the old link can't be stopped says what to tap", async () => {
    await call('GET')
    await call('POST', { action: 'leave', id: 'TM2' })
    await makeFeed({ staffId: 'TM2' }, { id: 'x', name: 'Jessica' })
    feedFail.on = true
    const back = await call('POST', { action: 'return', id: 'TM2' })
    expect(back.body.warning).toBe('Jessica’s old calendar link couldn’t be stopped. Tap Stop their calendar link on Jessica’s row.')
  })
})

describe('privacy: contact details never reach the crew', () => {
  it('the /staff sign-in list carries no phone or email', async () => {
    const res = await loginRoute.POST({ request: new Request('https://x.test/api/staff/login.json', { method: 'POST', body: JSON.stringify({ passcode: 'crew-secret' }) }), clientAddress: '8.8.8.8' } as any)
    const text = await res.text()
    expect(text).toContain('Jessica')
    expect(text).not.toMatch(/555|@example\.com/)
  })
})
