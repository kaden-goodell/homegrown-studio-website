// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Schedule sources and the team are mocked; the staffing stores are the real fs-backed ones.
const src = vi.hoisted(() => ({
  classes: [] as any[],
  parties: [] as any[],
  records: new Map<string, any>(),
  team: [] as any[],
  me: null as null | { id: string; name: string; role: 'owner' | 'crew' },
  audit: [] as any[],
  site: 'dev' as string,
}))

vi.mock('@lib/staff-auth', async (orig) => ({
  ...(await orig<typeof import('@lib/staff-auth')>()),
  staffAuthorized: () => src.me,
}))
vi.mock('@lib/deploy-context', () => ({ deployContext: () => src.site }))
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

import * as route from '@pages/api/staff/shifts.json'
import { getAvailability, saveAvailability } from '@lib/staffing/availability-store'
import { getEntries, updateEntry } from '@lib/staffing/staffing-store'
import { withAssigned, withAsk } from '@lib/staffing/rules'
import { NO_TEST_STORE } from '@lib/classes/test-site-guard'

let n = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const person = (id: string, name: string, role = 'crew') => ({ id, name, givenName: name, role, email: `${name.toLowerCase()}@example.com`, phone: '+12565550199', active: true })
const kaden = { id: 'TM1', name: 'Kaden' }
const DAY = 86_400_000
const inDays = (d: number, h = 0) => new Date(Date.now() + d * DAY + h * 3_600_000).toISOString()

function klass(name = 'Needlepoint 101', start = inDays(3)) {
  return { id: uid('cls_'), status: 'open', content: { name, rules: {} }, sessions: [{ id: uid('ses_'), startIso: start, endIso: new Date(Date.parse(start) + 2 * 3_600_000).toISOString(), capacity: 12 }] }
}
const keyOf = (c: any) => `ses:${c.sessions[0].id}` as const

async function call(method: 'GET' | 'POST', body?: unknown, query = '') {
  const request = new Request(`https://x.test/api/staff/shifts.json${query}`, {
    method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const res: Response = await (route as any)[method]({ request, url: new URL(request.url) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  src.classes = []
  src.parties = []
  src.records = new Map()
  src.team = [person('TM1', 'Kaden', 'owner'), person('TM2', 'Jessica'), person('TM3', 'Sam')]
  src.me = { id: 'TM2', name: 'Jessica', role: 'crew' }
  src.audit = []
  src.site = 'dev'
})

describe('who is asking', () => {
  it('401 without the staff cookie', async () => {
    src.me = null
    expect((await call('GET')).status).toBe(401)
    expect((await call('POST', { action: 'ask', key: 'ses:x' })).status).toBe(401)
  })

  it('403 for a fallback id or someone who left the team; nothing written', async () => {
    src.me = { id: 'kaden', name: 'Kaden', role: 'owner' }
    const r = await call('POST', { action: 'availability', weekly: {}, dates: {}, expectedUpdatedAt: null })
    expect(r).toEqual({ status: 403, body: { error: "You're not on the staff list any more. Ask an owner." } })
    expect(await getAvailability('kaden')).toBeNull()
    src.me = { id: 'TM9', name: 'Morgan', role: 'crew' }
    expect((await call('GET')).status).toBe(403)
  })

  it('cookie is the person: a staffId in the body is ignored', async () => {
    src.me = { id: uid('TMX'), name: 'Jessica', role: 'crew' }
    src.team.push(person(src.me.id, 'Jessica'))
    const r = await call('POST', { action: 'availability', staffId: 'TM3', weekly: { '6': { kind: 'can', range: null, note: '' } }, dates: {}, expectedUpdatedAt: null })
    expect(r.status).toBe(200)
    expect((await getAvailability(src.me.id))!.weekly['6']).toMatchObject({ kind: 'can' })
    expect(await getAvailability('TM3')).toBeNull()
    expect(src.audit[0]).toMatchObject({ action: 'staff.availability', by: { id: src.me.id, role: 'crew' }, details: { change: 'Usual week: Sat' } })
  })
})

describe("crew can't assign", () => {
  it('assign, unassign and needed are 403 with nothing written, for crew and for an owner on /staff', async () => {
    const c = klass()
    src.classes = [c]
    for (const me of [{ id: 'TM2', name: 'Jessica', role: 'crew' as const }, { id: 'TM1', name: 'Kaden', role: 'owner' as const }]) {
      src.me = me
      for (const action of ['assign', 'unassign', 'needed']) {
        const r = await call('POST', { action, key: keyOf(c), staffId: me.id, needed: 0, tell: false })
        expect(r).toEqual({ status: 403, body: { error: 'Only an owner can put people on a class or party. Ask Catherine or Kaden.' } })
      }
    }
    expect((await getEntries([keyOf(c)])).size).toBe(0)
    expect(src.audit).toEqual([])
  })

  it('an unknown action is a plain 400', async () => {
    expect((await call('POST', { action: 'promote' })).status).toBe(400)
  })
})

describe('availability', () => {
  it('saves with expectedUpdatedAt; stale → 409 with the saved times', async () => {
    const id = uid('TMS')
    src.me = { id, name: 'Jessica', role: 'crew' }
    src.team.push(person(id, 'Jessica'))
    const first = await call('POST', { action: 'availability', weekly: { '6': { kind: 'can', range: { from: '09:00', to: '17:00' }, note: '' } }, dates: {}, expectedUpdatedAt: null })
    expect(first.status).toBe(200)
    const saved = first.body.data.availability
    const stale = await call('POST', { action: 'availability', weekly: {}, dates: {}, expectedUpdatedAt: null })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toBe('Someone changed your times on another device. Here they are.')
    expect(stale.body.current.weekly['6']).toEqual(saved.weekly['6'])
    const second = await call('POST', { action: 'availability', weekly: {}, dates: {}, expectedUpdatedAt: saved.updatedAt })
    expect(second.status).toBe(200)
  })

  it('a bad time gets the plain sentence', async () => {
    const r = await call('POST', { action: 'availability', weekly: { '6': { kind: 'can', range: { from: '17:00', to: '09:00' }, note: '' } }, dates: {}, expectedUpdatedAt: null })
    expect(r).toMatchObject({ status: 400, body: { error: 'Pick an end time after the start.' } })
  })

  it('R41: a test site with no store of its own is told plainly, nothing written', async () => {
    const id = uid('TMR')
    src.me = { id, name: 'Jessica', role: 'crew' }
    src.team.push(person(id, 'Jessica'))
    const prevNs = process.env.STORE_NAMESPACE
    delete process.env.STORE_NAMESPACE
    src.site = 'deploy-preview'
    try {
      const r = await call('POST', { action: 'availability', weekly: {}, dates: {}, expectedUpdatedAt: null })
      expect(r).toEqual({ status: 503, body: { error: NO_TEST_STORE } })
    } finally {
      src.site = 'dev'
      if (prevNs !== undefined) process.env.STORE_NAMESPACE = prevNs
    }
    expect(await getAvailability(id)).toBeNull()
  })
})

describe('asks', () => {
  it('ask, change the note, take it back', async () => {
    const c = klass()
    src.classes = [c]
    let r = await call('POST', { action: 'ask', key: keyOf(c), note: 'I love this one' })
    expect(r).toEqual({ status: 200, body: { data: { key: keyOf(c), asked: true } } })
    let e = (await getEntries([keyOf(c)])).get(keyOf(c))!
    expect(e.asks).toMatchObject([{ staffId: 'TM2', name: 'Jessica', note: 'I love this one' }])
    expect(e.seen).toMatchObject({ startIso: c.sessions[0].startIso, title: 'Needlepoint 101' })
    expect(e.history[0].change).toBe('Jessica asked to work this')
    r = await call('POST', { action: 'unask', key: keyOf(c) })
    expect(r.body.data.asked).toBe(false)
    e = (await getEntries([keyOf(c)])).get(keyOf(c))!
    expect(e.asks).toEqual([])
    expect(src.audit.map((a) => a.action)).toEqual(['staff.ask', 'staff.unask'])
  })

  it('refused on a past event, a cancelled one, one not found, or one they are already on', async () => {
    const past = klass('Old', inDays(0, -3)), cancelled = { ...klass('Gone'), status: 'cancelled' }, mine = klass('Mine')
    src.classes = [past, cancelled, mine]
    await updateEntry(keyOf(cancelled), (e) => withAssigned(e, { staffId: 'TM3', name: 'Sam', by: kaden, at: 'x', notified: null }), 'on', kaden)
    await updateEntry(keyOf(mine), (e) => withAssigned(e, { staffId: 'TM2', name: 'Jessica', by: kaden, at: 'x', notified: null }), 'on', kaden)
    expect(await call('POST', { action: 'ask', key: keyOf(past) })).toEqual({ status: 409, body: { error: 'That one has already happened.' } })
    expect(await call('POST', { action: 'ask', key: keyOf(cancelled) })).toEqual({ status: 409, body: { error: 'That one was cancelled.' } })
    expect((await call('POST', { action: 'ask', key: 'ses:nothing_here' })).status).toBe(404)
    expect((await call('POST', { action: 'ask', key: 'cafe:x' })).status).toBe(400)
    expect(await call('POST', { action: 'ask', key: keyOf(mine) })).toEqual({ status: 409, body: { error: "You're already on this one." } })
    expect((await getEntries([keyOf(past)])).size).toBe(0)
  })

  it('asking on a camp months away works (any date, not only the next ten weeks)', async () => {
    const camp = klass('Winter Camp', inDays(95))
    src.classes = [camp]
    expect((await call('POST', { action: 'ask', key: keyOf(camp) })).status).toBe(200)
    expect((await call('POST', { action: 'unask', key: keyOf(camp) })).status).toBe(200)
  })

  it('a double tap writes one history line', async () => {
    const c = klass()
    src.classes = [c]
    await call('POST', { action: 'ask', key: keyOf(c), note: 'me please' })
    await call('POST', { action: 'ask', key: keyOf(c), note: 'me please' })
    const e = (await getEntries([keyOf(c)])).get(keyOf(c))!
    expect(e.history.filter((h) => h.change === 'Jessica asked to work this')).toHaveLength(1)
  })

  it('a note over 120 characters is refused', async () => {
    const c = klass()
    src.classes = [c]
    expect((await call('POST', { action: 'ask', key: keyOf(c), note: 'x'.repeat(121) })).status).toBe(400)
  })
})

describe('GET', () => {
  it("my shifts and open events, never another person's availability, asks, notes or contact details", async () => {
    const mine = klass('Needlepoint 101'), other = klass('Weaving', inDays(5))
    src.classes = [mine, other]
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', guestCount: 14, status: 'booked', source: 'ours', startIso: inDays(4) })
    src.parties = [{ kind: 'party', id: p, label: 'a party', startIso: inDays(4), endIso: inDays(4, 2), party: { state: 'booked', partyId: p } }]
    await updateEntry(keyOf(mine), (e) => withAssigned(e, { staffId: 'TM2', name: 'Jessica', by: kaden, at: 'x', notified: null }), 'on', kaden)
    await updateEntry(keyOf(mine), (e) => withAssigned(e, { staffId: 'TM1', name: 'Kaden', by: kaden, at: 'x', notified: { email: true, text: true } }), 'on', kaden)
    await updateEntry(keyOf(other), (e) => withAsk(e, { staffId: 'TM3', name: 'Sam', at: 'x', note: 'secret note' }), 'ask', kaden)
    await saveAvailability('TM3', 'Sam', { weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': { kind: 'cant', range: null, note: 'private reason' } }, dates: {} }, kaden, (await getAvailability('TM3'))?.updatedAt ?? null)

    const r = await call('GET')
    expect(r.status).toBe(200)
    const d = r.body.data
    expect(d.me).toEqual({ id: 'TM2', name: 'Jessica' })
    expect(d.feed).toEqual({ has: false })
    expect(d.mine.map((x: any) => x.event.key)).toEqual([keyOf(mine)])
    expect(d.mine[0].entry.assigned.map((a: any) => a.name)).toEqual(['Jessica', 'Kaden'])
    expect(d.mine[0].entry.assigned[1].notified).toBeNull()
    expect(d.open.map((x: any) => x.key)).toEqual([`party:${p}`, keyOf(other)])
    expect(d.open.every((x: any) => x.asked === false)).toBe(true)
    const text = JSON.stringify(r.body)
    expect(text).not.toMatch(/Sam|secret note|private reason|Stefanie|example\.com|\+1256/)
  })

  it('open events say whether someone is still needed (yes or no only, never who), and link to the /staff roster', async () => {
    const full = klass('Full'), empty = klass('Empty', inDays(4))
    src.classes = [full, empty]
    await updateEntry(keyOf(full), (e) => withAssigned(e, { staffId: 'TM3', name: 'Sam', by: kaden, at: 'x', notified: null }), 'on', kaden)
    const d = (await call('GET')).body.data
    const byKey = (k: string) => d.open.find((x: any) => x.key === k)
    expect(byKey(keyOf(full)).needsSomeone).toBe(false)
    expect(byKey(keyOf(empty)).needsSomeone).toBe(true)
    expect(byKey(keyOf(empty)).roster).toEqual({ kind: 'workshop', id: empty.id, day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    expect(JSON.stringify(d.open)).not.toMatch(/Sam/)
  })

  it('an ask on a class that then gets cancelled stays in the list as Cancelled instead of vanishing', async () => {
    const c = klass('Weaving')
    src.classes = [c]
    await call('POST', { action: 'ask', key: keyOf(c) })
    c.status = 'cancelled'
    const d = (await call('GET')).body.data
    expect(d.open).toEqual([expect.objectContaining({ key: keyOf(c), status: 'cancelled', asked: true, needsSomeone: false })])
    // and the ask can still be taken back
    expect((await call('POST', { action: 'unask', key: keyOf(c) })).status).toBe(200)
    expect((await call('GET')).body.data.open).toEqual([])
  })

  it('"With X" never names someone who left the team', async () => {
    const c = klass()
    src.classes = [c]
    src.team.push(person('TM5', 'Morgan'))
    await updateEntry(keyOf(c), (e) => withAssigned(e, { staffId: 'TM2', name: 'Jessica', by: kaden, at: 'x', notified: null }), 'on', kaden)
    await updateEntry(keyOf(c), (e) => withAssigned(e, { staffId: 'TM5', name: 'Morgan', by: kaden, at: 'x', notified: null }), 'on', kaden)
    src.team = src.team.filter((p) => p.id !== 'TM5')
    const d = (await call('GET')).body.data
    expect(d.mine[0].entry.assigned.map((a: any) => a.name)).toEqual(['Jessica'])
  })

  it('refuses a range over ten weeks', async () => {
    const from = new Date().toISOString(), to = inDays(71)
    expect((await call('GET', undefined, `?from=${from}&to=${to}`)).status).toBe(400)
  })
})
