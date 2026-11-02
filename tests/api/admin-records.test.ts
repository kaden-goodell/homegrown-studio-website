// @vitest-environment node
// /admin › More › Records (G8): the legal records for a date range, owners only, passcode asked again, audited, bounded.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { strFromU8, unzipSync } from 'fflate'

const audit = vi.hoisted(() => [] as any[])
vi.mock('@lib/audit', async (orig) => ({ ...(await orig<typeof import('@lib/audit')>()), recordAudit: vi.fn(async (e: any) => { audit.push(e) }) }))

import * as route from '@pages/api/admin/records.json'
import { adminCookie } from '@lib/admin-auth'
import { makeKvStore, type KvStore } from '@lib/blob-store'
import { auditCsv, buildRecordsDownload, checkinsInRange, inRange, lastWeeklyArchive, rangeRefusal, recordDays, TOO_BIG } from '@lib/records-download'

function memory(data: Record<string, unknown> = {}): KvStore {
  const m = new Map(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v) },
    getWithMeta: async (k) => ({ value: m.get(k) ?? null, etag: null }),
    setIfMatch: async () => true,
    list: async () => [...m.keys()],
  }
}

const waiver = (id: string, signedAt: string) => ({ id, signedAt, adult: { firstName: 'Ann', lastName: 'Lee' }, minors: [{ name: 'Bo' }], signature: 'Ann Lee' })
const STORES: Record<string, Record<string, unknown>> = {
  waivers: { w_old: waiver('w_old', '2025-06-01T15:00:00Z'), w_new: waiver('w_new', '2026-10-20T15:00:00Z') },
  rsvps: { 'rsvp-a': { at: '2026-10-21T15:00:00Z', firstAt: '2026-10-21T15:00:00Z' } },
  checkins: {
    'pty_1__wvr_1': { days: { '2026-10-24': {} }, events: [{ at: '2026-10-24T18:00:00Z', action: 'checkin', personIds: ['child:0'], by: { name: 'Jess' } }, { at: '2026-10-24T20:00:00Z', action: 'pickup', personIds: ['child:0'], by: { name: 'Jess' }, collectedBy: 'Ann Lee' }] },
    'pty_0__wvr_0': { days: { '2025-05-01': {} }, events: [{ at: '2025-05-01T18:00:00Z', action: 'checkin', personIds: ['adult'], by: { name: 'Jess' } }] },
  },
  incidents: { inc_1: { id: 'inc_1', at: '2026-10-24T19:00:00Z', reportedAt: '2026-10-24T19:30:00Z', what: 'scraped knee' } },
  'event-meta': { 'event-meta-party:pty_1': { dropOff: false } },
  audit: {
    'audit:2026-10-24T20:00:00.000Z-au_1': { id: 'au_1', at: '2026-10-24T20:00:00.000Z', by: { id: 's', name: 'Jess', role: 'crew' }, action: 'pickup', target: { kind: 'party', id: 'pty_1' } },
    'audit:2025-01-02T20:00:00.000Z-au_0': { id: 'au_0', at: '2025-01-02T20:00:00.000Z', by: { id: 's', name: 'Jess', role: 'crew' }, action: 'comp', target: { kind: 'class', id: 'cls_1' } },
  },
}

describe('which records are in the range', () => {
  const r = { from: '2026-10-01', to: '2026-10-31' }
  it('dates a record by when it was signed, made, happened, or by any check-in day', () => {
    expect(recordDays(STORES.waivers.w_new)).toEqual(['2026-10-20'])
    expect(recordDays(STORES.checkins['pty_1__wvr_1'])).toContain('2026-10-24')
    expect(inRange(STORES.waivers.w_new, r)).toBe(true)
    expect(inRange(STORES.waivers.w_old, r)).toBe(false)
    // no date at all: always kept
    expect(inRange({ dropOff: true }, r)).toBe(true)
  })
  it('studio days: 11:30 PM Oct 31 in Alabama is October', () => {
    expect(inRange({ at: '2026-11-01T04:30:00Z' }, r)).toBe(true)
  })
  it('custody lines are cut to the range', () => {
    const cut = checkinsInRange({ k: { events: [{ at: '2026-10-02T15:00:00Z' }, { at: '2026-12-02T15:00:00Z' }] } }, r) as any
    expect(cut.k.events).toHaveLength(1)
  })
  it('a range needs two days, the first not after the last', () => {
    expect(rangeRefusal({ from: '2026-10-01', to: '2026-10-31' })).toBeNull()
    expect(rangeRefusal({ from: '2026-10-31', to: '2026-10-01' })).toBe('The first day has to be on or before the last day.')
    expect(rangeRefusal({ from: 'yesterday' })).toBe('Pick the first and last day.')
  })
  it('who did what as a spreadsheet, oldest first', () => {
    const csv = auditCsv(STORES.audit as any).trim().split('\n')
    expect(csv[0]).toBe('at,who,role,action,what,id,label,details')
    expect(csv[1]).toMatch(/^2025-01-02.*,Jess,crew,comp,class,cls_1/)
  })
})

describe('buildRecordsDownload', () => {
  const storeFor = (name: string) => memory(STORES[name] ?? {})
  it('one zip: the range’s records, custody.csv, audit.csv, a README in plain words and a manifest', async () => {
    const out = await buildRecordsDownload({ range: { from: '2026-10-01', to: '2026-10-31' }, by: 'Catherine', now: new Date('2026-11-02T15:00:00Z'), storeFor })
    expect(out.filename).toBe('hometown-records-2026-10-01-to-2026-10-31.zip')
    const files = unzipSync(out.bytes)
    expect(Object.keys(files).sort()).toEqual(['README.txt', 'audit.csv', 'audit.json', 'checkins.json', 'custody.csv', 'event-meta.json', 'incidents.json', 'manifest.json', 'rsvps.json', 'waivers.json'])
    expect(Object.keys(JSON.parse(strFromU8(files['waivers.json'])))).toEqual(['w_new'])
    expect(Object.keys(JSON.parse(strFromU8(files['checkins.json'])))).toEqual(['pty_1__wvr_1'])
    expect(Object.keys(JSON.parse(strFromU8(files['audit.json'])))).toEqual(['audit:2026-10-24T20:00:00.000Z-au_1'])
    expect(Object.keys(JSON.parse(strFromU8(files['event-meta.json'])))).toEqual(['event-meta-party:pty_1'])
    expect(strFromU8(files['custody.csv'])).toContain('pty_1,wvr_1,,2026-10-24T20:00:00Z,pickup,child:0,Jess,Ann Lee')
    const readme = strFromU8(files['README.txt'])
    expect(readme).toContain('Covers: 2026-10-01 to 2026-10-31 (both days included).')
    expect(readme).toContain('custody.csv: The same check-ins and pickups as a spreadsheet')
    expect(readme).toContain('- waivers: 1')
    expect(out.counts).toMatchObject({ waivers: 1, rsvps: 1, checkins: 1, incidents: 1, audit: 1 })
  })
  it('Everything: every store the weekly archive keeps, whatever the date', async () => {
    const out = await buildRecordsDownload({ range: null, everything: true, by: 'Catherine', storeFor })
    const files = unzipSync(out.bytes)
    expect(Object.keys(JSON.parse(strFromU8(files['waivers.json']))).sort()).toEqual(['w_new', 'w_old'])
    expect(files['classes.json']).toBeTruthy()
    expect(files['parties.json']).toBeTruthy()
    expect(out.filename).toMatch(/^hometown-records-everything-\d{4}-\d{2}-\d{2}\.zip$/)
  })
  it('too big for one file is refused (never cut short)', async () => {
    const big = randomBytes(6 * 1024 * 1024).toString('base64')
    const stores: Record<string, Record<string, unknown>> = { ...STORES, incidents: { inc_big: { at: "2026-10-24T19:00:00Z", photo: big } } }
    await expect(buildRecordsDownload({ range: { from: '2026-10-01', to: '2026-10-31' }, by: 'C', storeFor: (n) => memory(stores[n] ?? {}) })).rejects.toThrow(TOO_BIG)
  })
  it('the newest weekly copy’s day', async () => {
    expect(await lastWeeklyArchive(memory({ 'archive/2026-10-25.json': '{}', 'archive/2026-11-01.json': '{}' }))).toBe('2026-11-01')
    expect(await lastWeeklyArchive(memory())).toBeNull()
  })
})

describe('records.json', () => {
  const cookie = () => adminCookie().split(';')[0]
  let ip = 0
  async function post(body: unknown, signedIn = true, address = `10.1.0.${++ip}`) {
    const request = new Request('https://x.test/api/admin/records.json', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Who': 'Catherine', ...(signedIn ? { cookie: cookie() } : {}) }, body: JSON.stringify(body) })
    return (await route.POST({ request, clientAddress: address } as any)) as Response
  }
  beforeEach(async () => {
    vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
    audit.length = 0
    await makeKvStore('waivers', 'waivers').set('w_route', JSON.stringify(waiver('w_route', '2026-10-20T15:00:00Z')))
  })
  afterEach(() => vi.unstubAllEnvs())

  it('owners only', async () => {
    expect((await post({ from: '2026-10-01', to: '2026-10-31', passcode: 'owner-secret' }, false)).status).toBe(401)
    const get = await route.GET({ request: new Request('https://x.test/api/admin/records.json') } as any)
    expect(get.status).toBe(401)
  })
  it('the passcode is asked again; a wrong one is refused (not signed out), audited, and limited', async () => {
    const address = '10.9.9.9'
    const r = await post({ from: '2026-10-01', to: '2026-10-31', passcode: 'nope' }, true, address)
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: route.WRONG_PASSCODE, field: 'passcode' })
    expect(audit[0]).toMatchObject({ action: 'records-download-refused', by: { name: 'Catherine' } })
    for (let i = 0; i < 4; i++) await post({ from: '2026-10-01', to: '2026-10-31', passcode: 'nope' }, true, address)
    expect((await post({ from: '2026-10-01', to: '2026-10-31', passcode: 'owner-secret' }, true, address)).status).toBe(429)
  })
  it('a bad range says what to fix', async () => {
    const r = await post({ from: '2026-10-31', to: '2026-10-01', passcode: 'owner-secret' })
    expect(r.status).toBe(400)
    expect((await r.json()).field).toBe('range')
  })
  it('downloads the zip and audits who took it, which days and how many', async () => {
    const r = await post({ from: '2026-10-01', to: '2026-10-31', passcode: 'owner-secret' })
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Type')).toBe('application/zip')
    expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="hometown-records-2026-10-01-to-2026-10-31.zip"')
    const files = unzipSync(new Uint8Array(await r.arrayBuffer()))
    expect(Object.keys(JSON.parse(strFromU8(files['waivers.json'])))).toContain('w_route')
    expect(audit.at(-1)).toMatchObject({ action: 'records-download', by: { name: 'Catherine', role: 'owner' }, target: { kind: 'records', id: '2026-10-01..2026-10-31' }, details: { waivers: expect.any(Number) } })
  })
  it('GET says when the last weekly copy was made', async () => {
    const res = await route.GET({ request: new Request('https://x.test/api/admin/records.json', { headers: { cookie: cookie() } }) } as any)
    expect(await res.json()).toEqual({ data: { lastArchive: null } })
  })
})
