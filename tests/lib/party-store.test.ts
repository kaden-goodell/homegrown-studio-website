// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

let previewOrDev = true
vi.mock('@lib/deploy-context', () => ({ isPreviewOrDev: () => previewOrDev }))

/** An in-memory blob store with real etags, so compare-and-set is really tested. */
const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  const state = { names: [] as string[], beforeWrite: null as null | ((key: string) => void), writes: 0 }
  const put = (key: string, value: string) => data.set(key, { value, etag: `e${++n}` })
  const store = {
    async get(key: string) { return data.get(key)?.value ?? null },
    async set(key: string, value: string) { put(key, value) },
    async getWithMeta(key: string) {
      const hit = data.get(key)
      return { value: hit?.value ?? null, etag: hit?.etag ?? null }
    },
    async setIfMatch(key: string, value: string, etag: string | null, exists: boolean) {
      state.writes++
      const hook = state.beforeWrite
      if (hook) { state.beforeWrite = null; hook(key) } // someone else writes between our read and our write
      const cur = data.get(key)
      if (!exists ? cur : cur?.etag !== etag) return false
      put(key, value)
      return true
    },
    async list() { return [...data.keys()] },
  }
  return { data, state, store, put }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: (name: string) => { fake.state.names.push(name); return fake.store } }))

import {
  savePartyRecord, getPartyRecord, listParties, createPartyRecord, updatePartyRecord, isOurs, PartyNotFoundError,
  PARTY_HISTORY_CAP, type PartyRecord,
} from '@lib/party-store'

function party(bookingId: string, over: Partial<PartyRecord> = {}): PartyRecord {
  return {
    bookingId, hostToken: 't', craftName: 'Pails', startIso: '2026-10-20T00:00:00.000Z', durationMinutes: 120,
    hostName: 'Ada', hostEmail: 'ada@example.com', guestCount: 8, title: null, dropOff: false,
    createdAt: '2026-10-07T00:00:00.000Z', ...over,
  }
}
const KADEN = { id: 'owner-kaden', name: 'Kaden' }
const charge = { id: 'chg_1', via: 'link' as const, orderId: 'o1', paymentId: 'p1', cents: 30000, quotedCents: 30000, itemIds: ['itm_1'], receiptUrl: null, at: '2026-10-19T00:00:00.000Z', by: null }

beforeEach(() => { fake.data.clear(); fake.state.beforeWrite = null; fake.state.writes = 0; previewOrDev = true })

describe('party-store visibility of simulated parties', () => {
  const ids = { real: 'real_1', dev: 'dev_1', flagged: 'flagged_1' }

  async function seed() {
    await savePartyRecord(party(ids.real))
    await savePartyRecord(party(ids.dev))
    await savePartyRecord(party(ids.flagged, { simulated: true }))
  }
  const mine = (list: PartyRecord[]) => list.map((r) => r.bookingId).sort()

  it('hides dev_ and simulated parties from both reads in production or an unknown runtime', async () => {
    await seed()
    previewOrDev = false
    expect(await getPartyRecord(ids.dev)).toBeNull()
    expect(await getPartyRecord(ids.flagged)).toBeNull()
    expect((await getPartyRecord(ids.real))?.bookingId).toBe(ids.real)
    expect(mine(await listParties())).toEqual([ids.real])
  })

  it('shows them on a preview or in dev', async () => {
    await seed()
    expect((await getPartyRecord(ids.dev))?.bookingId).toBe(ids.dev)
    expect((await getPartyRecord(ids.flagged))?.bookingId).toBe(ids.flagged)
    expect(mine(await listParties())).toEqual([ids.dev, ids.flagged, ids.real].sort())
  })
})

describe('party records v2', () => {
  it('is the kv store "parties"', () => {
    expect(fake.state.names).toContain('parties')
  })

  it('a legacy record without the new fields reads as it was, and is not ours', async () => {
    const legacy = party('SQBOOKING1', { hostPhone: '2565550100' })
    fake.put('SQBOOKING1', JSON.stringify(legacy))
    const got = await getPartyRecord('SQBOOKING1')
    expect(got).toEqual(legacy)
    expect(isOurs(got!)).toBe(false)
    expect(isOurs({ ...got!, source: 'square' })).toBe(false)
    expect(isOurs({ ...got!, source: 'ours' })).toBe(true)
  })

  it('create is create-only: a second create returns "exists" with the stored record', async () => {
    const first = party('pty_aaaa', { source: 'ours', status: 'booked', hostName: 'First' })
    expect(await createPartyRecord(first)).toEqual({ kind: 'created', rec: first })
    const res = await createPartyRecord(party('pty_aaaa', { source: 'ours', status: 'booked', hostName: 'Second' }))
    expect(res.kind).toBe('exists')
    expect(res.rec.hostName).toBe('First')
    expect((await getPartyRecord('pty_aaaa'))?.hostName).toBe('First')
  })

  it('update applies the change, adds a history line, and returns the saved record', async () => {
    await createPartyRecord(party('pty_b', { source: 'ours', status: 'booked' }))
    const saved = await updatePartyRecord('pty_b', (r) => ({ ...r, guestCount: 14 }), 'Guests 8 → 14', KADEN)
    expect(saved.guestCount).toBe(14)
    expect(saved.history).toEqual([{ at: expect.any(String), by: KADEN, change: 'Guests 8 → 14' }])
    expect(await getPartyRecord('pty_b')).toEqual(saved)
  })

  it('update retries a lost race on the latest record, keeping the other write', async () => {
    await createPartyRecord(party('pty_c', { source: 'ours', status: 'booked' }))
    fake.state.writes = 0
    fake.state.beforeWrite = (key) => {
      const cur = JSON.parse(fake.data.get(key)!.value)
      fake.put(key, JSON.stringify({ ...cur, charges: [charge] }))
    }
    const saved = await updatePartyRecord('pty_c', (r) => ({ ...r, hostEmail: 'new@example.com' }), 'Host email changed', null)
    expect(fake.state.writes).toBe(2)
    expect(saved.hostEmail).toBe('new@example.com')
    expect(saved.charges).toEqual([charge])
    expect(await getPartyRecord('pty_c')).toEqual(saved)
  })

  it('update gives up after three lost races', async () => {
    await createPartyRecord(party('pty_d'))
    fake.state.writes = 0
    const lose = (key: string) => { const v = fake.data.get(key)!.value; fake.put(key, v); fake.state.beforeWrite = lose }
    fake.state.beforeWrite = lose
    await expect(updatePartyRecord('pty_d', (r) => ({ ...r, guestCount: 9 }), 'x', null)).rejects.toThrow()
    expect(fake.state.writes).toBe(3)
    fake.state.beforeWrite = null
  })

  it('a null change writes nothing and returns the record', async () => {
    await createPartyRecord(party('pty_e'))
    const got = await updatePartyRecord('pty_e', () => null, 'nothing', null)
    expect(got.bookingId).toBe('pty_e')
    expect(fake.state.writes).toBe(1) // the create only
  })

  it('update of a missing party throws PartyNotFoundError; so does a simulated one in production', async () => {
    await expect(updatePartyRecord('pty_none', (r) => r, 'x', null)).rejects.toBeInstanceOf(PartyNotFoundError)
    await savePartyRecord(party('pty_sim', { simulated: true }))
    previewOrDev = false
    await expect(updatePartyRecord('pty_sim', (r) => r, 'x', null)).rejects.toBeInstanceOf(PartyNotFoundError)
  })

  it('history is capped, oldest dropped', async () => {
    const history = Array.from({ length: PARTY_HISTORY_CAP }, (_, i) => ({ at: '2026-10-19T00:00:00.000Z', by: null, change: `old ${i}` }))
    await createPartyRecord(party('pty_f', { history }))
    const saved = await updatePartyRecord('pty_f', (r) => ({ ...r, guestCount: 10 }), 'newest', null)
    expect(PARTY_HISTORY_CAP).toBe(100)
    expect(saved.history).toHaveLength(100)
    expect(saved.history![0].change).toBe('old 1')
    expect(saved.history![99].change).toBe('newest')
  })

  it('keeps the bookingId even if a change tries to move it', async () => {
    await createPartyRecord(party('pty_g'))
    const saved = await updatePartyRecord('pty_g', (r) => ({ ...r, bookingId: 'pty_other' }), 'x', null)
    expect(saved.bookingId).toBe('pty_g')
    expect(fake.data.has('pty_other')).toBe(false)
  })
})
