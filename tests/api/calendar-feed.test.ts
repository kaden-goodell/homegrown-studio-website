// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Schedule sources and the team are mocked; the staffing and calendar-link stores are the real fs-backed ones.
const src = vi.hoisted(() => ({
  classes: [] as any[],
  parties: [] as any[],
  blocked: [] as any[],
  records: new Map<string, any>(),
  team: [] as any[],
  scheduleFails: false,
  audit: [] as any[],
}))

vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async (e: any) => { src.audit.push(e) }) }))
vi.mock('@lib/classes/class-store', () => ({
  listClasses: vi.fn(async (range?: { fromIso: string; toIso: string }) => {
    if (src.scheduleFails) throw new Error('class store down')
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
  blockedAndClosedBusy: vi.fn(async () => src.blocked),
}))
vi.mock('@lib/party-store', () => ({ getPartyRecord: vi.fn(async (id: string) => src.records.get(id) ?? null) }))
vi.mock('@lib/staff-directory', () => ({
  teamWithContacts: vi.fn(async () => ({ people: src.team, source: 'square' })),
  isActiveStaffId: vi.fn(async (id: string) => src.team.some((p) => p.id === id && p.active)),
  staffIdForOwner: vi.fn(async (owner: string) => src.team.find((p) => p.role === 'owner' && p.givenName === owner)?.id ?? null),
}))

import * as feedRoute from '@pages/api/calendar/feed/[token].ics'
import * as staffFeed from '@pages/api/staff/feed.json'
import * as adminFeed from '@pages/api/admin/feed.json'
import { adminCookie } from '@lib/admin-auth'
import { staffCookie } from '@lib/staff-auth'
import { makeFeed, revokeFeed } from '@lib/staffing/feed-store'
import { updateEntry } from '@lib/staffing/staffing-store'
import { withAssigned } from '@lib/staffing/rules'
import { parseIcs } from '../lib/staffing/ics-parse'

let n = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const person = (id: string, name: string, role = 'crew') => ({ id, name, givenName: name, role, email: `${name.toLowerCase()}@example.com`, phone: '+12565550199', active: true })
const DAY = 86_400_000
const inDays = (d: number, h = 0) => new Date(Date.now() + d * DAY + h * 3_600_000).toISOString()
function klass(name: string, start = inDays(3)) {
  return { id: uid('cls_'), status: 'open', content: { name, rules: {} }, sessions: [{ id: uid('ses_'), startIso: start, endIso: new Date(Date.parse(start) + 2 * 3_600_000).toISOString(), capacity: 12 }] }
}
const keyOf = (c: any) => `ses:${c.sessions[0].id}` as const
const by = { id: 'owner-kaden', name: 'Kaden' }
const put = (key: any, staffId: string, name: string) => updateEntry(key, (e) => withAssigned(e, { staffId, name, by, at: 'x', notified: null }), 'on', by)

let ip = 0
async function fetchFeed(token: string, query = '', clientAddress = `10.0.0.${++ip % 250}`) {
  const request = new Request(`https://x.test/api/calendar/feed/${token}.ics${query}`)
  const res: Response = await (feedRoute as any).GET({ params: { token }, request, url: new URL(request.url), clientAddress })
  return { status: res.status, headers: res.headers, body: await res.text() }
}

beforeEach(() => {
  vi.stubEnv('ADMIN_PASSCODE', 'owner-secret')
  vi.stubEnv('STAFF_PASSCODE', 'crew-secret')
  src.classes = []
  src.parties = []
  src.blocked = []
  src.records = new Map()
  src.team = [person('TM1', 'Kaden', 'owner'), person('TM4', 'Catherine', 'owner'), person('TM2', 'Jessica'), person('TM3', 'Sam')]
  src.scheduleFails = false
  src.audit = []
})

describe('token refusals', () => {
  it('garbage, wrong, replaced, stopped and a departed person all get the identical 404', async () => {
    const first = await makeFeed({ staffId: 'TM3' }, by)
    await makeFeed({ staffId: 'TM3' }, by) // replaces the first
    const stopped = await makeFeed({ owner: 'Catherine' }, by)
    await revokeFeed({ owner: 'Catherine' }, by)
    const departed = await makeFeed({ staffId: 'TM2' }, by)
    src.team = src.team.filter((p) => p.id !== 'TM2')
    const answers = await Promise.all([
      fetchFeed('garbage'), fetchFeed('A'.repeat(43)), fetchFeed('../../etc/passwd'),
      fetchFeed(first.token), fetchFeed(stopped.token), fetchFeed(departed.token),
    ])
    for (const a of answers) {
      expect(a.status).toBe(404)
      expect(a.body).toBe('Not found')
      expect(a.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    }
  })
})

describe('scope from the record', () => {
  it('a crew link shows only their shifts, whatever the query string says', async () => {
    const mine = klass('Needlepoint 101'), other = klass('Weaving', inDays(4))
    src.classes = [mine, other]
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '2565551234', guestCount: 14, status: 'booked', source: 'ours', startIso: inDays(5) })
    src.parties = [{ kind: 'party', id: p, label: 'a party', startIso: inDays(5), endIso: inDays(5, 2), party: { state: 'booked', partyId: p } }]
    await put(keyOf(mine), 'TM2', 'Jessica')
    await put(keyOf(mine), 'TM4', 'Catherine')
    await put(keyOf(other), 'TM3', 'Sam')
    await put(`party:${p}`, 'TM2', 'Jessica')
    const { token } = await makeFeed({ staffId: 'TM2' }, by)
    const r = await fetchFeed(token, '?all=1&staff=TM3&scope=all')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(r.headers.get('cache-control')).toBe('private, max-age=300')
    const { cal, events } = parseIcs(r.body)
    expect(cal['X-WR-CALNAME']).toBe('Hometown Studio · my shifts')
    expect(events.map((e) => e.UID).sort()).toEqual([`${keyOf(mine)}@ourhometownstudio.com`, `party:${p}@ourhometownstudio.com`].sort())
    const klassEv = events.find((e) => e.UID.startsWith('ses:'))!
    expect(klassEv).toMatchObject({ SUMMARY: 'Needlepoint 101', DESCRIPTION: 'With Catherine.' })
    const partyEv = events.find((e) => e.UID.startsWith('party:'))!
    expect(partyEv).toMatchObject({ SUMMARY: 'Party · 14 guests', DESCRIPTION: 'Just you on this one. Be there 30 minutes before it starts.' })
    expect(r.body).not.toMatch(/Weaving|Sam|Stefanie|stef@|2565551234|example\.com|\+1256/)
  })

  it('an owner link shows everything: ⚠ when someone is needed, You\'re on, the host first name, seats, blocked time and closed days', async () => {
    const staffed = klass('Needlepoint 101'), empty = klass('Weaving', inDays(4))
    src.classes = [staffed, empty]
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', hostPhone: '2565551234', guestCount: 14, status: 'booked', source: 'ours', startIso: inDays(5) })
    src.parties = [{ kind: 'party', id: p, label: 'a party', startIso: inDays(5), endIso: inDays(5, 2), party: { state: 'booked', partyId: p } }]
    src.blocked = [
      { kind: 'blocked', id: 'blk_1', label: 'Floor refinishing', startIso: inDays(6), endIso: inDays(6, 3) },
      { kind: 'closed', id: 'closed-2026-12-25', label: 'Closed for Christmas', startIso: '2026-12-25T06:00:00.000Z', endIso: '2026-12-26T06:00:00.000Z' },
    ]
    await put(keyOf(staffed), 'TM4', 'Catherine')
    await put(keyOf(staffed), 'TM2', 'Jessica')
    const { token } = await makeFeed({ owner: 'Catherine' }, by)
    const r = await fetchFeed(token)
    const { cal, events } = parseIcs(r.body)
    expect(cal['X-WR-CALNAME']).toBe('Hometown Studio')
    const s = (uidPrefix: string) => events.find((e) => e.UID.startsWith(uidPrefix))!
    expect(s(keyOf(staffed))).toMatchObject({ SUMMARY: "You're on · Needlepoint 101", DESCRIPTION: 'Catherine and Jessica are on. 0 of 12 seats taken.' })
    expect(s(keyOf(empty))).toMatchObject({ SUMMARY: '⚠ Weaving', DESCRIPTION: 'Nobody on yet. 0 of 12 seats taken.' })
    expect(s(`party:${p}`).SUMMARY).toBe('⚠ Party · Stefanie · 14 guests')
    expect(s('blocked-blk_1').SUMMARY).toBe('Blocked · Floor refinishing')
    expect(s('closed-2026-12-25')['DTSTART;VALUE=DATE']).toBe('20261225')
    expect(r.body).not.toMatch(/Justice|stef@|2565551234|example\.com|\+1256/)
  })
})

describe('moves and cancellations', () => {
  it('a moved class keeps its UID and its SEQUENCE goes up; a cancelled one says CANCELLED', async () => {
    const c = klass('Needlepoint 101')
    src.classes = [c]
    await put(keyOf(c), 'TM2', 'Jessica')
    const { token } = await makeFeed({ staffId: 'TM2' }, by)
    let ev = parseIcs((await fetchFeed(token)).body).events[0]
    expect(ev.SEQUENCE).toBe('0')
    c.sessions[0] = { ...c.sessions[0], startIso: inDays(3, 1), endIso: inDays(3, 3) }
    ev = parseIcs((await fetchFeed(token)).body).events[0]
    expect(ev.UID).toBe(`${keyOf(c)}@ourhometownstudio.com`)
    expect(ev.SEQUENCE).toBe('1')
    // read again without a move: no further bump
    expect(parseIcs((await fetchFeed(token)).body).events[0].SEQUENCE).toBe('1')
    c.status = 'cancelled'
    ev = parseIcs((await fetchFeed(token)).body).events[0]
    expect(ev).toMatchObject({ STATUS: 'CANCELLED', SUMMARY: 'Cancelled · Needlepoint 101' })
    expect(ev.DESCRIPTION.startsWith('This was cancelled.')).toBe(true)
  })
})

describe('failures and limits', () => {
  it('503 when the schedule cannot be read (a phone keeps its last copy)', async () => {
    const { token } = await makeFeed({ staffId: 'TM3' }, by)
    src.scheduleFails = true
    const r = await fetchFeed(token)
    expect(r.status).toBe(503)
  })

  it('60 a minute from one address, then 429', async () => {
    const { token } = await makeFeed({ staffId: 'TM3' }, by)
    const address = `192.168.9.${Date.now() % 200}`
    for (let i = 0; i < 60; i++) expect((await fetchFeed(token, '', address)).status).toBe(200)
    expect((await fetchFeed(token, '', address)).status).toBe(429)
  })
})

describe('making and stopping links', () => {
  const staffReq = (method: string, me: any) => new Request('https://kaden-own-booking-system--site.netlify.app/api/staff/feed.json', { method, headers: { cookie: staffCookie(me).split(';')[0] } })
  const adminReq = (method: string, body?: unknown, who = 'Catherine') => new Request('https://x.test/api/admin/feed.json', {
    method, headers: { 'Content-Type': 'application/json', cookie: adminCookie().split(';')[0], ...(who ? { 'X-Admin-Who': who } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const callRoute = async (mod: any, method: string, request: Request) => {
    const res: Response = await mod[method]({ request, url: new URL(request.url) })
    return { status: res.status, body: await res.json() }
  }
  const tokenOf = (url: string) => url.split('/').pop()!.replace('.ics', '')

  it('crew make a link (shown once, https and webcal), a new one stops the old, DELETE stops it', async () => {
    const me = { id: 'TM2', name: 'Jessica', role: 'crew' }
    const a = await callRoute(staffFeed, 'POST', staffReq('POST', me))
    expect(a.status).toBe(200)
    expect(a.body.data.https).toMatch(/^https:\/\/kaden-own-booking-system--site\.netlify\.app\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/)
    expect(a.body.data.webcal).toBe(a.body.data.https.replace('https://', 'webcal://'))
    const b = await callRoute(staffFeed, 'POST', staffReq('POST', me))
    expect((await fetchFeed(tokenOf(a.body.data.https))).status).toBe(404)
    expect((await fetchFeed(tokenOf(b.body.data.https))).status).toBe(200)
    await callRoute(staffFeed, 'DELETE', staffReq('DELETE', me))
    expect((await fetchFeed(tokenOf(b.body.data.https))).status).toBe(404)
    expect(src.audit.map((x) => x.action)).toEqual(['feed.make', 'feed.make', 'feed.revoke'])
    // a fallback id can't make one
    expect((await callRoute(staffFeed, 'POST', staffReq('POST', { id: 'kaden', name: 'Kaden', role: 'owner' }))).status).toBe(403)
  })

  it('owners: their own whole-studio link; stop a team member\'s link; who has one', async () => {
    const mine = await callRoute(adminFeed, 'POST', adminReq('POST'))
    expect(mine.status).toBe(200)
    expect((await callRoute(adminFeed, 'POST', adminReq('POST', undefined, ''))).body.error).toBe('Choose who you are at the top of /admin first.')
    const crew = await makeFeed({ staffId: 'TM3' }, by)
    let list = await callRoute(adminFeed, 'GET', adminReq('GET'))
    expect(list.body.data.mine.has).toBe(true)
    expect(list.body.data.people.find((p: any) => p.staffId === 'TM3')).toMatchObject({ name: 'Sam', has: true })
    await callRoute(adminFeed, 'DELETE', adminReq('DELETE', { staffId: 'TM3' }))
    expect((await fetchFeed(crew.token)).status).toBe(404)
    list = await callRoute(adminFeed, 'GET', adminReq('GET'))
    expect(list.body.data.people.find((p: any) => p.staffId === 'TM3').has).toBe(false)
    expect(JSON.stringify(list.body)).not.toMatch(/[A-Za-z0-9_-]{43}|example\.com/)
  })
})
