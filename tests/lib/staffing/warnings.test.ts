import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sources are mocked; the staffing stores are the real fs-backed ones.
const src = vi.hoisted(() => ({
  classes: [] as any[],
  parties: [] as any[],
  records: new Map<string, any>(),
  team: [] as any[],
  teamFails: false,
}))

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
  teamWithContacts: vi.fn(async () => {
    if (src.teamFails) throw new Error("Couldn't read the team list")
    return { people: src.team, source: 'square' }
  }),
}))
vi.mock('@lib/parties/settings-store', () => ({ getPartySettings: vi.fn(async () => ({ readSquareBookings: true })) }))
vi.mock('@lib/parties/legacy-square', () => ({ onSandbox: () => false }))

import { staffingWarnings, STAFFING_UNREADABLE } from '@lib/staffing/warnings'
import { updateEntry } from '@lib/staffing/staffing-store'
import { getAvailability, saveAvailability } from '@lib/staffing/availability-store'
import { withAssigned } from '@lib/staffing/rules'
import { localToUtcISO } from '@lib/party-slots'
import { warningLine, OWNER_ONLY_CODES, UNDATED_CODES } from '@lib/warnings'

let n = 0
const uid = (p: string) => `${p}${Date.now().toString(36)}${n++}`
const person = (id: string, name: string, role = 'crew') => ({ id, name, givenName: name, role, email: null, phone: null, active: true })
const kaden = { id: 'TM1', name: 'Kaden' }
const put = (key: any, staffId: string, name: string) => updateEntry(key, (e) => withAssigned(e, { staffId, name, by: kaden, at: 'x', notified: null }), 'on', kaden)

// Today is Thu Nov 5 2026 (CST) at 9 AM; the 14-day horizon runs to the end of Wed Nov 18.
const FROM = '2026-11-05', TO = '2027-01-03'
const NOW = new Date(localToUtcISO('2026-11-05', '09:00'))
function klass(name: string, day: string, from = '10:00', to = '12:00', status = 'open') {
  return { id: uid('cls_'), status, content: { name, rules: {} }, sessions: [{ id: uid('ses_'), startIso: localToUtcISO(day, from), endIso: localToUtcISO(day, to), capacity: 12 }] }
}
const keyOf = (c: any) => `ses:${c.sessions[0].id}` as const
const codes = (ws: any[]) => ws.map((w) => `${w.code} ${w.title}`)

beforeEach(() => {
  src.classes = []
  src.parties = []
  src.records = new Map()
  src.team = [person('TM1', 'Kaden', 'owner'), person('TM2', 'Jessica'), person('TM3', 'Sam')]
  src.teamFails = false
})

describe('unstaffed', () => {
  it('fires inside the 14 studio days and not after (Chicago days)', async () => {
    const lastIn = klass('Last In', '2026-11-18', '22:00', '23:30')
    const firstOut = klass('First Out', '2026-11-19', '00:30', '02:00')
    const later = klass('Later', '2026-12-01')
    src.classes = [lastIn, firstOut, later]
    const ws = await staffingWarnings(FROM, TO, NOW)
    expect(codes(ws)).toEqual(['unstaffed Last In'])
    expect(warningLine(ws[0])).toBe('Wed Nov 18 · Last In at 10 PM has no one on yet. Assign someone in /admin › More › Staff.')
    expect(ws[0]).toMatchObject({ eventKind: 'workshop', eventId: lastIn.id })
  })

  it('needed 0 never fires; staffed never fires; 1 of 2 says so; past and cancelled are left alone', async () => {
    const none = klass('Kaden Alone', '2026-11-07'), staffed = klass('Staffed', '2026-11-07', '13:00', '15:00')
    const two = klass('Needs Two', '2026-11-08'), past = klass('This Morning', '2026-11-05', '07:00', '08:30')
    const cancelled = klass('Called Off', '2026-11-09', '10:00', '12:00', 'cancelled')
    src.classes = [none, staffed, two, past, cancelled]
    await updateEntry(keyOf(none), (e) => ({ ...e, needed: 0 }), 'needs 0', kaden)
    await put(keyOf(staffed), 'TM2', 'Jessica')
    await updateEntry(keyOf(two), (e) => ({ ...e, needed: 2 }), 'needs 2', kaden)
    await put(keyOf(two), 'TM3', 'Sam')
    const ws = await staffingWarnings(FROM, TO, NOW)
    expect(ws.filter((w) => w.code === 'unstaffed').map((w) => w.detail)).toEqual(['Needs Two at 10 AM has 1 of 2 on.'])
  })

  it('a party names the host by first name only', async () => {
    const p = uid('pty_')
    src.records.set(p, { bookingId: p, hostName: 'Stefanie Justice', hostEmail: 'stef@example.com', guestCount: 14, status: 'booked', source: 'ours', startIso: localToUtcISO('2026-11-07', '14:30') })
    src.parties = [{ kind: 'party', id: p, label: 'a party', startIso: localToUtcISO('2026-11-07', '14:30'), endIso: localToUtcISO('2026-11-07', '16:30'), party: { state: 'booked', partyId: p } }]
    const [w] = await staffingWarnings(FROM, TO, NOW)
    expect(w).toMatchObject({ code: 'unstaffed', eventKind: 'party', eventId: p, detail: 'The party for Stefanie at 2:30 PM has no one on yet.' })
    expect(JSON.stringify(w)).not.toMatch(/Justice|stef@/)
  })
})

describe('assigned-cant', () => {
  it("someone on at a time they marked Can't, anywhere in the window", async () => {
    const c = klass('Needlepoint 101', '2026-12-06', '13:00', '15:00') // a Sunday, past the 14 days
    src.classes = [c]
    await put(keyOf(c), 'TM2', 'Jessica')
    await saveAvailability('TM2', 'Jessica', { weekly: { '0': { kind: 'cant', range: null, note: 'church' }, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }, dates: {} }, { id: 'TM2', name: 'Jessica' }, (await getAvailability('TM2'))?.updatedAt ?? null)
    const ws = await staffingWarnings(FROM, TO, NOW)
    const cant = ws.filter((w) => w.code === 'assigned-cant')
    expect(cant.map(warningLine)).toEqual(["Sun Dec 6 · Jessica is on Needlepoint 101 at 1 PM but marked that time as Can't. Check with Jessica."])
    // the person's own note stays private to the owners' screens, not this line
    expect(JSON.stringify(cant)).not.toContain('church')
    await saveAvailability('TM2', 'Jessica', { weekly: { '0': null, '1': null, '2': null, '3': null, '4': null, '5': null, '6': null }, dates: {} }, { id: 'TM2', name: 'Jessica' }, (await getAvailability('TM2'))!.updatedAt)
  })
})

describe('assigned-cancelled', () => {
  it('one undated item per event, keyed by the event', async () => {
    const c = klass('Potholder Looms', '2026-11-10', '10:00', '12:00', 'cancelled')
    src.classes = [c]
    await updateEntry(keyOf(c), (e) => withAssigned(e, { staffId: 'TM2', name: 'Jessica', by: kaden, at: 'x', notified: null }), 'on', kaden, undefined, { event: { startIso: c.sessions[0].startIso, endIso: c.sessions[0].endIso, title: 'Potholder Looms' } })
    const ws = (await staffingWarnings(FROM, TO, NOW)).filter((w) => w.code === 'assigned-cancelled' && w.itemId === keyOf(c))
    expect(ws).toHaveLength(1)
    expect(warningLine(ws[0])).toBe('Tue Nov 10 · Jessica is still on Potholder Looms, which was cancelled. Tell Jessica, then take Jessica off in /admin.')
    expect(UNDATED_CODES.has('assigned-cancelled')).toBe(true)
  })

  it('two people: one line naming both', async () => {
    const c = klass('Weaving', '2026-11-11', '10:00', '12:00', 'cancelled')
    src.classes = [c]
    await put(keyOf(c), 'TM2', 'Jessica')
    await put(keyOf(c), 'TM3', 'Sam')
    const [w] = (await staffingWarnings(FROM, TO, NOW)).filter((x) => x.itemId === keyOf(c))
    expect(w.detail).toBe('Jessica and Sam are still on Weaving, which was cancelled.')
    expect(w.action).toBe('Tell them, then take them off in /admin.')
  })

  it('an event that is gone and was never seen has no date on its line, never today (M7)', async () => {
    const key = `ses:${uid('ses_gone')}` as const
    await put(key, 'TM2', 'Jessica')
    const [w] = (await staffingWarnings(FROM, TO, NOW)).filter((x) => x.itemId === key)
    expect(w.when).toBe('')
    expect(warningLine(w)).toBe('Jessica is still on a class, which is no longer on the schedule. Tell Jessica, then take Jessica off in /admin.')
  })
})

describe('when staffing cannot be read', () => {
  it('one "Couldn\'t check staffing." line, never silence', async () => {
    src.classes = [klass('Anything', '2026-11-07')]
    src.teamFails = true
    const ws = await staffingWarnings(FROM, TO, NOW)
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ code: 'staffing-unreadable', detail: STAFFING_UNREADABLE })
    expect(STAFFING_UNREADABLE).toBe("Couldn't check staffing.")
  })

  it('every staffing code is owners only', () => {
    for (const c of ['unstaffed', 'assigned-cant', 'assigned-cancelled', 'staffing-unreadable'] as const) expect(OWNER_ONLY_CODES.has(c)).toBe(true)
    expect(OWNER_ONLY_CODES.has('oversold')).toBe(false)
  })
})
