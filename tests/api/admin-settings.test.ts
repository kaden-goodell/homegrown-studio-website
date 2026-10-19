// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(),
  listAllWorkshops: vi.fn(),
  audit: vi.fn(),
  get: vi.fn(),
  upsert: vi.fn(),
  sandbox: false,
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async () => ({ hostName: 'Stefanie Justice' })) }))
vi.mock('@lib/audit', () => ({ recordAudit: mocks.audit }))
vi.mock('@lib/settings-effects', async (orig) => ({
  ...(await orig<typeof import('@lib/settings-effects')>()),
  cafeSquareDeps: () => ({ client: { catalog: { object: { get: mocks.get, upsert: mocks.upsert } } }, itemId: 'CAFE_ITEM', sandbox: mocks.sandbox }),
}))

import * as route from '@pages/api/admin/settings.json'
import { adminCookie } from '@lib/admin-auth'
import { configSettings, getClosures, resetStudioDaysCache } from '@lib/studio-settings'
import { createClass } from '@lib/classes/class-store'
import { localToUtcISO } from '@lib/party-slots'
import { rmSync } from 'node:fs'
import type { ClassContent } from '@lib/classes/types'

const cookie = () => adminCookie().split(';')[0]
async function call(method: 'GET' | 'POST', body?: unknown, opts: { signedIn?: boolean; who?: string } = {}) {
  const request = new Request('https://x.test/api/admin/settings.json', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.signedIn === false ? {} : { cookie: cookie() }),
      ...(opts.who ? { 'X-Admin-Who': opts.who } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (route as any)[method]({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}
function content(name: string): ClassContent {
  return {
    name, description: 'Make a thing.', imageUrl: null, instructor: null,
    rules: { ages: '', dropOff: false, madeToOrder: false, taxable: true, maxPerBooking: 10, signupCutoffHours: null, minimumToRun: null, linkOnly: false, joinPartway: true, waitlistCutoffHours: 2, canShareRoom: false },
    ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Full', covers: { kind: 'all' } }],
    prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 12, defaultMinutes: 90,
  }
}
const item = { id: 'CAFE_ITEM', version: 3, itemData: { name: 'Craft Café' }, customAttributeValues: {} }

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  // These tests play the live site (R39); one below plays a preview.
  vi.stubEnv('CAFE_WINDOWS_WRITE', '1')
  rmSync(`${process.env.BLOB_STORE_FS_DIR}/studio-settings`, { recursive: true, force: true })
  resetStudioDaysCache()
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
  mocks.audit.mockReset().mockResolvedValue(undefined)
  mocks.get.mockReset().mockResolvedValue({ object: item })
  mocks.upsert.mockReset().mockImplementation(async (r: any) => ({ catalogObject: { ...r.object, version: 4 } }))
  mocks.sandbox = false
})
afterEach(() => vi.unstubAllEnvs())

const loaded = async () => (await call('GET')).body.data.settings
const save = async (over: Record<string, unknown>, who = 'Catherine') => {
  const s = await loaded()
  return call('POST', { cafeWeekly: s.cafeWeekly, cafeSpecialDays: s.cafeSpecialDays, closures: s.closures, expectedUpdatedAt: s.updatedAt, ...over }, { who })
}

describe('GET /api/admin/settings.json', () => {
  it('owners only', async () => {
    expect((await call('GET', undefined, { signedIn: false })).status).toBe(401)
    expect((await call('POST', {}, { signedIn: false })).status).toBe(401)
  })
  it('before anyone saves: the config, with updatedAt null', async () => {
    const s = await loaded()
    expect(s.updatedAt).toBeNull()
    expect(s.closures).toEqual(configSettings().closures)
    expect(s.cafeWeekly).toEqual([{ weekday: 'Saturday', opens: '09:00', closes: '12:00' }])
  })
})

describe('POST: save', () => {
  it('saves, records who (audit and history), and rewrites the café windows in Square', async () => {
    const r = await save({ cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '13:00' }] })
    expect(r.status).toBe(200)
    expect(r.body.data.changed).toEqual(['Craft Café weekly hours'])
    expect(r.body.data.settings.by).toEqual({ id: 'owner-catherine', name: 'Catherine' })
    expect(r.body.data.square).toMatchObject({ status: 'updated' })
    const written = mocks.upsert.mock.calls[0][0].object.customAttributeValues.programDates.stringValue as string
    expect(written).toContain('T09:00-13:00')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      by: { id: 'owner-catherine', name: 'Catherine', role: 'owner' }, action: 'studio-settings',
      details: { changed: 'Craft Café weekly hours' },
    }))
    expect((await loaded()).updatedAt).toBe(r.body.data.settings.updatedAt)
  })

  it('refuses bad input with the field to fix', async () => {
    const r = await save({ cafeSpecialDays: [{ date: '2026-12-12', opens: '17:00', closes: '09:00', name: 'Market' }] })
    expect(r).toEqual({ status: 400, body: { error: 'It has to close after it opens.', field: 'cafeSpecialDays.0' } })
    const noStamp = await call('POST', { ...configSettings() })
    expect(noStamp.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('a stale screen gets 409 with what is saved now', async () => {
    const first = await save({ closures: [] })
    const stale = await call('POST', { ...configSettings(), expectedUpdatedAt: null })
    expect(stale.status).toBe(409)
    expect(stale.body.stale).toBe(true)
    expect(stale.body.current.updatedAt).toBe(first.body.data.settings.updatedAt)
    expect(stale.body.current.closures).toEqual([])
  })

  it('a closure over a booked party and one of our classes saves, keeps both, and lists them', async () => {
    const day = '2027-02-06'
    mocks.listBookings.mockResolvedValue([{ id: 'bk_1', status: 'accepted', slot: { startAt: localToUtcISO(day, '13:30'), durationMinutes: 150 } }])
    await createClass({
      content: content('Needlepoint 101'),
      sessions: [{ id: 'ses_np', startIso: localToUtcISO(day, '18:00'), endIso: localToUtcISO(day, '20:00'), capacity: 8 }],
      status: 'open',
      by: { id: 'owner-kaden', name: 'Kaden' },
    })
    const r = await save({ closures: [...configSettings().closures, { from: day, to: day, name: 'a snow day' }] })
    expect(r.status).toBe(200)
    const booked = r.body.data.booked
    expect(booked).toHaveLength(1)
    expect(booked[0]).toMatchObject({ from: day, to: day, name: 'a snow day' })
    expect(booked[0].items.map((i: any) => [i.kind, i.label])).toEqual([['party', 'the Justice party'], ['class', 'Needlepoint 101']])
    expect((await getClosures()).some((c) => c.from === day)).toBe(true)
  })

  it('when Square fails the settings stay saved, the reply says so, and Try again rewrites from what is saved', async () => {
    mocks.upsert.mockRejectedValueOnce(new Error('Square is down'))
    const r = await save({ cafeWeekly: [{ weekday: 'Saturday', opens: '10:00', closes: '12:00' }] })
    expect(r.status).toBe(200)
    expect(r.body.data.square).toEqual({ status: 'failed', message: 'Craft Café’s hours in Square didn’t update.' })
    expect((await loaded()).cafeWeekly).toEqual([{ weekday: 'Saturday', opens: '10:00', closes: '12:00' }])

    const retry = await call('POST', { action: 'square-retry' }, { who: 'Kaden' })
    expect(retry.status).toBe(200)
    expect(retry.body.data.square.status).toBe('updated')
    expect(mocks.upsert.mock.calls.at(-1)![0].object.customAttributeValues.programDates.stringValue).toContain('T10:00-12:00')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'studio-settings-square', by: { id: 'owner-kaden', name: 'Kaden', role: 'owner' } }))
  })

  it('the sandbox (no café item): skipped with a plain line', async () => {
    mocks.sandbox = true
    mocks.get.mockRejectedValue(Object.assign(new Error('NOT_FOUND'), { statusCode: 404 }))
    const r = await save({ closures: [] })
    expect(r.body.data.square).toEqual({ status: 'skipped', message: 'Square isn’t updated from the test site.' })
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('R39: local dev and previews never write to Square, and say so', async () => {
    vi.stubEnv('CAFE_WINDOWS_WRITE', '')
    const r = await save({ cafeWeekly: [{ weekday: 'Saturday', opens: '10:00', closes: '12:00' }] })
    expect(r.body.data.square).toEqual({ status: 'skipped', message: 'Square isn’t updated from the test site.' })
    expect(mocks.get).not.toHaveBeenCalled()
    const retry = await call('POST', { action: 'square-retry' })
    expect(retry.body.data.square.status).toBe('skipped')
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('a closed day with no café on it says nothing about Square', async () => {
    const r = await save({ closures: [...configSettings().closures, { from: '2027-02-03', to: '2027-02-03', name: 'a Wednesday off' }] })
    expect(r.body.data.changed).toEqual(['Closed Wed, Feb 3 (a Wednesday off)'])
    expect(r.body.data.square).toBeNull()
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('nothing changed: nothing goes to Square', async () => {
    const r = await save({})
    expect(r.status).toBe(200)
    expect(r.body.data.changed).toEqual([])
    expect(r.body.data.square).toBeNull()
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
