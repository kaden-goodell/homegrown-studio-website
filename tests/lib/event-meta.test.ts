import { describe, it, expect } from 'vitest'
import { getEventMeta, setEventMeta } from '@lib/event-meta'
const by = { id: 'k', name: 'Kaden' }
describe('event-meta', () => {
  it('returns null when unset, then the merged patch with history', async () => {
    const id = 'w_' + Date.now()
    expect(await getEventMeta('workshop', id)).toBeNull()
    const m = await setEventMeta('workshop', id, { dropOff: true }, by)
    expect(m.dropOff).toBe(true); expect(m.days).toBeNull(); expect(m.history).toHaveLength(1); expect(m.history[0].by).toEqual(by)
    const m2 = await setEventMeta('workshop', id, { days: ['2026-10-19', '2026-10-20'] }, by)
    expect(m2.dropOff).toBe(true); expect(m2.days).toEqual(['2026-10-19', '2026-10-20']); expect(m2.history).toHaveLength(2)
  })
  it('caps history at 50', async () => {
    const id = 'w_cap_' + Date.now()
    for (let i = 0; i < 55; i++) await setEventMeta('party', id, { dropOff: i % 2 === 0 }, by)
    expect((await getEventMeta('party', id))!.history).toHaveLength(50)
  })
})
