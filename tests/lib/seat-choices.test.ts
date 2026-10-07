import { describe, it, expect } from 'vitest'
import { saveSeatChoices, listSeatChoicesByEvent, hasSeatChoices, seatChoiceKey, type SeatChoiceRecord } from '@lib/seat-choices'

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
