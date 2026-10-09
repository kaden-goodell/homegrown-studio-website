import { describe, it, expect, vi, beforeEach } from 'vitest'

let previewOrDev = true
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => previewOrDev }))

import { saveSeatChoices, listSeatChoicesByEvent, hasSeatChoices, seatChoiceKey, summarizeChoices, type SeatChoiceRecord } from '@lib/seat-choices'

function record(eventId: string, bookingId: string, over: Partial<SeatChoiceRecord> = {}): SeatChoiceRecord {
  return {
    eventKind: 'workshop', eventId, bookingId, orderId: 'order-1',
    customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'ada@example.com', phone: '' },
    seats: 2,
    picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' }, { seat: 2, optionId: 'pumpkin-color', choice: 'Black' }],
    at: '2026-10-06T15:00:00.000Z', attemptId: 'attempt-1', ...over,
  }
}

describe('seat-choices store', () => {
  it('keys a record by class schedule and booking', () => {
    expect(seatChoiceKey('clssch_pails', 'clsbk_1')).toBe('seat-choices-workshop:clssch_pails-clsbk_1')
  })

  it('lists one class’s records and nothing from another class', async () => {
    const a = `clssch_a${Date.now()}`
    const b = `clssch_b${Date.now()}`
    await saveSeatChoices(record(a, 'clsbk_1', { at: '2026-10-06T15:00:00.000Z' }))
    await saveSeatChoices(record(a, 'clsbk_2', { at: '2026-10-06T14:00:00.000Z' }))
    await saveSeatChoices(record(b, 'clsbk_3'))
    const list = await listSeatChoicesByEvent('workshop', a)
    expect(list.map((r) => r.bookingId)).toEqual(['clsbk_2', 'clsbk_1'])
    expect(list[0].picks[0]).toEqual({ seat: 1, optionId: 'pumpkin-color', choice: 'Lavender' })
  })

  it('saving the same booking again replaces it', async () => {
    const id = `clssch_c${Date.now()}`
    await saveSeatChoices(record(id, 'clsbk_1'))
    await saveSeatChoices(record(id, 'clsbk_1', { seats: 1, picks: [{ seat: 1, optionId: 'pumpkin-color', choice: 'Black' }] }))
    const list = await listSeatChoicesByEvent('workshop', id)
    expect(list).toHaveLength(1)
    expect(list[0].seats).toBe(1)
  })

  it('knows whether anyone has picked for a class', async () => {
    const id = `clssch_d${Date.now()}`
    expect(await hasSeatChoices('workshop', id)).toBe(false)
    await saveSeatChoices(record(id, 'clsbk_1'))
    expect(await hasSeatChoices('workshop', id)).toBe(true)
  })
})

describe('summarizeChoices', () => {
  const PAILS = { id: 'pumpkin-color', label: 'Pumpkin color', choices: ['Light Pink', 'Light Blue', 'Black', 'Lavender'] }
  const p = (seat: number, choice: string) => ({ seat, optionId: 'pumpkin-color', choice })

  it('totals, groups by email (any case) and lists paid families with no signed agreement', () => {
    const records = [
      record('clssch_pails', 'clsbk_1', { customer: { givenName: 'Ada', familyName: 'Lovelace', email: 'Ada@Example.com', phone: '' }, seats: 2, picks: [p(1, 'Lavender'), p(2, 'Lavender')] }),
      record('clssch_pails', 'clsbk_2', { customer: { givenName: 'Bo', familyName: 'Test', email: 'bo@x.com', phone: '' }, seats: 1, picks: [p(1, 'Black')] }),
    ]
    expect(summarizeChoices([PAILS], records, ['ada@example.com '], 15)).toEqual({
      totals: { 'pumpkin-color': { Lavender: 2, Black: 1 } },
      byEmail: { 'ada@example.com': [p(1, 'Lavender'), p(2, 'Lavender')], 'bo@x.com': [p(1, 'Black')] },
      seatsByEmail: { 'ada@example.com': { seats: 2, comped: 0 }, 'bo@x.com': { seats: 1, comped: 0 } },
      unmatched: [{ name: 'Bo Test', email: 'bo@x.com', seats: 1, picks: [p(1, 'Black')], comped: false }],
      seatsSold: 15,
    })
  })
})

describe('simulated records (payment bypass on a preview)', () => {
  beforeEach(() => { previewOrDev = true })

  async function seed() {
    const id = `clssch_sim${Date.now()}${Math.random()}`
    await saveSeatChoices(record(id, 'bypass-1', { simulated: true }))
    await saveSeatChoices(record(id, 'clsbk_real'))
    return id
  }

  it('are left out of the listing in production and in an unknown runtime', async () => {
    const id = await seed()
    previewOrDev = false
    expect((await listSeatChoicesByEvent('workshop', id)).map((r) => r.bookingId)).toEqual(['clsbk_real'])
  })

  it('do not make a class look like it has picks there', async () => {
    const id = `clssch_simonly${Date.now()}${Math.random()}`
    await saveSeatChoices(record(id, 'bypass-1', { simulated: true }))
    previewOrDev = false
    expect(await hasSeatChoices('workshop', id)).toBe(false)
  })

  it('are listed on a preview or in dev', async () => {
    const id = await seed()
    expect((await listSeatChoicesByEvent('workshop', id)).map((r) => r.bookingId).sort()).toEqual(['bypass-1', 'clsbk_real'])
  })

  it('a comped record is listed as comped', () => {
    const out = summarizeChoices([], [record('c', 'comp_1', { orderId: null, comped: true, by: { id: 's', name: 'Sam' } })], [], null)
    expect(out.unmatched[0]).toMatchObject({ name: 'Ada Lovelace', comped: true })
  })

  it('carry a (test) suffix on the roster', () => {
    const out = summarizeChoices([], [record('c', 'bypass-1', { simulated: true })], [], null)
    expect(out.unmatched[0].name).toBe('Ada Lovelace (test)')
  })
})

describe('summarizeChoices seatsByEmail', () => {
  it('adds a family’s bookings together and counts comped seats', () => {
    const rec = (seats: number, comped?: true) => ({ eventKind: 'workshop', eventId: 'c', bookingId: 'b' + seats, orderId: null, customer: { givenName: 'K', familyName: 'G', email: 'K@x.com', phone: '' }, seats, picks: [], at: '', attemptId: '', ...(comped ? { comped } : {}) }) as any
    const r = summarizeChoices([], [rec(3, true), rec(1)], ['k@x.com'], null)
    expect(r.seatsByEmail).toEqual({ 'k@x.com': { seats: 4, comped: 3 } })
    expect(r.unmatched).toEqual([])
  })
})
