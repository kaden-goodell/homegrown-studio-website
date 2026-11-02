import { describe, it, expect } from 'vitest'
import { getWaitlist, isOnList, lastAttempt, mutateWaitlist, updateEntry, waitlistClassIds, waitlistOrNull, type WaitlistEntry } from '@lib/classes/waitlist-store'

let seq = 0
const entry = (id: string, over: Partial<WaitlistEntry> = {}): WaitlistEntry => ({
  id, createdAt: new Date(2026, 9, 1, 0, ++seq).toISOString(), request: { passId: 'all', tickets: { p: 1 } }, sessionIds: ['s'], seats: 1, maxCents: 2180,
  customer: { givenName: 'A', familyName: 'B', email: 'a@b.c', phone: '' },
  square: { customerId: 'c', cardId: 'card', brand: 'VISA', last4: '4242', expMonth: 1, expYear: 2030 },
  consent: { textVersion: 'v', text: 't', at: '', ipHash: '' }, leaveHash: 'h', state: 'waiting', attempts: [], history: [], ...over,
})

describe('waitlist store', () => {
  it('an empty class reads as an empty list; writes land under wl-<classId>', async () => {
    const id = `cls_store${Date.now()}`
    expect(await getWaitlist(id)).toEqual({ classId: id, entries: [] })
    await mutateWaitlist(id, (cur) => ({ next: { ...cur, entries: [entry('wle_a')] }, result: null }))
    expect((await getWaitlist(id)).entries.map((e) => e.id)).toEqual(['wle_a'])
    expect(await waitlistClassIds()).toContain(id)
    expect(await waitlistOrNull(id)).not.toBeNull()
  })

  it('two writers at once on one server both land (one at a time), never one lost', async () => {
    const id = `cls_store2${Date.now()}`
    await Promise.all(['wle_1', 'wle_2', 'wle_3'].map((e) => mutateWaitlist(id, (cur) => ({ next: { ...cur, entries: [...cur.entries, entry(e)] }, result: null }))))
    expect((await getWaitlist(id)).entries.map((e) => e.id).sort()).toEqual(['wle_1', 'wle_2', 'wle_3'])
  })

  it('updateEntry changes one entry with a history line; a missing one is null; null from change writes nothing', async () => {
    const id = `cls_store3${Date.now()}`
    await mutateWaitlist(id, (cur) => ({ next: { ...cur, entries: [entry('wle_x'), entry('wle_y')] }, result: null }))
    const out = await updateEntry(id, 'wle_x', (e) => ({ ...e, state: 'left' }), { by: null, change: 'Left' })
    expect(out?.state).toBe('left')
    expect(out?.history.at(-1)?.change).toBe('Left')
    expect(await updateEntry(id, 'wle_nope', (e) => e, null)).toBeNull()
    const same = await updateEntry(id, 'wle_y', () => null, { by: null, change: 'x' })
    expect(same?.history).toEqual([])
    expect(isOnList({ state: 'charging' })).toBe(true)
    expect(isOnList({ state: 'added' })).toBe(false)
    expect(lastAttempt({ attempts: [] })).toBeUndefined()
  })
})
