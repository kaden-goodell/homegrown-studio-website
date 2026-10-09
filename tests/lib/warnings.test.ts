import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockListAllWorkshops, mockListBookings, mockProviders } = vi.hoisted(() => {
  const mockListAllWorkshops = vi.fn()
  const mockListBookings = vi.fn()
  const mockProviders: any = {
    workshop: { listAllWorkshops: (...a: any[]) => mockListAllWorkshops(...a), listWorkshops: async () => [] },
    booking: { listBookings: (...a: any[]) => mockListBookings(...a) },
  }
  return { mockListAllWorkshops, mockListBookings, mockProviders }
})
vi.mock('@config/providers', () => ({ providers: mockProviders }))
vi.mock('@config/site.config', () => ({ siteConfig: { providers: { booking: { config: { locationId: 'LOC' } } } } }))

const HOSTS: Record<string, string> = { bk_rivera: 'Jamie Rivera', bk_lopez: 'Ana Lopez' }
vi.mock('@lib/party-store', () => ({ getPartyRecord: async (id: string) => (HOSTS[id] ? { hostName: HOSTS[id] } : null) }))

const mockGetEventMeta = vi.fn()
vi.mock('@lib/event-meta', () => ({ getEventMeta: (...a: any[]) => mockGetEventMeta(...a) }))
const mockListSeatChoices = vi.fn()
vi.mock('@lib/seat-choices', () => ({ listSeatChoicesByEvent: (...a: any[]) => mockListSeatChoices(...a) }))

import { partyConfig } from '@config/party.config'
import { listWarnings, warningLine } from '@lib/warnings'

function cls(scheduleId: string, name: string, startAt: string, over: Record<string, unknown> = {}) {
  return {
    id: `inst-${scheduleId}`, scheduleId, name, description: '', descriptionHtml: '', startAt, durationMinutes: 120,
    priceCents: 2500, priceCurrency: 'USD', availableCapacity: 5, staffName: '', teamMemberId: '', ...over,
  }
}
const party = (id: string, startAt: string, status = 'confirmed') => ({ id, status, slot: { startAt, duration: 90 } })

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
})

describe('listWarnings', () => {
  it('is empty when nothing is wrong', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T21:00:00.000Z')]) // Sun 4:00 PM, an hour after Pails
    expect(await listWarnings(WINDOW)).toEqual([])
  })

  it('asks for bookings across the whole studio-local window', async () => {
    await listWarnings(WINDOW)
    expect(mockListBookings).toHaveBeenCalledWith({ startDate: '2026-10-15T05:00:00.000Z', endDate: '2026-10-26T04:59:59.999Z', locationId: 'LOC' })
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

  it('throws when classes cannot be read, so no one mistakes it for all clear', async () => {
    mockListAllWorkshops.mockRejectedValue(new Error('Square Classes API error: 503'))
    await expect(listWarnings(WINDOW)).rejects.toThrow('503')
  })

  it('throws when bookings cannot be read', async () => {
    mockListBookings.mockRejectedValue(new Error('Square 500'))
    await expect(listWarnings(WINDOW)).rejects.toThrow('500')
  })

  it('throws when the booking provider cannot list bookings', async () => {
    delete mockProviders.booking.listBookings
    await expect(listWarnings(WINDOW)).rejects.toThrow('Bookings cannot be read')
  })

  it('throws when the workshop provider cannot list all classes', async () => {
    delete mockProviders.workshop.listAllWorkshops
    await expect(listWarnings(WINDOW)).rejects.toThrow('Classes cannot be read')
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

  it('throws when the event meta cannot be read', async () => {
    mockGetEventMeta.mockRejectedValue(new Error('meta down'))
    await expect(listWarnings(WINDOW)).rejects.toThrow('meta down')
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
})
