// @vitest-environment node
// /admin › More › Admin access (G4): the admin passcode set in /admin, and who the owners are.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFile } from 'node:fs/promises'

// The real passcode stores, staff list and sign-in (fs-backed); Square is a fake used only by the staff list's first import.
const { searchMock, audit } = vi.hoisted(() => ({ searchMock: vi.fn(), audit: [] as any[] }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))
const site = vi.hoisted(() => ({ context: 'dev' as string }))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => site.context }))

import * as route from '@pages/api/admin/admin-access.json'
import * as loginRoute from '@pages/api/admin/login.json'
import * as toDecide from '@pages/api/admin/to-decide.json'
import { adminActor, adminCookie } from '@lib/admin-auth'
import { ADMIN_PASSCODE_MESSAGES, _resetAdminPasscodeForTests, _writeRawAdminPasscodeForTests, _resetAdminPasscodeCache } from '@lib/admin-passcode'
import { ownerList } from '@lib/admin-owners'
import { _resetStaffListForTests, addPerson, editPerson, setWorking, staffListForOwners } from '@lib/staff-directory'
import { _resetPasscodeForTests } from '@lib/staff-passcode'

const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false },
]
const BY = { id: 'owner-catherine', name: 'Catherine' }
const ENV_COOKIE = () => adminCookie().split(';')[0]

let ip = 0
const nextIp = () => `10.1.0.${++ip}`

async function call(method: 'GET' | 'POST', body?: unknown, opts: { cookie?: string | null; address?: string; who?: string } = {}) {
  const cookie = opts.cookie === undefined ? ENV_COOKIE() : opts.cookie
  const request = new Request('https://x.test/api/admin/admin-access.json', {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Who': opts.who ?? 'Catherine', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await (method === 'GET' ? route.GET : route.POST)({ request, clientAddress: opts.address ?? nextIp() } as any)
  return { status: res.status, body: await res.json(), cookie: res.headers.get('Set-Cookie')?.split(';')[0] ?? null }
}

async function login(passcode: string, address = nextIp()) {
  const res = await loginRoute.POST({ request: new Request('https://x.test/api/admin/login.json', { method: 'POST', body: JSON.stringify({ passcode }) }), clientAddress: address } as any)
  return { status: res.status, body: await res.json(), cookie: res.headers.get('Set-Cookie')?.split(';')[0] ?? null }
}

/** Any signed-in admin route: 200 when the cookie counts. */
const signedIn = async (cookie: string) => (await (toDecide as any).GET({ request: new Request('https://x.test/api/admin/to-decide.json', { headers: { cookie } }), url: new URL('https://x.test/api/admin/to-decide.json') })).status

const change = (current: string, passcode: string, extra: Record<string, unknown> = {}) => ({ current, passcode, again: passcode, expectedUpdatedAt: null, ...extra })

beforeEach(async () => {
  site.context = 'dev'
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  await _resetAdminPasscodeForTests()
  await _resetPasscodeForTests()
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
  audit.length = 0
})

describe('/admin › Admin access: the passcode', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, { cookie: null })).status).toBe(401)
    expect((await call('POST', change('owner-secret', 'new-pass-123'), { cookie: null })).status).toBe(401)
  })

  it('rotate: every old sign-in stops, the old passcode is refused, the new one works, this device stays in; audited without the passcode', async () => {
    const other = (await login('owner-secret')).cookie!
    expect(await signedIn(other)).toBe(200)
    expect((await call('GET')).body.data).toMatchObject({ setInAdmin: false, updatedAt: null, by: null, damaged: false, settingTookOver: false, readOnly: false, min: 8 })

    const saved = await call('POST', change('owner-secret', '  studio-door-7 ', { again: 'studio-door-7' }))
    expect(saved.status).toBe(200)
    expect(saved.cookie).toMatch(/^hg_admin=/)
    expect(await signedIn(saved.cookie!)).toBe(200) // the saving device signs in again on the spot
    expect(await signedIn(other)).toBe(401) // every other device is signed out
    expect(await signedIn(ENV_COOKIE())).toBe(401)

    expect((await login('owner-secret')).status).toBe(401)
    const fresh = await login('studio-door-7')
    expect(fresh.status).toBe(200)
    expect(await signedIn(fresh.cookie!)).toBe(200)

    const status = (await call('GET', undefined, { cookie: fresh.cookie })).body.data
    expect(status).toMatchObject({ setInAdmin: true, by: 'Catherine', updatedAt: saved.body.data.updatedAt })
    expect(JSON.stringify(status)).not.toContain('studio-door-7')
    expect(audit.map((a) => a.action)).toEqual(['admin.passcode-changed'])
    expect(JSON.stringify(audit)).not.toContain('studio-door-7')
    const stored = await readFile(`${process.env.BLOB_STORE_FS_DIR}/admin-access/passcode.json`, 'utf8')
    expect(stored).not.toContain('studio-door-7')
    expect(JSON.parse(stored)).toMatchObject({ gen: 1, salt: expect.any(String), hash: expect.any(String) })
    const marker = await readFile(`${process.env.BLOB_STORE_FS_DIR}/admin-access/passcode-was-set.json`, 'utf8')
    expect(marker).not.toContain('owner-secret')

    // A second change moves the generation on again and signs the first new sign-in out.
    const again = await call('POST', change('studio-door-7', 'studio-door-8', { expectedUpdatedAt: saved.body.data.updatedAt }), { cookie: fresh.cookie })
    expect(again.status).toBe(200)
    expect(await signedIn(fresh.cookie!)).toBe(401)
    expect(JSON.parse(await readFile(`${process.env.BLOB_STORE_FS_DIR}/admin-access/passcode.json`, 'utf8')).gen).toBe(2)
  })

  it('refuses: a wrong current passcode (without signing this device out), short, two that differ, the same one, the staff passcode, an older screen', async () => {
    const wrong = await call('POST', change('nope', 'new-pass-123'))
    expect(wrong).toMatchObject({ status: 403, body: { error: ADMIN_PASSCODE_MESSAGES.current } })
    expect(await signedIn(ENV_COOKIE())).toBe(200)
    expect(await call('POST', change('owner-secret', 'short12'))).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.short } })
    expect(ADMIN_PASSCODE_MESSAGES.short).toBe('Use at least 8 letters or numbers.')
    expect(await call('POST', { current: 'owner-secret', passcode: 'new-pass-123', again: 'new-pass-124', expectedUpdatedAt: null })).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.mismatch } })
    expect(await call('POST', change('owner-secret', 'owner-secret'))).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.same } })
    expect(await call('POST', change('owner-secret', 'crew-secret'))).toMatchObject({ status: 400, body: { error: ADMIN_PASSCODE_MESSAGES.staff } })
    expect((await call('POST', change('owner-secret', 'new-pass-123'))).status).toBe(200)
    const fresh = (await login('new-pass-123')).cookie!
    expect(await call('POST', change('new-pass-123', 'new-pass-456'), { cookie: fresh })).toMatchObject({ status: 409, body: { error: ADMIN_PASSCODE_MESSAGES.stale, stale: true } })
    expect(audit).toHaveLength(1)
  })

  it('lockout: tries at the current passcode share the sign-in limit (8 per 15 minutes per address)', async () => {
    const address = nextIp()
    for (let i = 0; i < 5; i++) expect((await login('guess-' + i, address)).status).toBe(401)
    for (let i = 0; i < 3; i++) expect((await call('POST', change('guess-x' + i, 'new-pass-123'), { address })).status).toBe(403)
    // The 9th try from that address, either way, is refused before the passcode is even looked at.
    expect(await call('POST', change('owner-secret', 'new-pass-123'), { address })).toMatchObject({ status: 429 })
    expect((await login('owner-secret', address)).status).toBe(429)
    // Another address is untouched, and nothing changed.
    expect((await login('owner-secret')).status).toBe(200)
    expect(audit).toHaveLength(0)
  })

  it('fallback: no saved passcode → ADMIN_PASSCODE; once one is set, a lost or damaged record never brings the old setting back', async () => {
    expect((await call('POST', change('owner-secret', 'new-pass-123'))).status).toBe(200)

    // The record is deleted (store trouble): the marker stays, so the old ADMIN_PASSCODE does not quietly work again.
    await _writeRawAdminPasscodeForTests('null')
    expect((await login('owner-secret')).status).toBe(503)
    expect((await login('new-pass-123')).status).toBe(503)
    expect(await signedIn(ENV_COOKIE())).toBe(401)

    // Damaged (not readable) the same.
    await _writeRawAdminPasscodeForTests('{"hash":')
    expect((await login('owner-secret')).status).toBe(503)

    // The deliberate way back: a NEW ADMIN_PASSCODE in the hosting settings lets an owner in to set a fresh one.
    vi.stubEnv('ADMIN_PASSCODE', 'brand-new-setting')
    _resetAdminPasscodeCache()
    const back = await login('brand-new-setting')
    expect(back.status).toBe(200)
    const status = (await call('GET', undefined, { cookie: back.cookie })).body.data
    expect(status).toMatchObject({ damaged: true, settingTookOver: true })
    const repaired = await call('POST', change('brand-new-setting', 'repaired-pass-1'), { cookie: back.cookie })
    expect(repaired.status).toBe(200)
    expect((await login('brand-new-setting')).status).toBe(401)
    expect((await login('repaired-pass-1')).status).toBe(200)
  })

  it('forgot it: the saved passcode keeps beating the old setting, until a NEW setting takes over (and a fresh save here wins again)', async () => {
    expect((await call('POST', change('owner-secret', 'new-pass-123'))).status).toBe(200)
    // The setting that was there all along never opens the door again (a redeploy with it changes nothing).
    _resetAdminPasscodeCache()
    expect((await login('owner-secret')).status).toBe(401)
    vi.stubEnv('ADMIN_PASSCODE', 'set-in-hosting-9')
    _resetAdminPasscodeCache()
    expect((await login('new-pass-123')).status).toBe(401)
    const back = await login('set-in-hosting-9')
    expect(back.status).toBe(200)
    const view = (await call('GET', undefined, { cookie: back.cookie })).body.data
    expect(view).toMatchObject({ setInAdmin: true, settingTookOver: true, damaged: false })
    expect((await call('POST', change('set-in-hosting-9', 'chosen-again-1', { expectedUpdatedAt: view.updatedAt }), { cookie: back.cookie })).status).toBe(200)
    expect((await login('set-in-hosting-9')).status).toBe(401)
    expect((await login('chosen-again-1')).status).toBe(200)
  })

  it('marker: only when both the record and the marker are gone does ADMIN_PASSCODE count again', async () => {
    expect((await call('POST', change('owner-secret', 'new-pass-123'))).status).toBe(200)
    await _resetAdminPasscodeForTests()
    expect((await login('owner-secret')).status).toBe(200)
    expect((await login('new-pass-123')).status).toBe(401)
  })

  it('R41: a test site sharing the live stores shows it read only and refuses to change it', async () => {
    site.context = 'deploy-preview'
    expect((await call('GET')).body.data.readOnly).toBe(true)
    expect((await call('POST', change('owner-secret', 'new-pass-123'))).status).toBe(503)
    site.context = 'dev'
    expect((await login('owner-secret')).status).toBe(200)
  })
})

describe('/admin › Admin access: who the owners are', () => {
  const actor = (who: string) => adminActor(new Request('https://x.test/', { headers: { 'X-Admin-Who': who } }))

  it('before a staff list exists: Catherine and Kaden (and sign-in says so)', async () => {
    const view = (await call('GET')).body.data
    expect(view.ownerSource).toBe('bootstrap')
    expect(view.owners.map((o: any) => o.name)).toEqual(['Catherine', 'Kaden'])
    expect((await login('owner-secret')).body.data.owners).toEqual(['Catherine', 'Kaden'])
    expect(await actor('kaden')).toEqual({ id: 'owner-kaden', name: 'Kaden' })
    expect(searchMock).not.toHaveBeenCalled() // reading the owners never starts the import from Square
  })

  it('from the staff list: an added owner can be picked; one made Crew or marked as left is not an owner any more', async () => {
    const dana = await addPerson({ givenName: 'Dana', familyName: 'Reyes', role: 'owner', phone: '256-555-0123', email: 'dana@example.com' }, BY)
    const view = (await call('GET')).body.data
    expect(view.ownerSource).toBe('staff-list')
    expect(view.owners).toEqual([
      { id: 'TM1', name: 'Kaden', hasEmail: false, hasPhone: false },
      { id: 'TM4', name: 'Catherine', hasEmail: false, hasPhone: false },
      { id: dana.id, name: 'Dana', hasEmail: true, hasPhone: true },
    ])
    expect(await actor('dana')).toEqual({ id: 'owner-dana', name: 'Dana' })
    expect((await login('owner-secret')).body.data.owners).toEqual(['Kaden', 'Catherine', 'Dana'])

    // Removing an owner: Kaden marked as no longer working here, Dana made Crew.
    await setWorking('TM1', false, BY)
    const people = (await staffListForOwners()).people
    const d = people.find((p) => p.id === dana.id)!
    await editPerson(dana.id, { givenName: 'Dana', familyName: 'Reyes', role: 'crew', phone: '256-555-0123', email: 'dana@example.com' }, BY, d.updatedAt)
    expect((await ownerList()).owners.map((o) => o.name)).toEqual(['Catherine'])
    expect(await actor('Kaden')).toEqual({ id: 'admin', name: 'Owner' })
    expect(await actor('Dana')).toEqual({ id: 'admin', name: 'Owner' })
    expect(await actor('Catherine')).toEqual({ id: 'owner-catherine', name: 'Catherine' })
    // The last owner can't be removed (the staff list keeps at least one).
    await expect(setWorking('TM4', false, BY)).rejects.toThrow(/at least one owner/)
  })

  it('a removed owner’s whole-studio calendar link stops', async () => {
    const { makeFeed } = await import('@lib/staffing/feed-store')
    const feedRoute = await import('@pages/api/calendar/feed/[token].ics')
    await staffListForOwners() // start the list
    const { token } = await makeFeed({ owner: 'Kaden' }, BY)
    const fetchFeed = async () => (await feedRoute.GET({ params: { token }, request: new Request(`https://x.test/api/calendar/feed/${token}.ics`), clientAddress: nextIp() } as any)).status
    expect(await fetchFeed()).not.toBe(404) // a live link (the schedule itself isn't faked here)
    await setWorking('TM1', false, BY)
    expect(await fetchFeed()).toBe(404)
  })
})
