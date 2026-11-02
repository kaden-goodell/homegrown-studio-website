// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'

// The real passcode store, staff list and sign-in (fs-backed); Square is a fake used only by the list's first import.
const { searchMock, audit } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[] }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import * as route from '@pages/api/admin/staff-passcode.json'
import * as loginRoute from '@pages/api/staff/login.json'
import * as pickRoute from '@pages/api/staff/pick.json'
import * as meRoute from '@pages/api/staff/me.json'
import * as giftCardsRoute from '@pages/api/staff/gift-cards.json'
import { adminCookie } from '@lib/admin-auth'
import { _resetStaffListForTests, setWorking } from '@lib/staff-directory'
import { _resetPasscodeForTests, _writeRawPasscodeForTests, PASSCODE_MESSAGES } from '@lib/staff-passcode'
import { clearFailedSignIns, MANY_FAILED_SIGNINS } from '@lib/staff-signin-failures'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false },
]

async function call(method: 'GET' | 'POST', body?: unknown, cookie: string | null = adminCookie().split(';')[0]) {
  const request = new Request('https://x.test/api/admin/staff-passcode.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request } as any)
  return { status: res.status, body: await res.json() }
}

let ip = 0
async function signIn(passcode: string, staffId: string): Promise<{ status: number; cookie: string | null }> {
  const address = `10.0.0.${++ip}` // each sign-in its own address, clear of the rate limit
  const login = await loginRoute.POST({ request: new Request('https://x.test/api/staff/login.json', { method: 'POST', body: JSON.stringify({ passcode }) }), clientAddress: address } as any)
  if (login.status !== 200) return { status: login.status, cookie: null }
  const pick = await pickRoute.POST({ request: new Request('https://x.test/api/staff/pick.json', { method: 'POST', body: JSON.stringify({ passcode, staffId }) }), clientAddress: address } as any)
  return { status: pick.status, cookie: pick.headers.get('Set-Cookie')?.split(';')[0] ?? null }
}
const me = async (cookie: string) => (await meRoute.GET({ request: new Request('https://x.test/api/staff/me.json', { headers: { cookie } }) } as any)).status

beforeEach(async () => {
  site.context = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  await _resetPasscodeForTests()
  await _resetStaffListForTests()
  await clearFailedSignIns()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  audit.length = 0
})

describe('/admin › Staff passcode', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, null)).status).toBe(401)
    expect((await call('POST', { passcode: 'door-4821', again: 'door-4821' }, null)).status).toBe(401)
  })

  it('rotate: the old passcode is refused, old /staff sign-ins stop counting, the new one works; audited without the passcode', async () => {
    const before = await signIn('crew-secret', 'TM2')
    expect(before.status).toBe(200)
    expect(await me(before.cookie!)).toBe(200)

    expect((await call('GET')).body.data).toEqual({ setInAdmin: false, updatedAt: null, by: null, damaged: false, readOnly: false, failedToday: 0, manyFailed: false })
    const saved = await call('POST', { passcode: '  door-4821 ', again: 'door-4821', expectedUpdatedAt: null })
    expect(saved.status).toBe(200)

    expect(await me(before.cookie!)).toBe(401)
    expect((await signIn('crew-secret', 'TM2')).status).toBe(401)
    const after = await signIn('door-4821', 'TM2')
    expect(after.status).toBe(200)
    expect(await me(after.cookie!)).toBe(200)

    const status = (await call('GET')).body.data
    expect(status).toMatchObject({ setInAdmin: true, by: 'Catherine', updatedAt: saved.body.data.updatedAt })
    expect(JSON.stringify(status)).not.toContain('door-4821')
    expect(audit.map((a) => a.action)).toContain('staff.passcode-changed')
    expect(JSON.stringify(audit)).not.toContain('door-4821')
    // Only a salted hash is saved.
    const stored = await readFile(`${process.env.BLOB_STORE_FS_DIR}/staff-access/passcode.json`, 'utf8')
    expect(stored).not.toContain('door-4821')
    expect(JSON.parse(stored)).toMatchObject({ gen: 1, salt: expect.any(String), hash: expect.any(String) })
  })

  it('refuses a short passcode, two that differ, and a change made on an older screen', async () => {
    expect(await call('POST', { passcode: 'abc', again: 'abc' })).toMatchObject({ status: 400, body: { error: PASSCODE_MESSAGES.short } })
    // S1: at least 6 now, in plain words.
    expect(PASSCODE_MESSAGES.short).toBe('Use at least 6 letters or numbers.')
    expect(await call('POST', { passcode: '48213', again: '48213' })).toMatchObject({ status: 400, body: { error: PASSCODE_MESSAGES.short } })
    expect(await call('POST', { passcode: ' 482 ', again: ' 482 ' })).toMatchObject({ status: 400, body: { error: PASSCODE_MESSAGES.short } })
    expect(await call('POST', { passcode: 'door-4821', again: 'door-4822' })).toMatchObject({ status: 400, body: { error: PASSCODE_MESSAGES.mismatch } })
    expect((await call('POST', { passcode: 'door-4821', again: 'door-4821', expectedUpdatedAt: null })).status).toBe(200)
    const stale = await call('POST', { passcode: 'door-9999', again: 'door-9999', expectedUpdatedAt: null })
    expect(stale).toMatchObject({ status: 409, body: { error: PASSCODE_MESSAGES.stale, stale: true } })
    expect((await signIn('door-4821', 'TM1')).status).toBe(200)
  })

  it('R41: a test site sharing the live stores shows it read only and refuses to change it', async () => {
    site.context = 'deploy-preview'
    expect((await call('GET')).body.data.readOnly).toBe(true)
    expect((await call('POST', { passcode: 'door-4821', again: 'door-4821', expectedUpdatedAt: null })).status).toBe(503)
    site.context = 'dev'
    expect((await signIn('crew-secret', 'TM1')).status).toBe(200)
  })
})

describe('someone who left is locked out of /staff at once', () => {
  it('their sign-in is refused on a money route the moment they are marked as left', async () => {
    const jess = await signIn('crew-secret', 'TM2')
    const gift = (cookie: string) => giftCardsRoute.POST({ request: new Request('https://x.test/api/staff/gift-cards.json', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents: 2500 }) }) } as any)
    await setWorking('TM2', false, { id: 'owner-catherine', name: 'Catherine' })
    expect((await gift(jess.cookie!)).status).toBe(401)
    expect(await me(jess.cookie!)).toBe(401)
  })
})

const login = (passcode: string, address: string) => loginRoute.POST({ request: new Request('https://x.test/api/staff/login.json', { method: 'POST', body: JSON.stringify({ passcode }) }), clientAddress: address } as any)
const pick = (passcode: string, address: string, staffId = 'TM2') => pickRoute.POST({ request: new Request('https://x.test/api/staff/pick.json', { method: 'POST', body: JSON.stringify({ passcode, staffId }) }), clientAddress: address } as any)

describe('S1: guessing the staff passcode', () => {
  it('pick shares the sign-in limit: wrong passcodes at either step use up the same 5 tries', async () => {
    const address = '10.9.0.1'
    for (let i = 0; i < 3; i++) expect((await pick('nope-nope', address)).status).toBe(401)
    expect((await login('nope-nope', address)).status).toBe(401)
    expect((await login('crew-secret', address)).status).toBe(200) // a right one doesn't count
    expect((await pick('nope-nope', address)).status).toBe(401) // the 5th wrong one
    expect((await login('crew-secret', address)).status).toBe(429)
    expect((await pick('crew-secret', address)).status).toBe(429)
  })

  it('right passcodes never count: many sign-ins in a row all work', async () => {
    const address = '10.9.0.2'
    for (let i = 0; i < 8; i++) {
      expect((await login('crew-secret', address)).status).toBe(200)
      expect((await pick('crew-secret', address)).status).toBe(200)
    }
  })

  it('wrong passcodes are counted for the whole site, with no addresses kept; lots of them shows on Home; changing it starts the count over', async () => {
    for (let i = 0; i < MANY_FAILED_SIGNINS - 1; i++) await login('nope-nope', `10.8.${i}.1`)
    expect((await call('GET')).body.data).toMatchObject({ failedToday: MANY_FAILED_SIGNINS - 1, manyFailed: false })
    await pick('nope-nope', '10.8.200.1')
    expect((await call('GET')).body.data).toMatchObject({ failedToday: MANY_FAILED_SIGNINS, manyFailed: true })
    const stored = await readFile(`${process.env.BLOB_STORE_FS_DIR}/staff-access/failed-signins.json`, 'utf8')
    expect(stored).not.toContain('10.8.')
    expect(stored).not.toContain('nope')
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['count', 'day'])
    expect((await call('POST', { passcode: 'door-4821', again: 'door-4821', expectedUpdatedAt: null })).status).toBe(200)
    expect((await call('GET')).body.data).toMatchObject({ failedToday: 0, manyFailed: false })
  })

  it('a test site sharing the live stores never writes the count', async () => {
    site.context = 'deploy-preview'
    await login('nope-nope', '10.7.0.1')
    site.context = 'dev'
    expect((await call('GET')).body.data.failedToday).toBe(0)
  })
})

describe('S3: a missing or damaged saved passcode', () => {
  const brokenOnes = [
    ['fields missing', '{"v":1,"hash":"abc"}'],
    ['broken', '{"v":1,"hash":'],
    ['deleted after it was set', 'null'],
  ] as const
  for (const [what, raw] of brokenOnes) {
    it(`${what}: nobody signs in (never the old STAFF_PASSCODE), /admin says so, and setting a new one repairs it`, async () => {
      expect((await call('POST', { passcode: 'door-4821', again: 'door-4821', expectedUpdatedAt: null })).status).toBe(200)
      await _writeRawPasscodeForTests(raw)
      expect((await login('crew-secret', `10.6.${what.length}.1`)).status).toBe(503)
      expect((await login('door-4821', `10.6.${what.length}.2`)).status).toBe(503)
      const status = await call('GET')
      expect(status.status).toBe(200)
      expect(status.body.data).toMatchObject({ setInAdmin: true, updatedAt: null, damaged: true })
      expect((await call('POST', { passcode: 'door-5555', again: 'door-5555', expectedUpdatedAt: null })).status).toBe(200)
      expect((await signIn('door-5555', 'TM2')).status).toBe(200)
      expect((await call('GET')).body.data.damaged).toBe(false)
    })
  }

  it('never set here: STAFF_PASSCODE still works as before', async () => {
    expect((await call('GET')).body.data).toMatchObject({ setInAdmin: false, damaged: false })
    expect((await signIn('crew-secret', 'TM2')).status).toBe(200)
  })
})
