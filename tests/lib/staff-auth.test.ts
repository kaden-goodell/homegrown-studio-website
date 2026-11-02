// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// The real staff list (fs-backed); Square is a fake used only by its first import.
const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))
vi.mock('@providers/square/client', () => ({ createSquareClient: () => ({ teamMembers: { search: searchMock } }) }))

import { staffCookie, staffAuthorized, checkPasscode, passcodeConfigured } from '@lib/staff-auth'
import { _resetStaffCache, _resetStaffListForTests, setWorking } from '@lib/staff-directory'
import { _resetPasscodeCache, _resetPasscodeForTests, setStaffPasscode } from '@lib/staff-passcode'

const member = { id: 'TM1', name: 'Kaden', role: 'owner' as const }
const crew = { id: 'TM2', name: 'Jessica', role: 'crew' as const }
const req = (cookie: string) => new Request('http://x/', { headers: { cookie } })
const cookieOf = async (m: typeof member | typeof crew, iat?: number) => (await staffCookie(m, iat)).split(';')[0]
const BY = { id: 'owner-catherine', name: 'Catherine' }
const TEAM = [
  { id: 'TM1', givenName: 'Kaden', familyName: 'Goodell', status: 'ACTIVE', isOwner: true },
  { id: 'TM4', givenName: 'Catherine', familyName: 'Goodell', status: 'ACTIVE', isOwner: false },
  { id: 'TM2', givenName: 'Jessica', familyName: 'Lane', status: 'ACTIVE', isOwner: false },
]

beforeEach(async () => {
  process.env.STAFF_PASSCODE = 'secret-123'
  await _resetPasscodeForTests()
  await _resetStaffListForTests()
  searchMock.mockReset()
  searchMock.mockResolvedValue({ teamMembers: TEAM })
})

describe('staff-auth', () => {
  it('round-trips a signed cookie', async () => {
    expect(await staffAuthorized(req(await cookieOf(member)))).toEqual(member)
  })

  it('rejects a tampered payload', async () => {
    const c = await cookieOf(member)
    const [k, v] = c.split('=')
    const [payload, sig] = v.split('.')
    const bad = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'crew', name: 'Mallory' }),
    ).toString('base64url')
    expect(await staffAuthorized(req(`${k}=${bad}.${sig}`))).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const c = await cookieOf(member)
    expect(await staffAuthorized(req(c.slice(0, -2) + 'zz'))).toBeNull()
  })

  it('rejects an expired cookie', async () => {
    expect(await staffAuthorized(req(await cookieOf(member, Date.now() - 13 * 3600 * 1000)))).toBeNull()
  })

  it('fails closed without a passcode', async () => {
    const c = await cookieOf(member)
    process.env.STAFF_PASSCODE = ''
    expect(await staffAuthorized(req(c))).toBeNull()
    expect(await checkPasscode('anything')).toBe(false)
    expect(await passcodeConfigured()).toBe(false)
  })

  it('compares the passcode in constant time (no throw on length mismatch)', async () => {
    expect(await checkPasscode('x')).toBe(false)
    expect(await checkPasscode('secret-123')).toBe(true)
  })
})

describe('someone who no longer works here is locked out at once', () => {
  it('their cookie stops counting the moment they are marked as left, and works again if they come back', async () => {
    const c = await cookieOf(crew)
    expect(await staffAuthorized(req(c))).toEqual(crew)
    await setWorking('TM2', false, BY)
    expect(await staffAuthorized(req(c))).toBeNull()
    await setWorking('TM2', true, BY)
    expect(await staffAuthorized(req(c))).toEqual(crew)
  })

  it('when the staff list cannot be read at all, a signed-in person is let through (a store blip never locks the door)', async () => {
    const c = await cookieOf(crew)
    await _resetStaffListForTests()
    searchMock.mockRejectedValue(new Error('square down'))
    expect(await staffAuthorized(req(c))).toEqual(crew)
  })

  it('the fallback owner ids (handed out only while the list is unreadable) still count', async () => {
    const fallback = { id: 'catherine', name: 'Catherine', role: 'owner' as const }
    expect(await staffAuthorized(req((await staffCookie(fallback)).split(';')[0]))).toEqual(fallback)
  })
})

describe('the staff passcode set in /admin', () => {
  it('takes the place of STAFF_PASSCODE: the old passcode is refused, old cookies stop counting, the new one works', async () => {
    const before = await cookieOf(member)
    expect(await staffAuthorized(req(before))).toEqual(member)
    await setStaffPasscode('door-4821', BY, null)
    expect(await checkPasscode('secret-123')).toBe(false)
    expect(await checkPasscode('door-4821')).toBe(true)
    expect(await staffAuthorized(req(before))).toBeNull()
    const after = await cookieOf(member)
    expect(await staffAuthorized(req(after))).toEqual(member)
  })

  it('changing it again signs everyone out again, even when set to the same passcode', async () => {
    const first = await setStaffPasscode('door-4821', BY, null)
    const c = await cookieOf(member)
    expect(await staffAuthorized(req(c))).toEqual(member)
    await setStaffPasscode('door-4821', BY, first.updatedAt)
    expect(await staffAuthorized(req(c))).toBeNull()
    expect(await checkPasscode('door-4821')).toBe(true)
  })

  it('another server sees the change within a few seconds (no stale cache after a fresh read)', async () => {
    await setStaffPasscode('door-4821', BY, null)
    _resetPasscodeCache()
    expect(await checkPasscode('secret-123')).toBe(false)
    expect(await checkPasscode('door-4821')).toBe(true)
  })

  it('works with no STAFF_PASSCODE setting at all', async () => {
    process.env.STAFF_PASSCODE = ''
    expect(await passcodeConfigured()).toBe(false)
    await setStaffPasscode('door-4821', BY, null)
    expect(await passcodeConfigured()).toBe(true)
    expect(await staffAuthorized(req(await cookieOf(member)))).toEqual(member)
  })

  it('a deactivated person is refused on a money route even with a cookie made after the change', async () => {
    await setStaffPasscode('door-4821', BY, null)
    const c = await cookieOf(crew)
    await setWorking('TM2', false, BY)
    _resetStaffCache()
    const { POST } = await import('@pages/api/staff/class-refund.json')
    const res: Response = await (POST as any)({ request: new Request('https://x.test/api/staff/class-refund.json', { method: 'POST', headers: { cookie: c, 'Content-Type': 'application/json' }, body: '{}' }) })
    expect(res.status).toBe(401)
  })
})
