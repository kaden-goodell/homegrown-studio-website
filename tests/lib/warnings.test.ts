import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockListAllWorkshops, mockListBookings, mockProviders } = vi.hoisted(() => {
  const mockListAllWorkshops = vi.fn()
  const mockListBookings = vi.fn()
  const mockProviders: any = {
    workshop: { listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a), listWorkshops: async () => [] },
    booking: { listBookings: (...a: any[]) => mockListBookings(...a) },
  }
  return { mockListAllWorkshops, mockListBookings, mockProviders }
})
// Staffing lines have their own tests (tests/lib/staffing/warnings.test.ts).
const mockStaffingWarnings = vi.hoisted(() => vi.fn(async () => [] as any[]))
vi.mock('@lib/staffing/warnings', () => ({ staffingWarnings: mockStaffingWarnings }))
vi.mock('@config/providers', () => ({ providers: mockProviders }))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))

const HOSTS: Record<string, string> = { bk_rivera: 'Jamie Rivera', bk_lopez: 'Ana Lopez' }
const RECORDS = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@lib/party-store', async (orig) => ({
  ...(await orig<any>()),
  getPartyRecord: async (id: string) => RECORDS.list.find((r) => r.bookingId === id) ?? (HOSTS[id] ? { hostName: HOSTS[id] } : null),
  listParties: async () => RECORDS.list,
}))

// The party service's variation: only Square bookings of it are parties.
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))

const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))
const mockListSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', () => ({ listSeatChoicesByEvent: (...a: any[]) => mockListSeatChoices(...a) }))

import { partyConfig } from '@config/party.config'
import { listWarnings, warningLine } from '@lib/warnings'
import { holdTime, releaseTime } from '@lib/parties/party-book'

function cls(scheduleId: string, name: string, startAt: string, over: Record<string, unknown> = {}) {
  return {
    id: `inst-${scheduleId}`, scheduleId, name, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
    priceCents: 2500, priceCurrency: 'USD', availableCapacity: 5, staffName: '', teamMemberId: '', ...over,
  }
}
const party = (id: string, startAt: string, status = 'confirmed', serviceVariationId = 'var-party') => ({ id, status, slot: { startAt, duration: 90, serviceVariationId } })

const WINDOW = { from: '2026-10-15', to: '2026-10-25' }
const PAILS = cls('clssch_pails', 'Pumpkin Pails', '2026-10-18T18:00:00.000Z', { totalCapacity: 25, availableCapacity: 10 })

beforeEach(() => {
  vi.clearAllMocks()
  mockProviders.workshop.listAllWorkshops = (...a: any[]) => mockListAllWorkshops(...a)
  mockProviders.booking.listBookings = (...a: any[]) => mockListBookings(...a)
  mockListAllWorkshops.mockResolvedValue([])
  mockListBookings.mockResolvedValue([])
  mockGetEventMeta.mockResolvedValue(null)
  mockListSeatChoices.mockResolvedValue([])
  RECORDS.list = []
})

describe('listWarnings', () => {
  it('runs the staffing scan for the daily email, and skips it when asked (the /staff panel)', async () => {
    await listWarnings(WINDOW)
    expect(mockStaffingWarnings).toHaveBeenCalledTimes(1)
    mockStaffingWarnings.mockClear()
    await listWarnings(WINDOW, { staffing: false })
    expect(mockStaffingWarnings).not.toHaveBeenCalled()
  })

  it('is empty when nothing is wrong', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T21:00:00.000Z')]) // Sun 4:00 PM, an hour after Pails
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('asks for bookings across the whole studio-local window (and the 12 hours before, for a party still running)', async () => {
    await listWarnings(WINDOW)
    expect(mockListBookings).toHaveBeenCalledWith({ startDate: '2026-10-14T17:00:00.000Z', endDate: '2026-10-26T04:59:59.999Z', locationId: 'LOC' })
  })

  it('class-over-party sees a party in our party book (pty_), named from its record', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    HOSTS.pty_warn0000000000001 = 'Sam Patel'
    const held = await holdTime({ partyId: 'pty_warn0000000000001', startIso: '2026-10-18T18:00:00.000Z', endIso: '2026-10-18T19:30:00.000Z', ttlMinutes: null }, [], new Date('2026-10-10T12:00:00Z'))
    expect(held.ok).toBe(true)
    try {
      const [w] = await listWarnings(WINDOW)
      expect(w).toMatchObject({ code: 'class-over-party', eventId: 'clssch_pails', detail: 'Pumpkin Pails 1–3 PM is within an hour of the Patel party 1:00 PM.' })
      // One of our parties moves on /admin (only the Square class moves in Square).
      expect(w.action).toBe('Move the class in Square, or the party on /admin.')
    } finally {
      await releaseTime('pty_warn0000000000001', '2026-10-18T18:00:00.000Z')
    }
  })

  it('only the party service counts: a Square booking of another service is not a party', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T18:00:00.000Z', 'confirmed', 'var-something-else')])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('class-over-party: a class in the room with a booked party, or in its cleanup hour', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T18:00:00.000Z')])
    const [w] = await listWarnings(WINDOW)
    expect(w).toEqual({
      code: 'class-over-party', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails',
      detail: 'Pumpkin Pails 1–3 PM is within an hour of the Rivera party 1:00 PM.', action: 'Move one in Square.',
    })
    expect(warningLine(w)).toBe('Sun Oct 18 · Pumpkin Pails 1–3 PM is within an hour of the Rivera party 1:00 PM. Move one in Square.')
  })

  it('class-over-party: a party booked 30 minutes after the class ends', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T20:30:00.000Z')]) // Sun 3:30 PM
    const list = await listWarnings(WINDOW)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ code: 'class-over-party', eventId: 'clssch_pails' })
  })

  it('ignores a cancelled party', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T18:00:00.000Z', 'cancelled')])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('class-over-class: two classes at once', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_gcn', 'Girls Craft Night', '2026-10-24T00:00:00.000Z'), // Fri 7–9 PM
      cls('clssch_needle', 'Needlepoint', '2026-10-23T23:00:00.000Z'), // Fri 6–8 PM
    ])
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({ code: 'class-over-class', eventId: 'clssch_needle', detail: 'Needlepoint 6–8 PM is within an hour of Girls Craft Night 7–9 PM.' })
  })

  it('oversold: more seats sold than the class holds', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, availableCapacity: -2 }])
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({ code: 'oversold', eventId: 'clssch_pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.' })
  })

  it('oversold: uses the class’s own capacity setting when Square gives none', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, totalCapacity: undefined, availableCapacity: -1 }])
    mockGetEventMeta.mockResolvedValue({ options: [], signupCutoffHours: null, capacity: 12 })
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({ code: 'oversold', detail: 'Pumpkin Pails: 13 seats sold, 12 capacity.' })
  })

  it('party-on-closed-day: a party on a day the studio is shut', async () => {
    mockListBookings.mockResolvedValue([party('bk_lopez', '2026-10-19T15:00:00.000Z')]) // Mon 10 AM
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({
      code: 'party-on-closed-day', eventKind: 'party', eventId: 'bk_lopez', title: 'The Lopez party',
      detail: 'The Lopez party 10:00 AM is booked on a closed day.',
    })
  })

  it('leaves out classes outside the window and sorts by date', async () => {
    mockListAllWorkshops.mockResolvedValue([
      { ...PAILS, availableCapacity: -1 },
      cls('clssch_late', 'Late', '2026-11-30T18:00:00.000Z', { totalCapacity: 10, availableCapacity: -5 }),
    ])
    mockListBookings.mockResolvedValue([party('bk_lopez', '2026-10-19T15:00:00.000Z')]) // Mon 19 Oct: closed
    const list = await listWarnings(WINDOW)
    expect(list.map((w) => w.code)).toEqual(['oversold', 'party-on-closed-day'])
  })

  // Re-review Minor A: a Square read failure is said in one line (never an all clear), and our own checks still run.
  const codes = async () => (await listWarnings(WINDOW)).map((w) => w.code)
  it('classes that cannot be read are said in one line, so no one mistakes it for all clear', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    expect(await codes()).toContain('classes-unreadable')
  })

  it('bookings that cannot be read: Square’s classes and parties each get their line', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 500'))
    expect((await codes()).sort()).toEqual(['classes-unreadable', 'parties-unreadable'])
  })

  it('a booking provider that cannot list bookings is said, never an all clear', async () => {
    delete mockProviders.booking.listBookings
    expect(await codes()).toContain('classes-unreadable')
  })

  it('a workshop provider that cannot list all classes is said, never an all clear', async () => {
    delete mockProviders.workshop.listAllWorkshops
    expect(await codes()).toContain('classes-unreadable')
  })

  it('does not warn when seats sold equals capacity', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, availableCapacity: 0 }])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('warns once for back-to-back classes', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_a', 'A', '2026-10-23T23:00:00.000Z'), // 6-8 PM
      cls('clssch_b', 'B', '2026-10-24T01:00:00.000Z'), // 8-10 PM
    ])
    const list = await listWarnings(WINDOW)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ code: 'class-over-class', detail: 'A 6–8 PM is within an hour of B 8–10 PM.' })
  })

  it('does not warn for classes exactly one hour apart', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_a', 'A', '2026-10-23T23:00:00.000Z'), // 6-8 PM
      cls('clssch_b', 'B', '2026-10-24T02:00:00.000Z'), // 9-11 PM
    ])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('does not warn for the Sunday Oct 18 trio (1–3, 4–6, 7–9 PM)', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_1', 'One', '2026-10-18T18:00:00.000Z'), // 1-3 PM
      cls('clssch_2', 'Two', '2026-10-18T21:00:00.000Z'), // 4-6 PM
      cls('clssch_3', 'Three', '2026-10-19T00:00:00.000Z'), // 7-9 PM
    ])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('does not warn when a party ends exactly the cleanup buffer before a class', async () => {
    const classStart = Date.parse('2026-10-18T22:00:00.000Z')
    const partyStart = classStart - (partyConfig.cleanupBufferMinutes + partyConfig.durationMinutes) * 60_000
    mockListAllWorkshops.mockResolvedValue([cls('clssch_x', 'X', new Date(classStart).toISOString())])
    mockListBookings.mockResolvedValue([{ id: 'bk_rivera', status: 'confirmed', slot: { startAt: new Date(partyStart).toISOString(), duration: partyConfig.durationMinutes } }])
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('warns for classes on the first and last day of the window', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_first', 'First', '2026-10-15T23:00:00.000Z'), // Thu 6 PM
      cls('clssch_last', 'Last', '2026-10-25T23:00:00.000Z'), // Sun 6 PM
    ])
    mockListBookings.mockResolvedValue([
      party('bk_rivera', '2026-10-15T23:00:00.000Z'),
      party('bk_lopez', '2026-10-25T23:00:00.000Z'),
    ])
    const list = await listWarnings(WINDOW)
    expect(list.filter((w) => w.code === 'class-over-party').map((w) => w.eventId)).toEqual(['clssch_first', 'clssch_last'])
  })

  it('gives one class-over-party warning per clashing party', async () => {
    mockListAllWorkshops.mockResolvedValue([cls('clssch_wide', 'Wide', '2026-10-18T18:00:00.000Z', { durationMinutes: 480 })])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T19:00:00.000Z'), party('bk_lopez', '2026-10-18T23:00:00.000Z')])
    const list = await listWarnings(WINDOW)
    expect(list.filter((w) => w.code === 'class-over-party')).toHaveLength(2)
  })
})

describe('listWarnings — picks-missing', () => {
  const OPTION = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Black', 'Lavender'] }
  const seatsPicked = (...n: number[]) => n.map((seats) => ({ seats }))

  beforeEach(() => {
    mockListAllWorkshops.mockResolvedValue([PAILS]) // 25 seats, 10 left: 15 sold
    mockGetEventMeta.mockResolvedValue({ options: [OPTION], signupCutoffHours: null })
  })

  it('counts sold seats with no pick on record', async () => {
    mockListSeatChoices.mockResolvedValue(seatsPicked(4, 4, 5)) // 13 picked
    const [w] = await listWarnings(WINDOW)
    expect(mockListSeatChoices).toHaveBeenCalledWith('workshop', 'clssch_pails')
    expect(w).toEqual({
      code: 'picks-missing', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails',
      detail: 'Pumpkin Pails: 2 seats have no pumpkin color.', action: 'Call the customer.',
    })
  })

  it('says "1 seat has" for one', async () => {
    mockListSeatChoices.mockResolvedValue(seatsPicked(14))
    expect((await listWarnings(WINDOW))[0].detail).toBe('Pumpkin Pails: 1 seat has no pumpkin color.')
  })

  it('is quiet when every sold seat has a pick', async () => {
    mockListSeatChoices.mockResolvedValue(seatsPicked(15))
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('skips a class that asks no questions and has nothing recorded', async () => {
    mockGetEventMeta.mockResolvedValue(null)
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('counts against the class’s own capacity setting when Square gives none', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, totalCapacity: undefined }])
    mockGetEventMeta.mockResolvedValue({ options: [OPTION], signupCutoffHours: null, capacity: 25 })
    mockListSeatChoices.mockResolvedValue(seatsPicked(13))
    expect(await listWarnings(WINDOW)).toEqual([
      expect.objectContaining({ code: 'picks-missing', detail: 'Pumpkin Pails: 2 seats have no pumpkin color.' }),
    ])
  })

  it('says it can’t count seats when a class with questions has no capacity anywhere — never silent', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, totalCapacity: undefined }])
    const warnings = await listWarnings(WINDOW)
    expect(warnings).toEqual([{
      code: 'capacity-unknown', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails',
      detail: 'Can’t count seats sold for Pumpkin Pails. Set its capacity (gear → Capacity) so seats booked on Square’s own page get flagged.',
      action: 'Set the capacity.',
    }])
  })

  it('stays quiet about capacity for a class with no questions', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, totalCapacity: undefined }])
    mockGetEventMeta.mockResolvedValue(null)
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('throws when the seat choices cannot be read', async () => {
    mockListSeatChoices.mockRejectedValue(new Error('store down'))
    await expect(listWarnings(WINDOW)).rejects.toThrow('store down')
  })

  it('event settings that cannot be read are said in one line, never an all clear', async () => {
    mockGetEventMeta.mockRejectedValue(new Error('meta down'))
    expect((await listWarnings(WINDOW)).map((w) => w.code)).toContain('classes-unreadable')
  })
})

describe('listWarnings — recorded-over-sold', () => {
  const OPTION = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Black', 'Lavender'] }
  const seatsRecorded = (...n: number[]) => n.map((seats) => ({ seats }))

  beforeEach(() => {
    mockListAllWorkshops.mockResolvedValue([PAILS]) // 25 seats, 10 left: 15 sold
  })

  it('flags a comp recorded here but never added in Square', async () => {
    mockGetEventMeta.mockResolvedValue({ options: [OPTION], signupCutoffHours: null })
    mockListSeatChoices.mockResolvedValue(seatsRecorded(15, 2)) // 17 recorded, 15 sold
    const warnings = await listWarnings(WINDOW)
    expect(warnings).toEqual([{
      code: 'recorded-over-sold', eventKind: 'workshop', eventId: 'clssch_pails', when: '2026-10-18T18:00:00.000Z', title: 'Pumpkin Pails',
      detail: 'Pumpkin Pails · 2 recorded seats more than Square shows —',
      action: 'someone was recorded here but not added in Square.',
    }])
    expect(warningLine(warnings[0])).toBe(
      'Sun Oct 18 · Pumpkin Pails · 2 recorded seats more than Square shows — someone was recorded here but not added in Square.',
    )
  })

  it('flags it on a class that asks no questions, too, and says "seat" for one', async () => {
    mockGetEventMeta.mockResolvedValue(null)
    mockListSeatChoices.mockResolvedValue(seatsRecorded(16))
    const [w] = await listWarnings(WINDOW)
    expect(w.code).toBe('recorded-over-sold')
    expect(w.detail).toBe('Pumpkin Pails · 1 recorded seat more than Square shows —')
  })

  it('is quiet when recorded equals sold', async () => {
    mockGetEventMeta.mockResolvedValue({ options: [OPTION], signupCutoffHours: null })
    mockListSeatChoices.mockResolvedValue(seatsRecorded(15))
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('ignores simulated preview records, which never reach Square', async () => {
    mockGetEventMeta.mockResolvedValue(null)
    mockListSeatChoices.mockResolvedValue([{ seats: 15 }, { seats: 3, simulated: true }])
    expect(await listWarnings(WINDOW)).toEqual([])
  })
})

describe('listWarnings — our parties (stage 2 Task 13)', () => {
  const NOW = new Date('2026-10-15T12:00:00.000Z') // Thu Oct 15, 7 AM studio time
  const SAT2 = '2026-10-17T19:00:00.000Z' // Sat Oct 17, 2:00 PM
  const SAT2_END = '2026-10-17T20:30:00.000Z'
  const NEXT_SAT2 = '2026-10-24T19:00:00.000Z'
  const made: { id: string; start: string }[] = []
  let n = 0
  const pid = () => `pty_tw${String(++n).padStart(14, '0')}`
  const item = (chargeId: string | null, over: Record<string, unknown> = {}) => ({ id: `itm_${n}`, kind: 'package', refId: 'pkg_whole', label: 'Whole studio', qty: 1, unitCents: 30000, cents: 30000, extraMinutes: 0, chargeId, addedAt: '', by: null, ...over })
  const rec = (id: string, over: Record<string, unknown> = {}) => ({
    bookingId: id, hostToken: 't', craftName: 'Slime', startIso: SAT2, durationMinutes: 90, hostName: 'Stefanie Justice', hostEmail: 's@x.com', guestCount: 10,
    title: null, dropOff: false, createdAt: '2026-10-01T00:00:00Z', source: 'ours', status: 'booked', endIso: SAT2_END, items: [item('chg_1')], charges: [], refunds: [], ...over,
  })
  async function hold(id: string, start = SAT2, end = SAT2_END, booked = true) {
    const { holdTime, confirmTime } = await import('@lib/parties/party-book')
    const h = await holdTime({ partyId: id, startIso: start, endIso: end, ttlMinutes: null }, [], NOW)
    expect(h.ok).toBe(true)
    if (booked) await confirmTime(id, start, end, NOW)
    made.push({ id, start })
  }
  const partyLines = async () => (await listWarnings(WINDOW, { now: NOW })).filter((w) => w.code.startsWith('party') || w.code === 'two-parties' || w.code === 'class-over-party')

  afterEach(async () => {
    for (const m of made.splice(0)) await releaseTime(m.id, m.start)
  })

  it('a booked, paid party with its time held: nothing to say', async () => {
    const id = pid()
    RECORDS.list = [rec(id)]
    await hold(id)
    expect(await partyLines()).toEqual([])
  })

  it('waiting on payment 2 days out is one line; 9 days out, none', async () => {
    const soon = pid(), later = pid()
    RECORDS.list = [rec(soon, { items: [item(null)] }), rec(later, { startIso: NEXT_SAT2, endIso: '2026-10-24T20:30:00.000Z', items: [item(null)] })]
    await hold(soon, SAT2, SAT2_END, false)
    await hold(later, NEXT_SAT2, '2026-10-24T20:30:00.000Z', false)
    const lines = await partyLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'party-waiting-payment', eventKind: 'party', eventId: soon })
    expect(warningLine(lines[0])).toBe('Sat Oct 17 · The Justice party 2:00 PM still has $300 to pay for the studio fee. Send the payment link again from the party on /admin, or call Stefanie. Nothing is cancelled for being unpaid.')
  })

  it('a hold with no party record is named, with nothing to open', async () => {
    const id = pid()
    await hold(id)
    const [w] = await partyLines()
    expect(w).toMatchObject({ code: 'party-hold-no-party', eventId: '' })
    expect(warningLine(w)).toBe('Sat Oct 17 · 2:00 PM is held for a party that isn’t on the books, so nobody can book that time. Open To decide on /admin and tap Free this time.')
    expect(w.detail).not.toContain(id)
  })

  it('a cancelled party that still holds its time is named', async () => {
    const id = pid()
    RECORDS.list = [rec(id, { status: 'cancelled', cancelled: { at: '2026-10-10T00:00:00Z', by: { id: 'k', name: 'K' }, note: '' } })]
    await hold(id)
    const [w] = await partyLines()
    expect(warningLine(w)).toBe('Sat Oct 17 · Stefanie Justice’s cancelled party still holds 2:00 PM, so nobody can book that time. Open the party on /admin and tap Free this time.')
  })

  it('a leftover hold at a time the party isn’t on (a move that didn’t finish) is named', async () => {
    const id = pid()
    RECORDS.list = [rec(id, { startIso: NEXT_SAT2, endIso: '2026-10-24T20:30:00.000Z' })]
    await hold(id)
    await hold(id, NEXT_SAT2, '2026-10-24T20:30:00.000Z')
    const lines = await partyLines()
    expect(lines.map((w) => w.code)).toEqual(['party-hold-no-party'])
    expect(lines[0].detail).toBe('Stefanie Justice’s party is on Sat, Oct 24 at 2:00 PM, but 2:00 PM is held for it too, so nobody can book that time.')
    expect(lines[0].action).toBe('Open the party on /admin and tap Free the old time.')
  })

  it('a short hold of a booking still being paid, or of a checkout waiting in To decide, is left alone', async () => {
    const { holdTime } = await import('@lib/parties/party-book')
    const { saveCheckout, deleteCheckout } = await import('@lib/parties/party-checkouts')
    const paying = pid(), unclear = pid()
    expect((await holdTime({ partyId: paying, startIso: SAT2, endIso: SAT2_END, ttlMinutes: 10 }, [], NOW)).ok).toBe(true)
    made.push({ id: paying, start: SAT2 })
    await hold(unclear, NEXT_SAT2, '2026-10-24T20:30:00.000Z', false)
    await saveCheckout({ partyId: unclear, state: 'unclear', startIso: NEXT_SAT2, endIso: '2026-10-24T20:30:00.000Z', draft: null, order: null, orderId: null, quotedCents: 30000, squareCents: null, host: { firstName: 'A', lastName: 'B', email: 'a@b.c', phone: '1' }, origin: 'x', via: 'online', at: NOW.toISOString(), updatedAt: NOW.toISOString() })
    try {
      expect(await partyLines()).toEqual([])
    } finally {
      await deleteCheckout(unclear)
    }
  })

  it('a booked party with no time held: the inverse warning, in plain words', async () => {
    const id = pid()
    RECORDS.list = [rec(id)]
    const [w] = await partyLines()
    expect(w).toMatchObject({ code: 'party-no-hold', eventId: id })
    expect(warningLine(w)).toBe('Sat Oct 17 · Stefanie Justice’s party on Sat, Oct 17 at 2:00 PM isn’t held on the calendar, so that time could be booked by someone else. Open the party on /admin and tap Hold this time again.')
  })

  it('a booked party whose extra time isn’t held', async () => {
    const id = pid()
    RECORDS.list = [rec(id, { endIso: '2026-10-17T21:00:00.000Z' })]
    await hold(id) // ends 3:30, the party (with its extra half hour) 4:00
    const [w] = await partyLines()
    expect(w.code).toBe('party-no-hold')
    expect(w.detail).toBe('Stefanie Justice’s party on Sat, Oct 17 at 2:00 PM has extra time that isn’t held on the calendar, so someone else could book right after it.')
  })

  it('two parties at once (one paid after its time was taken) is one line', async () => {
    const a = pid(), b = pid()
    RECORDS.list = [rec(a), rec(b, { hostName: 'Ana Lopez', overlap: true })]
    await hold(a)
    const { confirmTime } = await import('@lib/parties/party-book')
    expect((await confirmTime(b, SAT2, SAT2_END, NOW)).overlap).toBe(true)
    made.push({ id: b, start: SAT2 })
    const lines = (await partyLines()).filter((w) => w.code === 'two-parties')
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toMatch(/^The (Justice|Lopez) party 2:00–3:30 PM and the (Justice|Lopez) party 2:00–3:30 PM are booked at the same time, or without the hour between them for cleanup\.$/)
    expect(lines[0].action).toBe('Move one of them on /admin.')
  })

  it('one of our classes within an hour of a party', async () => {
    const { createClass } = await import('@lib/classes/class-store')
    const { defaultRules } = await import('@lib/classes/validate')
    const id = pid()
    RECORDS.list = [rec(id)]
    await hold(id)
    const cls = await createClass({
      content: {
        name: 'Clay Night', description: 'Pots.', imageUrl: null, instructor: null, rules: { ...defaultRules(), dropOff: false },
        ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' as const } }],
        prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 60,
      } as any,
      sessions: [{ id: 'ses_c1', startIso: '2026-10-17T21:00:00.000Z', endIso: '2026-10-17T22:00:00.000Z', capacity: 8 }],
      status: 'open', by: { id: 'k', name: 'K' },
    })
    const lines = (await partyLines()).filter((w) => w.code === 'class-over-party')
    expect(lines).toEqual([expect.objectContaining({ eventKind: 'workshop', eventId: cls.id, detail: 'Clay Night 4–5 PM is within an hour of the Justice party 2:00 PM.', action: 'Move one of them on /admin.' })])
  })

  it('money that came in after a cancel is named until someone acts', async () => {
    const id = pid()
    RECORDS.list = [rec(id, {
      status: 'cancelled', cancelled: { at: '2026-10-10T00:00:00Z', by: { id: 'k', name: 'K' }, note: '' },
      charges: [{ id: 'chg_late', via: 'link', orderId: 'o', paymentId: 'p', cents: 30000, quotedCents: 30000, itemIds: [], receiptUrl: null, at: '2026-10-11T00:00:00Z', by: null }],
    })]
    const [w] = await partyLines()
    expect(w).toMatchObject({ code: 'party-paid-after-cancel', itemId: 'paid-after-cancel-chg_late' })
    expect(w.detail).toBe('Stefanie Justice paid $300 after their party on Sat, Oct 17 at 2:00 PM was cancelled. Nothing was refunded.')
  })

  it('Square side from Square’s live list: a Square party cancelled in Square, its time rebooked through us, raises no alarm', async () => {
    const id = pid()
    // Our saved record of the old Square party (no status: nothing marks it when Square cancels it).
    RECORDS.list = [rec(id), { bookingId: 'bk_old', hostToken: 't', craftName: 'Pails', startIso: SAT2, durationMinutes: 120, hostName: 'Old Host', hostEmail: 'o@x.com', guestCount: 8, title: null, dropOff: false, createdAt: '2026-09-01T00:00:00Z' }]
    await hold(id)
    // Square itself lists it cancelled.
    mockListBookings.mockResolvedValue([party('bk_old', SAT2, 'cancelled')])
    // (an earlier test's class at 4 PM stays in the class store: only the party-vs-party line matters here)
    expect((await partyLines()).filter((w) => w.code === 'two-parties' || w.detail.includes('Old Host') || w.detail.includes('Host party'))).toEqual([])
  })

  it('a party booked straight in Square with no record of ours is checked against our parties and our classes', async () => {
    const id = pid()
    RECORDS.list = [rec(id)]
    await hold(id)
    mockListBookings.mockResolvedValue([party('bk_lopez', SAT2)])
    const lines = (await partyLines()).filter((w) => w.code === 'two-parties')
    expect(lines).toHaveLength(1)
    expect(lines[0].detail).toMatch(/the Lopez party|The Lopez party/)
    expect(lines[0].action).toBe('Move the Justice party on /admin. The Lopez party was booked in Square before we moved bookings here, so it can only be moved in Square.')
  })

  it('Square’s party list can’t be read: the party warnings still run, with one line saying Square parties weren’t checked', async () => {
    const { partyWarnings } = await import('@lib/parties/warnings')
    const id = pid()
    RECORDS.list = [rec(id)]
    const lines = await partyWarnings(WINDOW.from, WINDOW.to, NOW, { squareParties: Promise.reject(new Error('square down')) })
    expect(lines.map((w) => w.code).sort()).toEqual(['parties-unreadable', 'party-no-hold'])
    expect(lines.find((w) => w.code === 'parties-unreadable')!.detail).toBe('Parties booked in Square couldn’t be checked against our parties and classes just now.')
  })

  it('fix round 2 (Minor E): two parties both booked in Square point to Square only, and say why', async () => {
    RECORDS.list = []
    mockListBookings.mockResolvedValue([party('bk_lopez', SAT2), party('bk_ruiz', '2026-10-17T19:30:00.000Z')])
    const lines = (await partyLines()).filter((w) => w.code === 'two-parties')
    expect(lines).toHaveLength(1)
    expect(lines[0].action).toBe('Move one of them in Square. Both were booked in Square before we moved bookings here, so they can only be moved there.')
  })

  it('fix round 2 (Minor A): Square’s lists can’t be read: one line for Square’s classes, one for Square’s parties, and every check of our own parties still runs', async () => {
    const id = pid()
    RECORDS.list = [rec(id)] // booked, its time not held
    mockListAllWorkshops.mockRejectedValue(new Error('square down'))
    mockListBookings.mockRejectedValue(new Error('square down'))
    const list = await listWarnings(WINDOW, { now: NOW })
    expect(list.map((w) => w.code).sort()).toEqual(['classes-unreadable', 'parties-unreadable', 'party-no-hold'])
    expect(list.find((w) => w.code === 'classes-unreadable')!.detail).toBe('Classes booked in Square couldn’t be checked for problems just now.')
    expect(list.find((w) => w.code === 'parties-unreadable')!.detail).toBe('Parties booked in Square couldn’t be checked against our parties and classes just now.')
  })

  it('parties that can’t be read: one line, the rest still shows', async () => {
    const spy = vi.spyOn(await import('@lib/parties/party-checkouts'), 'listCheckouts').mockRejectedValueOnce(new Error('blobs down'))
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, availableCapacity: -2 }])
    const list = await listWarnings(WINDOW, { now: NOW })
    expect(list.map((w) => w.code).sort()).toEqual(['oversold', 'parties-unreadable'])
    spy.mockRestore()
  })
})
