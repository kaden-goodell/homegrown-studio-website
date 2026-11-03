// @vitest-environment node
// Money M12 + concurrency minor 5: a press's saved request is found by its id; a press that stopped before saving
// anything is "stopped" (the customer can press again), never "unclear" for an owner.
import { describe, expect, it } from 'vitest'
import { CANCEL_STALE_MS, requestOfTry, tryState, type CancelTry } from '@lib/classes/self-cancel'

const at = '2026-11-02T15:00:00.000Z'
const press = (over: Partial<CancelTry> = {}): CancelTry => ({ attempt: 'att_1', lineIds: ['l1'], cents: 3270, free: false, at, state: 'cancelling', ...over })
const later = new Date(Date.parse(at) + CANCEL_STALE_MS + 1000)
const req = (over: any = {}) => ({ id: 'rq_1', by: { id: 'customer-online', name: 'Ada (online)' }, totalCents: 3270, lines: [{ id: 'l1', cents: 3270 }], createdAt: at, status: 'pending', ...over })

describe('a customer’s cancel press', () => {
  it('finds its saved request by id even when it was saved long after the press', () => {
    const late = req({ id: 'rq_mine', createdAt: '2026-11-02T18:00:00.000Z' })
    expect(requestOfTry(press({ requestId: 'rq_mine' }), [late as any])).toBe(late)
  })
  it('stale with nothing saved under its id → stopped; saved → unclear; the list unreadable → unclear', () => {
    expect(tryState(press({ requestId: 'rq_x' }), [], later, [])).toBe('stopped')
    expect(tryState(press({ requestId: 'rq_1' }), [], later, [req() as any])).toBe('unclear')
    expect(tryState(press({ requestId: 'rq_x' }), [], later, undefined)).toBe('unclear')
    expect(tryState(press(), [], later, [])).toBe('unclear') // an old press with no id: as before
  })
})
