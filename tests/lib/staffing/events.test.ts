import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sources are mocked; the staffing stores are the real fs-backed ones.
const src = vi.hoisted(() => ({
  classes: [] as any[],
  parties: [] as any[],          // Busy entries for partyBusy
  legacy: [] as any[],           // ClassSpan for legacyClassSpans
  records: new Map<string, any>(),
  team: [] as any[],
  teamFails: false,
  classesFail: false,
  partiesFail: false,
  readSquareBookings: true,
  sandbox: false,
}))

vi.mock('@lib/classes/class-store', () => ({
  listClasses: vi.fn(async (range?: { fromIso: string; toIso: string }) => {
    if (src.classesFail) throw new Error('class store down')
    if (!range) return src.classes
    const f = Date.parse(range.fromIso), t = Date.parse(range.toIso)
    return src.classes.filter((c) => c.sessions.some((s: any) => Date.parse(s.startIso) < t && Date.parse(s.endIso) > f))
  }),
}))
vi.mock('@lib/classes/studio-schedule', () => ({
  partyBusy: vi.fn(async (fromIso: string, toIso: string) => {
    if (src.partiesFail) throw new Error('party book down')
    const f = Date.parse(fromIso), t = Date.parse(toIso)
    return src.parties.filter((b) => Date.parse(b.startIso) < t && Date.parse(b.endIso) > f)
  }),
  legacyClassSpans: vi.fn(async (fromIso: string, toIso: string) => {
    const f = Date.parse(fromIso), t = Date.parse(toIso)
    return src.legacy.filter((b) => Date.parse(b.startIso) < t && Date.parse(b.endIso) > f)
  }),
}))
vi.mock('@lib/party-store', () => ({
  getPartyRecord: vi.fn(async (id: string) => src.records.get(id) ?? null),
}))
vi.mock('@lib/staff-directory', () => ({
  teamWithContacts: vi.fn(async () => {
    if (src.teamFails) throw new Error("Couldn't read the team list")
    return { people: src.team, source: 'square' }
  }),
}))
vi.mock('@lib/parties/settings-store', () => ({
  getPartySettings: vi.fn(async () => ({ readSquareBookings: src.readSquareBookings })),
}))
vi.mock('@lib/parties/legacy-square', () => ({
  onSandbox: () => src.sandbox,
}))

import { staffableBetween, staffingRows, orphanEntries, crewView, rowForCrew, eventForCrew, rememberSeen, eventByKey, rowByKey } from '@lib/staffing/events'
import { getEntries, updateEntry } from '@lib/staffing/staffing-store'
import { getPartyRecord } from '@lib/party-store'
import { getAvailability, saveAvailability } from '@lib/staffing/availability-store'

/** Saves over whatever an earlier test left (the store lives for the whole file). */
const setTimes = async (id: string, name: string, weekly: any) =>
  saveAvailability(id, name, { weekly, dates: {} }, { id, name }, (await getAvailability(id))?.updatedAt ?? null)
import { movedSince, withAssigned, withAsk } from '@lib/staffing/rules'

const kaden = { id: 'TM1', name: 'Kaden' }
let n = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const person = (id: string, name: string, role = 'crew') => ({ id, name, givenName: name, role, email: `${name}@example.com`, phone: '+12565550199', active: true })
const on = (staffId: string, name: string) => (e: any) => withAssigned(e, { staffId, name, by: kaden, at: new Date().toISOString(), notified: null })

// Sat Oct 24 2026 (CDT, UTC−5)
const at = (day: number, h: number) => new Date(Date.UTC(2026, 9, day, h + 5)).toISOString()
const FROM = '2026-10-19T05:00:00.000Z'
const TO = '2026-11-02T06:00:00.000Z'

function klass(over: any = {}) {
  const id = over.id ?? uid('cls_')
  return {
    id,
    status: 'open',
    content: { name: 'Needlepoint 101', rules: {} },
    sessions: [{ id: uid('ses_'), startIso: at(24, 10), endIso: at(24, 12), capacity: 12 }],
    ...over,
  }
}
const partyBusy = (id: string, startIso: string, endIso: string, state: 'held' | 'booked' | null = 'booked') =>
  ({ kind: 'party', id, label: 'a party', startIso, endIso, ...(state ? { party: { state, partyId: id } } : {}) })

beforeEach(() => {
  src.classes = []
  src.parties = []
  src.legacy = []
  src.records = new Map()
  src.team = [person('TM1', 'Kaden', 'owner'), person('TM2', 'Jessica'), person('TM3', 'Sam')]
  src.teamFails = false
  src.classesFail = false
  src.partiesFail = false
  src.readSquareBookings = true
  src.sandbox = false
})

describe('lookup by key, any date', () => {
  const now = new Date('2026-10-20T15:00:00.000Z')
  it('our class session months out and a past one are found by the session itself', async () => {
    const far = klass({ sessions: [{ id: uid('ses_'), startIso: at(24, 10).replace('2026-10', '2027-01'), endIso: at(24, 12).replace('2026-10', '2027-01'), capacity: 8 }] })
    const past = klass({ sessions: [{ id: uid('ses_'), startIso: '2026-10-03T15:00:00.000Z', endIso: '2026-10-03T17:00:00.000Z', capacity: 8 }] })
    src.classes = [far, past]
    expect((await eventByKey(`ses:${far.sessions[0].id}`, now))?.event.title).toBe('Needlepoint 101')
    expect((await rowByKey(`ses:${past.sessions[0].id}`, now))?.event.key).toBe(`ses:${past.sessions[0].id}`)
  })
  it('a legacy Square class far away: found with the hint, not without; a garbage hint is ignored', async () => {
    src.legacy = [{ id: 'clssch_x', name: 'Square Weaving', startIso: '2027-02-06T16:00:00.000Z', endIso: '2027-02-06T18:00:00.000Z' }]
    expect(await eventByKey('legacy:clssch_x', now)).toBeNull()
    expect(await eventByKey('legacy:clssch_x', now, 'not a date')).toBeNull()
    const found = await eventByKey('legacy:clssch_x', now, '2027-02-06T16:00:00.000Z')
    expect(found?.event).toMatchObject({ kind: 'legacy-class', title: 'Square Weaving', roster: { kind: 'workshop', id: 'clssch_x', day: '2027-02-06' } })
  })
  it('a nonsense start hint (year 275760, year 1) is ignored: no crash, no ancient read (m1)', async () => {
    src.legacy = [{ id: 'clssch_y', name: 'Square Weaving', startIso: '2027-02-06T16:00:00.000Z', endIso: '2027-02-06T18:00:00.000Z' }]
    await expect(eventByKey('legacy:clssch_y', now, '+275760-09-13T00:00:00Z')).resolves.toBeNull()
    await expect(eventByKey('legacy:clssch_y', now, '0001-01-01T00:00:00Z')).resolves.toBeNull()
  })
})

describe('staffableBetween', () => {
  it('a 3-session class gives 3 events with ses: keys; a draft gives none', async () => {
    const c = klass({
      sessions: [
        { id: uid('ses_'), startIso: at(24, 10), endIso: at(24, 12), capacity: 8 },
        { id: uid('ses_'), startIso: at(25, 10), endIso: at(25, 12), capacity: 8 },
        { id: uid('ses_'), startIso: at(26, 10), endIso: at(26, 12), capacity: 8 },
      ],
    })
    src.classes = [c, klass({ status: 'draft', content: { name: 'Secret', rules: {} } })]
    const evs = await staffableBetween(FROM, TO)
    expect(evs.map((e) => e.key)).toEqual(c.sessions.map((s: any) => `ses:${s.id}`))
    expect(evs[0]).toMatchObject({ kind: 'class', title: 'Needlepoint 101', status: 'on', openHref: `#class-${c.id}`, startIso: at(24, 10), endIso: at(24, 12) })
  })

  it('a closed (sign-ups closed) class is still on', async () => {
    src.classes = [klass({ status: 'closed' })]
    expect((await staffableBetween(FROM, TO))[0].status).toBe('on')
  })

  it('parties: booked and link-held parties with a record; plain checkout holds are not staffable', async () => {
    const booked = uid('pty_'), link = uid('pty_'), paying = uid('pty_')
    src.parties = [
      partyBusy(booked, at(24, 14), at(24, 16)),
      partyBusy(link, at(25, 13), at(25, 15), 'held'),
      partyBusy(paying, at(31, 13), at(31, 15), 'held'),
    ]
    src.records.set(booked, { bookingId: booked, hostName: 'Stefanie Justice', guestCount: 14, status: 'booked', source: 'ours', startIso: at(24, 14) })
    src.records.set(link, { bookingId: link, hostName: 'Ann', guestCount: 8, status: 'booked', source: 'ours', startIso: at(25, 13) })
    const evs = await staffableBetween(FROM, TO)
    expect(evs.map((e) => e.key)).toEqual([`party:${booked}`, `party:${link}`])
    expect(evs[0]).toMatchObject({
      kind: 'party', title: 'Party · 14 guests', status: 'on', openHref: `#party-2026-10-24-${booked}`,
      detail: { guests: 14, hostFirst: 'Stefanie' },
    })
    // the title never carries the host's name
    expect(evs[0].title).not.toMatch(/Stefanie/)
  })

  it('a Square-booked party (no record) is staffable with a plain title', async () => {
    const sq = uid('SQB')
    src.parties = [partyBusy(sq, at(24, 14), at(24, 16), null)]
    const [ev] = await staffableBetween(FROM, TO)
    expect(ev).toMatchObject({ key: `party:${sq}`, title: 'Party', detail: { hostFirst: null } })
  })

  it('a paid (booked) party whose record failed to save is still staffable as plain "Party" (I1)', async () => {
    const paid = uid('pty_'), paying = uid('pty_')
    src.parties = [partyBusy(paid, at(24, 14), at(24, 16), 'booked'), partyBusy(paying, at(25, 14), at(25, 16), 'held')]
    const evs = await staffableBetween(FROM, TO)
    expect(evs.map((e) => e.key)).toEqual([`party:${paid}`])
    expect(evs[0]).toMatchObject({ title: 'Party', status: 'on' })
  })

  it('an id that cannot be a staffing key is left off, not shown unassignable (M2)', async () => {
    src.legacy = [{ id: 'BAD ID/1', name: 'Odd', startIso: at(24, 18), endIso: at(24, 20) }, { id: 'GOOD1', name: 'Fine', startIso: at(24, 18), endIso: at(24, 20) }]
    expect((await staffableBetween(FROM, TO)).map((e) => e.key)).toEqual(['legacy:GOOD1'])
  })

  it('cancelled parties are found from the party index near the range only (I4)', async () => {
    const near = uid('pty_'), far = uid('pty_')
    src.records.set(near, { bookingId: near, hostName: 'A', guestCount: 4, status: 'cancelled', source: 'ours', startIso: at(30, 13), endIso: at(30, 15) })
    src.records.set(far, { bookingId: far, hostName: 'B', guestCount: 4, status: 'cancelled', source: 'ours', startIso: '2027-06-05T18:00:00.000Z', endIso: '2027-06-05T20:00:00.000Z' })
    await updateEntry(`party:${near}`, on('TM2', 'Jessica'), 'on', kaden, undefined, { event: { startIso: at(30, 13), endIso: at(30, 15), title: 'Party' } })
    await updateEntry(`party:${far}`, on('TM2', 'Jessica'), 'on', kaden, undefined, { event: { startIso: '2027-06-05T18:00:00.000Z', endIso: '2027-06-05T20:00:00.000Z', title: 'Party' } })
    vi.mocked(getPartyRecord).mockClear()
    const evs = await staffableBetween(FROM, TO)
    expect(evs.find((e) => e.key === `party:${near}`)?.status).toBe('cancelled')
    const read = vi.mocked(getPartyRecord).mock.calls.map((c) => c[0])
    expect(read).toContain(near)
    expect(read).not.toContain(far)
  })

  it('legacy Square classes are staffable', async () => {
    src.legacy = [{ id: 'SCHED1', name: 'Pottery', startIso: at(24, 18), endIso: at(24, 20) }]
    const [ev] = await staffableBetween(FROM, TO)
    expect(ev).toMatchObject({ key: 'legacy:SCHED1', kind: 'legacy-class', title: 'Pottery', status: 'on', openHref: '#legacy-2026-10-24-SCHED1' })
  })

  it('a cancelled class shows only when someone is on it or asked', async () => {
    const c = klass({ status: 'cancelled' })
    const quiet = klass({ status: 'cancelled', content: { name: 'Quiet', rules: {} } })
    src.classes = [c, quiet]
    expect(await staffableBetween(FROM, TO)).toEqual([])
    await updateEntry(`ses:${c.sessions[0].id}`, on('TM2', 'Jessica'), 'on', kaden)
    const evs = await staffableBetween(FROM, TO)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ key: `ses:${c.sessions[0].id}`, status: 'cancelled' })
  })

  it('a cancelled party with someone on it shows as cancelled', async () => {
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Ann B', guestCount: 9, status: 'cancelled', source: 'ours', startIso: at(30, 13), endIso: at(30, 15), durationMinutes: 120 })
    // assigned while it was still on (the route passes the event, which feeds the party index)
    await updateEntry(`party:${p}`, on('TM2', 'Jessica'), 'on', kaden, undefined, { event: { startIso: at(30, 13), endIso: at(30, 15), title: 'Party' } })
    const evs = await staffableBetween(FROM, TO)
    expect(evs.find((e) => e.key === `party:${p}`)).toMatchObject({ status: 'cancelled', title: 'Party · 9 guests', startIso: at(30, 13), endIso: at(30, 15) })
    // outside the range: not listed
    expect((await staffableBetween(at(31, 0), TO)).find((e) => e.key === `party:${p}`)).toBeUndefined()
  })

  it('a store read failure throws (never an empty list)', async () => {
    src.classesFail = true
    await expect(staffableBetween(FROM, TO)).rejects.toThrow()
    src.classesFail = false
    src.partiesFail = true
    await expect(staffableBetween(FROM, TO)).rejects.toThrow()
  })
})

describe('staffingRows', () => {
  it('people lists every active team member with verdict, asked and assigned; never a fallback id', async () => {
    const c = klass()
    src.classes = [c]
    const key = `ses:${c.sessions[0].id}` as const
    await updateEntry(key, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(key, (e) => withAsk(e, { staffId: 'TM3', name: 'Sam', at: new Date().toISOString(), note: 'pick me' }), 'ask', { id: 'TM3', name: 'Sam' })
    await setTimes('TM3', 'Sam', { '6': { kind: 'cant', range: null, note: '' } })
    const [row] = await staffingRows(FROM, TO)
    expect(row.state).toBe('staffed')
    expect(row.needed).toBe(1)
    // assigned first, then asked, then by name (M5)
    expect(row.people).toEqual([
      { staffId: 'TM2', name: 'Jessica', verdict: 'unknown', asked: false, assigned: true, askNote: '', markNote: '', hours: '' },
      { staffId: 'TM3', name: 'Sam', verdict: 'cant', asked: true, assigned: false, askNote: 'pick me', markNote: '', hours: '' },
      { staffId: 'TM1', name: 'Kaden', verdict: 'unknown', asked: false, assigned: false, askNote: '', markNote: '', hours: '' },
    ])
    for (const p of row.people) expect(['kaden', 'catherine']).not.toContain(p.staffId)
    // contact details never ride along
    expect(JSON.stringify(row)).not.toMatch(/example\.com|\+1256/)
  })

  it('an event nobody touched has no entry, state none, needed 1', async () => {
    src.classes = [klass()]
    const [row] = await staffingRows(FROM, TO)
    expect(row).toMatchObject({ entry: null, state: 'none', needed: 1, leftTeam: [] })
  })

  it('someone who left the team no longer counts, and is named in leftTeam', async () => {
    const c = klass()
    src.classes = [c]
    await updateEntry(`ses:${c.sessions[0].id}`, on('TM9', 'Morgan'), 'on', kaden)
    const [row] = await staffingRows(FROM, TO)
    expect(row.state).toBe('none')
    expect(row.leftTeam).toEqual([{ staffId: 'TM9', name: 'Morgan' }])
    expect(row.people.map((p) => p.staffId)).not.toContain('TM9')
  })

  it('moved keeps staff: a session moved to another day keeps its key, its people, and movedSince turns true', async () => {
    const c = klass()
    src.classes = [c]
    const key = `ses:${c.sessions[0].id}` as const
    await updateEntry(key, (e) => ({ ...on('TM2', 'Jessica')(e), seen: { startIso: c.sessions[0].startIso, endIso: c.sessions[0].endIso, title: 'Needlepoint 101' } }), 'on', kaden)
    c.sessions[0] = { ...c.sessions[0], startIso: at(25, 13), endIso: at(25, 15) }
    const [row] = await staffingRows(FROM, TO)
    expect(row.event.key).toBe(key)
    expect(row.event.startIso).toBe(at(25, 13))
    expect(row.people.find((p) => p.staffId === 'TM2')!.assigned).toBe(true)
    expect(movedSince(row.entry!, row.event)).toBe(true)
  })

  it('a party moved from October to November keeps its party: key', async () => {
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Ann', guestCount: 8, status: 'booked', source: 'ours', startIso: at(31, 13) })
    src.parties = [partyBusy(p, at(31, 13), at(31, 15))]
    await updateEntry(`party:${p}`, on('TM2', 'Jessica'), 'on', kaden)
    src.parties = [partyBusy(p, '2026-11-07T19:00:00.000Z', '2026-11-07T21:00:00.000Z')]
    const rows = await staffingRows(FROM, '2026-11-15T06:00:00.000Z')
    expect(rows.map((r) => r.event.key)).toEqual([`party:${p}`])
    expect(rows[0].state).toBe('staffed')
  })

  it('onlyStaffId: only events they are on or asked for; people and entry carry only them (plus who else is on)', async () => {
    const mine = klass(), asked = klass({ content: { name: 'Weaving', rules: {} } }), other = klass({ content: { name: 'Other', rules: {} } })
    src.classes = [mine, asked, other]
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie J', guestCount: 14, status: 'booked', source: 'ours', startIso: at(24, 14) })
    src.parties = [partyBusy(p, at(24, 14), at(24, 16))]
    await updateEntry(`ses:${mine.sessions[0].id}`, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(`ses:${mine.sessions[0].id}`, on('TM1', 'Kaden'), 'on', kaden)
    await updateEntry(`ses:${mine.sessions[0].id}`, (e) => withAsk(e, { staffId: 'TM3', name: 'Sam', at: 'x', note: 'secret note' }), 'ask', kaden)
    await updateEntry(`ses:${asked.sessions[0].id}`, (e) => withAsk(e, { staffId: 'TM2', name: 'Jessica', at: 'x', note: 'me please' }), 'ask', kaden)
    await updateEntry(`ses:${other.sessions[0].id}`, on('TM3', 'Sam'), 'on', kaden)
    await updateEntry(`party:${p}`, on('TM2', 'Jessica'), 'on', kaden)
    await setTimes('TM3', 'Sam', { '6': { kind: 'cant', range: null, note: 'private' } })

    const rows = await staffingRows(FROM, TO, { onlyStaffId: 'TM2' })
    expect(rows.map((r) => r.event.key).sort()).toEqual([`ses:${mine.sessions[0].id}`, `ses:${asked.sessions[0].id}`, `party:${p}`].sort())
    for (const r of rows) {
      expect(r.people.map((x) => x.staffId)).toEqual(['TM2'])
      expect(r.entry?.asks.every((a) => a.staffId === 'TM2')).toBe(true)
      expect(r.entry?.history).toEqual([])
      expect(r.event.detail.hostFirst).toBeUndefined()
    }
    const mineRow = rows.find((r) => r.event.key === `ses:${mine.sessions[0].id}`)!
    expect(mineRow.entry!.assigned.map((a) => a.name)).toEqual(['Jessica', 'Kaden']) // "With Kaden"
    const body = JSON.stringify(rows)
    expect(body).not.toMatch(/secret note|private|Stefanie|Sam/)
  })

  it('owners see the note on a "can\'t" and the note on an ask (M5)', async () => {
    const c = klass()
    src.classes = [c]
    await updateEntry(`ses:${c.sessions[0].id}`, (e) => withAsk(e, { staffId: 'TM2', name: 'Jessica', at: 'x', note: 'I love this one' }), 'ask', kaden)
    await setTimes('TM3', 'Sam', { '6': { kind: 'cant', range: { from: '09:00', to: '13:00' }, note: 'dentist' } })
    const [row] = await staffingRows(FROM, TO)
    expect(row.people.find((p) => p.staffId === 'TM2')).toMatchObject({ asked: true, askNote: 'I love this one' })
    expect(row.people.find((p) => p.staffId === 'TM3')).toMatchObject({ verdict: 'cant', markNote: 'dentist' })
    expect(row.people.map((p) => p.staffId)).toEqual(['TM2', 'TM1', 'TM3']) // asked, then by name
  })

  it('"Can, only 4–9 PM" on Saturdays and a 10 AM class: owners get outside + the hours, not Not said (I7)', async () => {
    src.classes = [klass()]
    await setTimes('TM3', 'Sam', { '6': { kind: 'can', range: { from: '16:00', to: '21:00' }, note: '' } })
    const [row] = await staffingRows(FROM, TO)
    expect(row.people.find((p) => p.staffId === 'TM3')).toMatchObject({ verdict: 'outside', hours: '4–9 PM', markNote: '' })
    expect(row.people.find((p) => p.staffId === 'TM1')).toMatchObject({ verdict: 'unknown', hours: '' })
  })

  it('throws when the team cannot be read (never "nobody\'s available")', async () => {
    src.classes = [klass()]
    src.teamFails = true
    await expect(staffingRows(FROM, TO)).rejects.toThrow()
  })
})

describe('orphanEntries', () => {
  const now = new Date('2026-10-20T15:00:00.000Z')

  it('a cancelled class with someone on it is cancelled; a deleted session is gone', async () => {
    const c = klass({ status: 'cancelled' })
    const d = klass()
    src.classes = [c, d]
    await updateEntry(`ses:${c.sessions[0].id}`, on('TM2', 'Jessica'), 'on', kaden)
    const deleted = uid('ses_')
    await updateEntry(`ses:${deleted}`, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(`ses:${d.sessions[0].id}`, on('TM3', 'Sam'), 'on', kaden)
    const out = await orphanEntries(now)
    const by = new Map(out.map((o) => [o.key, o.status]))
    expect(by.get(`ses:${c.sessions[0].id}`)).toBe('cancelled')
    expect(by.get(`ses:${deleted}`)).toBe('gone')
    expect(by.has(`ses:${d.sessions[0].id}`)).toBe(false)
  })

  it('parties: cancelled record → cancelled; deleted record → gone; asks alone are not orphans', async () => {
    const cancelled = uid('pty_'), deleted = uid('pty_'), askedOnly = uid('pty_')
    src.records.set(cancelled, { bookingId: cancelled, hostName: 'A', guestCount: 5, status: 'cancelled', source: 'ours', startIso: at(30, 13), endIso: at(30, 15) })
    await updateEntry(`party:${cancelled}`, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(`party:${deleted}`, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(`party:${askedOnly}`, (e) => withAsk(e, { staffId: 'TM2', name: 'Jessica', at: 'x', note: '' }), 'ask', kaden)
    const by = new Map((await orphanEntries(now)).map((o) => [o.key, o.status]))
    expect(by.get(`party:${cancelled}`)).toBe('cancelled')
    expect(by.get(`party:${deleted}`)).toBe('gone')
    expect(by.has(`party:${askedOnly}`)).toBe(false)
  })

  it('a long-past event is left alone', async () => {
    const old = uid('ses_')
    await updateEntry(`ses:${old}`, (e) => ({ ...on('TM2', 'Jessica')(e), seen: { startIso: '2026-08-01T15:00:00.000Z', endIso: '2026-08-01T17:00:00.000Z', title: 'x' } }), 'on', kaden)
    const by = new Map((await orphanEntries(now)).map((o) => [o.key, o.status]))
    expect(by.has(`ses:${old}`)).toBe(false)
  })

  it('Square-booked parties and legacy classes are only called gone when Square was really read and they were still to come', async () => {
    const sq = uid('SQB'), sched = uid('SCHED')
    const future = { startIso: at(31, 13), endIso: at(31, 15), title: 'x' }
    await updateEntry(`party:${sq}`, (e) => ({ ...on('TM2', 'Jessica')(e), seen: future }), 'on', kaden)
    await updateEntry(`legacy:${sched}`, (e) => ({ ...on('TM2', 'Jessica')(e), seen: future }), 'on', kaden)
    src.readSquareBookings = false
    let by = new Map((await orphanEntries(now)).map((o) => [o.key, o.status]))
    expect(by.has(`party:${sq}`)).toBe(false)
    expect(by.get(`legacy:${sched}`)).toBe('gone')
    src.readSquareBookings = true
    by = new Map((await orphanEntries(now)).map((o) => [o.key, o.status]))
    expect(by.get(`party:${sq}`)).toBe('gone')
    src.sandbox = true
    by = new Map((await orphanEntries(now)).map((o) => [o.key, o.status]))
    expect(by.has(`party:${sq}`)).toBe(false)
  })
})

describe('crew view (M4: one place strips what crew may not see)', () => {
  it('eventForCrew drops the host name; rowForCrew keeps only that person', async () => {
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie Justice', guestCount: 14, status: 'booked', source: 'ours', startIso: at(24, 14) })
    src.parties = [partyBusy(p, at(24, 14), at(24, 16))]
    await updateEntry(`party:${p}`, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(`party:${p}`, (e) => withAsk(e, { staffId: 'TM3', name: 'Sam', at: 'x', note: 'secret' }), 'ask', kaden)
    const [row] = await staffingRows(FROM, TO)
    expect(row.event.detail.hostFirst).toBe('Stefanie')
    expect(eventForCrew(row.event).detail).toEqual({ guests: 14 })
    const crew = rowForCrew(row, 'TM2')
    expect(crew.people.map((x) => x.staffId)).toEqual(['TM2'])
    expect(crew.leftTeam).toEqual([])
    expect(JSON.stringify(crew)).not.toMatch(/Stefanie|secret|Sam/)
  })

  it('crewView: mine = what they are on; open = upcoming events not theirs, with their own ask only', async () => {
    const mine = klass(), other = klass({ content: { name: 'Weaving', rules: {} } }), past = klass({ content: { name: 'Old', rules: {} }, sessions: [{ id: uid('ses_'), startIso: at(20, 10), endIso: at(20, 12), capacity: 5 }] })
    src.classes = [mine, other, past]
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie Justice', guestCount: 14, status: 'booked', source: 'ours', startIso: at(25, 14) })
    src.parties = [partyBusy(p, at(25, 14), at(25, 16))]
    await updateEntry(`ses:${mine.sessions[0].id}`, on('TM2', 'Jessica'), 'on', kaden)
    await updateEntry(`ses:${mine.sessions[0].id}`, on('TM3', 'Sam'), 'on', kaden)
    await updateEntry(`ses:${other.sessions[0].id}`, (e) => withAsk(e, { staffId: 'TM2', name: 'Jessica', at: 'x', note: 'me please' }), 'ask', kaden)
    await updateEntry(`ses:${other.sessions[0].id}`, (e) => withAsk(e, { staffId: 'TM3', name: 'Sam', at: 'x', note: 'private' }), 'ask', kaden)
    const now = new Date(at(22, 9))
    const v = await crewView(FROM, TO, 'TM2', now)
    expect(v.mine.map((r) => r.event.key)).toEqual([`ses:${mine.sessions[0].id}`])
    expect(v.mine[0].entry!.assigned.map((a) => a.name)).toEqual(['Jessica', 'Sam']) // "With Sam"
    expect(v.open.map((e) => e.key)).toEqual([`ses:${other.sessions[0].id}`, `party:${p}`])
    expect(v.open[0]).toMatchObject({ asked: true, askNote: 'me please' })
    expect(v.open[1]).toMatchObject({ asked: false, title: 'Party · 14 guests' })
    expect(JSON.stringify(v)).not.toMatch(/Stefanie|private|example\.com/)
  })
})

describe('rememberSeen', () => {
  it('writes seen only for entries that exist and differ; SEQUENCE follows a move', async () => {
    const c = klass(), quiet = klass({ content: { name: 'Nobody', rules: {} } })
    src.classes = [c, quiet]
    const key = `ses:${c.sessions[0].id}` as const
    const a = await updateEntry(key, on('TM2', 'Jessica'), 'on', kaden)
    let rows = await staffingRows(FROM, TO)
    await rememberSeen(rows)
    expect(rows.find((r) => r.event.key === key)!.entry!.seen!.startIso).toBe(c.sessions[0].startIso)
    expect((await getEntries([`ses:${quiet.sessions[0].id}`])).size).toBe(0) // no record made
    c.sessions[0] = { ...c.sessions[0], startIso: at(24, 11), endIso: at(24, 13) }
    rows = await staffingRows(FROM, TO)
    await rememberSeen(rows)
    const e = (await getEntries([key])).get(key)!
    expect(e.sequence).toBe(1)
    expect(e.updatedAt).toBe(a.updatedAt)
  })
})

describe('orphanEntries: an entry never seen and long untouched is left alone (M7)', () => {
  it('uses updatedAt when there is no seen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const oldKey = `ses:${uid('ses_')}` as const
    try {
      vi.setSystemTime(new Date('2026-08-01T15:00:00.000Z'))
      await updateEntry(oldKey, on('TM2', 'Jessica'), 'on', kaden)
    } finally {
      vi.useRealTimers()
    }
    const freshKey = `ses:${uid('ses_')}` as const
    await updateEntry(freshKey, on('TM2', 'Jessica'), 'on', kaden)
    const by = new Map((await orphanEntries(new Date())).map((o) => [o.key, o.status]))
    expect(by.has(oldKey)).toBe(false)
    expect(by.get(freshKey)).toBe('gone')
  })
})
