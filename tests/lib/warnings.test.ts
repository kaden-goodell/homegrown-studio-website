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
})

describe('listWarnings', () => {
  it('is empty when nothing is wrong', async () => {
    mockListAllWorkshops.mockResolvedValue([PAILS])
    mockListBookings.mockResolvedValue([party('bk_rivera', '2026-10-18T20:30:00.000Z')]) // Sun 3:30 PM
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
      detail: 'Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM.', action: 'Move one in Square.',
    })
    expect(warningLine(w)).toBe('Sun Oct 18 · Pumpkin Pails 1–3 PM overlaps the Rivera party 1:00 PM. Move one in Square.')
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
    expect(w).toMatchObject({ code: 'class-over-class', eventId: 'clssch_needle', detail: 'Needlepoint 6–8 PM overlaps Girls Craft Night 7–9 PM.' })
  })

  it('oversold: more seats sold than the class holds', async () => {
    mockListAllWorkshops.mockResolvedValue([{ ...PAILS, availableCapacity: -2 }])
    const [w] = await listWarnings(WINDOW)
    expect(w).toMatchObject({ code: 'oversold', eventId: 'clssch_pails', detail: 'Pumpkin Pails: 27 seats sold, 25 capacity.' })
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

  it('does not warn for back-to-back classes', async () => {
    mockListAllWorkshops.mockResolvedValue([
      cls('clssch_a', 'A', '2026-10-23T23:00:00.000Z'), // 6-8 PM
      cls('clssch_b', 'B', '2026-10-24T01:00:00.000Z'), // 8-10 PM
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
