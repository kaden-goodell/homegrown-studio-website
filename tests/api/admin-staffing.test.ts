// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Schedule sources, the team and the messages are mocked; the staffing stores are the real fs-backed ones.
const src = vi.hoisted(() => ({
  classes: [] as any[],
  parties: [] as any[],
  records: new Map<string, any>(),
  team: [] as any[],
  audit: [] as any[],
  told: [] as any[],
  tellResult: { email: true, text: true, warning: null as string | null },
}))

vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { src.audit.push(e) }) }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: vi.fn(async (range?: { fromIso: string; toIso: string }) => {
    if (!range) return src.classes
    const f = Date.parse(range.fromIso), t = Date.parse(range.toIso)
    return src.classes.filter((c) => c.sessions.some((s: any) => Date.parse(s.startIso) < t && Date.parse(s.endIso) > f))
  }),
}))
vi.mock('@lib/classes/studio-schedule', () => ({
  partyBusy: vi.fn(async (fromIso: string, toIso: string) => {
    const f = Date.parse(fromIso), t = Date.parse(toIso)
    return src.parties.filter((b) => Date.parse(b.startIso) < t && Date.parse(b.endIso) > f)
  }),
  legacyClassSpans: vi.fn(async () => []),
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async (id: string) => src.records.get(id) ?? null) }))
vi.mock('@lib/staff-directory', () => ({
  teamWithContacts: vi.fn(async () => ({ people: src.team, source: 'square' })),
  isActiveStaffId: vi.fn(async (id: string) => src.team.some((p) => p.id === id && p.active)),
}))
vi.mock('@lib/staffing/notify', () => ({
  tellPerson: vi.fn(async (kind: string, person: any, ev: any, origin: string) => { src.told.push({ kind, person, ev, origin }); return src.tellResult }),
}))

import * as route from '@pages/api/admin/staffing.json'
import * as crewRoute from '@pages/api/staff/shifts.json'
import { adminCookie } from '@lib/admin-auth'
import { staffCookie } from '@lib/staff-auth'
import { getEntries, updateEntry } from '@lib/staffing/staffing-store'
import { saveAvailability, getAvailability } from '@lib/staffing/availability-store'
import { withAssigned } from '@lib/staffing/rules'

let n = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const person = (id: string, name: string, role = 'crew') => ({ id, name, givenName: name, role, email: `${name.toLowerCase()}@example.com`, phone: '+12565550199', active: true })
const DAY = 86_400_000
const inDays = (d: number, h = 0) => new Date(Date.now() + d * DAY + h * 3_600_000).toISOString()
function klass(name = 'Needlepoint 101', start = inDays(3)) {
  return { id: uid('cls_'), status: 'open', content: { name, rules: {} }, sessions: [{ id: uid('ses_'), startIso: start, endIso: new Date(Date.parse(start) + 2 * 3_600_000).toISOString(), capacity: 12 }] }
}
const keyOf = (c: any) => `ses:${c.sessions[0].id}` as const

async function call(method: 'GET' | 'POST', body?: unknown, opts: { query?: string; cookie?: string | null; who?: string } = {}) {
  const cookie = opts.cookie === undefined ? adminCookie().split(';')[0] : opts.cookie
  const request = new Request(`https://kaden-own-booking-system--site.netlify.app/api/admin/staffing.json${opts.query ?? ''}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), 'X-Admin-Who': opts.who ?? 'Catherine' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (route as any)[method]({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  src.classes = []
  src.parties = []
  src.records = new Map()
  src.team = [person('TM1', 'Kaden', 'owner'), person('TM4', 'Catherine', 'owner'), person('TM2', 'Jessica'), person('TM3', 'Sam')]
  src.audit = []
  src.told = []
  src.tellResult = { email: true, text: true, warning: null }
})

describe('who may', () => {
  it('401 without the admin cookie; a /staff cookie of any role is not enough', async () => {
    const c = klass()
    src.classes = [c]
    expect((await call('GET', undefined, { query: `?key=${keyOf(c)}`, cookie: null })).status).toBe(401)
    for (const role of ['crew', 'owner'] as const) {
      const staff = staffCookie({ id: 'TM1', name: 'Kaden', role }).split(';')[0]
      expect((await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM2', tell: false }, { cookie: staff })).status).toBe(401)
    }
    expect((await getEntries([keyOf(c)])).size).toBe(0)
  })
})

describe('GET', () => {
  it('the board: rows, the team without contact details, where the team came from', async () => {
    const c = klass()
    src.classes = [c]
    const r = await call('GET', undefined, { query: `?from=${inDays(0)}&to=${inDays(14)}` })
    expect(r.status).toBe(200)
    expect(r.body.data.rows.map((x: any) => x.event.key)).toEqual([keyOf(c)])
    expect(r.body.data.team).toEqual([
      { id: 'TM1', name: 'Kaden', role: 'owner' }, { id: 'TM4', name: 'Catherine', role: 'owner' },
      { id: 'TM2', name: 'Jessica', role: 'crew' }, { id: 'TM3', name: 'Sam', role: 'crew' },
    ])
    expect(r.body.data.teamSource).toBe('square')
    expect(JSON.stringify(r.body)).not.toMatch(/example\.com|\+1256/)
    expect((await call('GET', undefined, { query: `?from=${inDays(0)}&to=${inDays(71)}` })).status).toBe(400)
  })

  it('one row by key, and 404 for an unknown key', async () => {
    const c = klass()
    src.classes = [c]
    const r = await call('GET', undefined, { query: `?key=${keyOf(c)}` })
    expect(r.body.data.row).toMatchObject({ event: { key: keyOf(c), title: 'Needlepoint 101' }, state: 'none', needed: 1 })
    expect((await call('GET', undefined, { query: '?key=ses:nope' })).status).toBe(404)
  })
})

describe('assign and unassign', () => {
  it('assign tells the person, records who was told, audits; unassign tells them they are off', async () => {
    const c = klass()
    src.classes = [c]
    let r = await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM2', tell: true })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBeUndefined()
    expect(r.body.data.row).toMatchObject({ state: 'staffed' })
    expect(r.body.data.row.people[0]).toMatchObject({ staffId: 'TM2', assigned: true })
    expect(src.told).toHaveLength(1)
    expect(src.told[0]).toMatchObject({ kind: 'on', person: { id: 'TM2' }, origin: 'https://kaden-own-booking-system--site.netlify.app' })
    const e = (await getEntries([keyOf(c)])).get(keyOf(c))!
    expect(e.assigned[0]).toMatchObject({ staffId: 'TM2', name: 'Jessica', by: { name: 'Catherine' }, notified: { email: true, text: true } })
    expect(e.history.map((h) => h.change)).toEqual(['Told Jessica by text and email', 'Catherine put Jessica on'])
    expect(src.audit[0]).toMatchObject({ action: 'staffing.assign', by: { name: 'Catherine', role: 'owner' }, details: { staffId: 'TM2', toldByText: true } })

    // the same again: nothing new, nobody told twice
    await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM2', tell: true })
    expect(src.told).toHaveLength(1)

    r = await call('POST', { action: 'unassign', key: keyOf(c), staffId: 'TM2', tell: true })
    expect(r.body.data.row.state).toBe('none')
    expect(src.told[1]).toMatchObject({ kind: 'off' })
    expect(src.audit.map((a) => a.action)).toEqual(['staffing.assign', 'staffing.unassign'])
  })

  it('tell: false sends nothing', async () => {
    const c = klass()
    src.classes = [c]
    await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM2', tell: false })
    await call('POST', { action: 'unassign', key: keyOf(c), staffId: 'TM2', tell: false })
    expect(src.told).toEqual([])
  })

  it("a message that didn't go keeps the assignment and says so", async () => {
    const c = klass()
    src.classes = [c]
    src.tellResult = { email: true, text: false, warning: "Saved. The text to Jessica didn't go through." }
    const r = await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM2', tell: true })
    expect(r).toMatchObject({ status: 200, body: { warning: "Saved. The text to Jessica didn't go through." } })
    expect((await getEntries([keyOf(c)])).get(keyOf(c))!.assigned.map((a) => a.staffId)).toEqual(['TM2'])
  })

  it("someone who marked the time as Can't can still be put on; the owner is told", async () => {
    const c = klass('Weaving', inDays(3))
    src.classes = [c]
    const wd = new Date(c.sessions[0].startIso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Chicago' })
    const day = String(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd))
    await saveAvailability('TM3', 'Sam', { weekly: { [day]: { kind: 'cant', range: null, note: 'dentist' } }, dates: {} }, { id: 'TM3', name: 'Sam' }, (await getAvailability('TM3'))?.updatedAt ?? null)
    const r = await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM3', tell: false })
    expect(r.status).toBe(200)
    expect(r.body.warning).toBe("Sam marked this time as Can't (dentist).")
  })

  it('refuses unknown or departed people, fallback ids, cancelled and past events', async () => {
    const c = klass(), past = klass('Old', inDays(0, -5)), cancelled = { ...klass('Gone'), status: 'cancelled' }
    src.classes = [c, past, cancelled]
    expect(await call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM9', tell: false })).toEqual({ status: 400, body: { error: "That person isn't on the team list." } })
    expect((await call('POST', { action: 'assign', key: keyOf(c), staffId: 'kaden', tell: false })).status).toBe(400)
    expect((await call('POST', { action: 'assign', key: keyOf(past), staffId: 'TM2', tell: false })).body.error).toBe('That one has already happened.')
    await updateEntry(keyOf(cancelled), (e) => withAssigned(e, { staffId: 'TM2', name: 'Jessica', by: { id: 'x', name: 'Kaden' }, at: 'x', notified: null }), 'on', { id: 'x', name: 'Kaden' })
    expect((await call('POST', { action: 'assign', key: keyOf(cancelled), staffId: 'TM3', tell: false })).status).toBe(409)
    // taking someone off a cancelled class is fine, and nobody is texted about a cancelled class from here
    const off = await call('POST', { action: 'unassign', key: keyOf(cancelled), staffId: 'TM2', tell: true })
    expect(off.status).toBe(200)
    expect(src.told).toEqual([])
    expect((await getEntries([keyOf(c)])).size).toBe(0)
  })

  it('someone on a class that is gone from the schedule can still be taken off', async () => {
    const key = `ses:${uid('ses_')}` as const
    await updateEntry(key, (e) => withAssigned(e, { staffId: 'TM2', name: 'Jessica', by: { id: 'x', name: 'Kaden' }, at: 'x', notified: null }), 'on', { id: 'x', name: 'Kaden' })
    const r = await call('POST', { action: 'unassign', key, staffId: 'TM2', tell: true })
    expect(r.status).toBe(200)
    expect(r.body.data.entry.assigned).toEqual([])
  })

  it('two owners putting different people on at once both stay (no stale refusal)', async () => {
    const c = klass()
    src.classes = [c]
    const [a, b] = await Promise.all([
      call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM2', tell: false, expectedUpdatedAt: null }, { who: 'Catherine' }),
      call('POST', { action: 'assign', key: keyOf(c), staffId: 'TM3', tell: false, expectedUpdatedAt: null }, { who: 'Kaden' }),
    ])
    expect([a.status, b.status]).toEqual([200, 200])
    expect((await getEntries([keyOf(c)])).get(keyOf(c))!.assigned.map((x) => x.staffId).sort()).toEqual(['TM2', 'TM3'])
  })
})

describe('needed', () => {
  it('sets, resets to usual, and refuses a stale sheet with the latest', async () => {
    const c = klass()
    src.classes = [c]
    let r = await call('POST', { action: 'needed', key: keyOf(c), needed: 2, expectedUpdatedAt: null })
    expect(r.body.data.row).toMatchObject({ needed: 2, state: 'none' })
    const loaded = r.body.data.row.entry.updatedAt
    const stale = await call('POST', { action: 'needed', key: keyOf(c), needed: 0, expectedUpdatedAt: null })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: "Someone else just changed who's on this. Here's the latest.", stale: true, current: { needed: 2 } })
    r = await call('POST', { action: 'needed', key: keyOf(c), needed: 0, expectedUpdatedAt: loaded })
    expect(r.body.data.row).toMatchObject({ needed: 0, state: 'staffed' })
    r = await call('POST', { action: 'needed', key: keyOf(c), needed: null, expectedUpdatedAt: r.body.data.row.entry.updatedAt })
    expect(r.body.data.row.needed).toBe(1)
    expect(src.audit.filter((a) => a.action === 'staffing.needed')).toHaveLength(3)
    for (const bad of [7, -1, 1.5, '2']) {
      expect((await call('POST', { action: 'needed', key: keyOf(c), needed: bad })).body.error).toBe('Pick a number from 0 to 6, or Usual.')
    }
  })
})

describe('crew route still refuses what /admin allows', () => {
  it('the same assign through /staff is 403', async () => {
    const c = klass()
    src.classes = [c]
    const request = new Request('https://x.test/api/staff/shifts.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: staffCookie({ id: 'TM1', name: 'Kaden', role: 'owner' }).split(';')[0] },
      body: JSON.stringify({ action: 'assign', key: keyOf(c), staffId: 'TM2' }),
    })
    const res: Response = await (crewRoute as any).POST({ request, url: new URL(request.url) })
    expect(res.status).toBe(403)
    expect((await getEntries([keyOf(c)])).size).toBe(0)
  })
})
