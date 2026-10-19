import { describe, it, expect } from 'vitest'
import { digestWarnings, stillToDecideLine } from '@lib/warning-digest'
import type { Warning } from '@lib/warnings'

const dated: Warning = { code: 'oversold', eventKind: 'workshop', eventId: 'cls_a', when: '2026-10-24T18:00:00.000Z', title: 'A', detail: 'A 1:00 PM: 13 of 12 booked.', action: 'An owner decides on /admin.' }
const undated = (id: string, code: Warning['code'] = 'pos-unmatched'): Warning => ({ code, eventKind: 'workshop', eventId: '', when: '2026-10-01T15:00:00.000Z', title: id, detail: `Counter sale ${id}.`, action: 'An owner decides on /admin.', itemId: id })

let n = 0
const fresh = () => `scope-${++n}-${Date.now()}`

describe('daily email digest of undated items', () => {
  it('shows an undated item in full the first day, then only as a count; dated warnings always in full', async () => {
    const scope = fresh()
    const day1 = await digestWarnings([dated, undated('u1')], '2026-10-19', { scope })
    expect(day1.full).toEqual([dated, undated('u1')])
    expect(day1.stillToDecide).toBe(0)
    await day1.commit()

    // the same day again (a re-run): still in full
    const again = await digestWarnings([dated, undated('u1')], '2026-10-19', { scope })
    expect(again.full).toHaveLength(2)

    const day2 = await digestWarnings([dated, undated('u1'), undated('u2', 'refund-flag')], '2026-10-20', { scope })
    expect(day2.full).toEqual([dated, undated('u2', 'refund-flag')])
    expect(day2.stillToDecide).toBe(1)
    await day2.commit()

    const day3 = await digestWarnings([undated('u1'), undated('u2', 'refund-flag')], '2026-10-21', { scope })
    expect(day3.full).toEqual([])
    expect(day3.stillToDecide).toBe(2)
  })

  it('an item that was decided and comes back later counts as new again', async () => {
    const scope = fresh()
    await (await digestWarnings([undated('u1')], '2026-10-19', { scope })).commit()
    await (await digestWarnings([], '2026-10-20', { scope })).commit()
    expect((await digestWarnings([undated('u1')], '2026-10-21', { scope })).full).toHaveLength(1)
  })

  it('nothing remembered until the email went (no commit): shown in full again', async () => {
    const scope = fresh()
    await digestWarnings([undated('u1')], '2026-10-19', { scope })
    expect((await digestWarnings([undated('u1')], '2026-10-20', { scope })).full).toHaveLength(1)
  })

  it('the one line', () => {
    expect(stillToDecideLine(1)).toBe('1 thing still to decide on /admin')
    expect(stillToDecideLine(3)).toBe('3 things still to decide on /admin')
  })
})
