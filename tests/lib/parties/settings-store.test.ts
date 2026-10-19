// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** An in-memory blob store with real etags, so compare-and-set is really tested. */
const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  const state = { down: false, loseNext: 0, writes: 0, names: [] as string[] }
  const store = {
    async get(key: string) { if (state.down) throw new Error('blobs down'); return data.get(key)?.value ?? null },
    async set(key: string, value: string) { data.set(key, { value, etag: `e${++n}` }) },
    async getWithMeta(key: string) {
      if (state.down) throw new Error('blobs down')
      const hit = data.get(key)
      return { value: hit?.value ?? null, etag: hit?.etag ?? null }
    },
    async setIfMatch(key: string, value: string, etag: string | null, exists: boolean) {
      state.writes++
      if (state.loseNext > 0) {
        state.loseNext--
        const cur = data.get(key)
        if (cur) data.set(key, { value: cur.value, etag: `e${++n}` }) // someone else wrote the same thing in between
        else data.set(key, { value, etag: `e${++n}` })
        return false
      }
      const cur = data.get(key)
      if (!exists ? cur : cur?.etag !== etag) return false
      data.set(key, { value, etag: `e${++n}` })
      return true
    },
    async list() { return [...data.keys()] },
  }
  return { data, state, store }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: (name: string) => { fake.state.names.push(name); return fake.store } }))

import {
  getPartySettings, resetPartySettingsCache, savePartySettings, StalePartySettingsError,
} from '@lib/parties/settings-store'
import { configPartySettings } from '@lib/parties/party-times'
import { SettingsError } from '@lib/studio-settings'
import type { PartySettingsInput } from '@lib/parties/types'

const KADEN = { id: 'owner-kaden', name: 'Kaden' }
const CATHERINE = { id: 'owner-catherine', name: 'Catherine' }

const input = (price = 32500): PartySettingsInput => {
  const c = structuredClone(configPartySettings())
  c.packages[0].priceCents = price
  return { times: c.times, packages: c.packages, addOns: c.addOns, readSquareBookings: c.readSquareBookings }
}
const configInput = (): PartySettingsInput => {
  const c = configPartySettings()
  return { times: c.times, packages: c.packages, addOns: c.addOns, readSquareBookings: c.readSquareBookings }
}

beforeEach(() => {
  fake.data.clear()
  fake.state.down = false
  fake.state.loseNext = 0
  fake.state.writes = 0
  resetPartySettingsCache()
})
afterEach(() => vi.useRealTimers())

describe('party settings store', () => {
  it('is the kv store "party-settings"', () => {
    expect(fake.state.names).toContain('party-settings')
  })

  it('missing → the config with updatedAt null', async () => {
    const s = await getPartySettings()
    expect(s).toEqual(configPartySettings())
    expect(s.updatedAt).toBeNull()
    expect(await getPartySettings({ strict: true, fresh: true })).toEqual(configPartySettings())
  })

  it('save then get', async () => {
    const now = new Date('2026-10-19T15:00:00Z')
    const { saved, changed } = await savePartySettings(input(), { expectedUpdatedAt: null, by: KADEN, now })
    expect(changed).toEqual(['Changed a package: Whole studio'])
    expect(saved.updatedAt).toBe(now.toISOString())
    expect(saved.by).toEqual(KADEN)
    expect(saved.history).toEqual([{ at: now.toISOString(), by: KADEN, changed, before: configInput() }])
    // The saving instance sees it at once; another instance on its next read.
    expect((await getPartySettings()).packages[0].priceCents).toBe(32500)
    resetPartySettingsCache()
    expect(await getPartySettings()).toEqual(saved)
    expect(fake.data.has('settings')).toBe(true)
  })

  it('a stale expectedUpdatedAt → 409 with the current settings', async () => {
    const { saved } = await savePartySettings(input(), { expectedUpdatedAt: null, by: KADEN })
    const err = await savePartySettings(input(40000), { expectedUpdatedAt: null, by: CATHERINE }).catch((e) => e)
    expect(err).toBeInstanceOf(StalePartySettingsError)
    expect(err).toBeInstanceOf(SettingsError)
    expect(err.status).toBe(409)
    expect(err.current).toEqual(saved)
    const old = await savePartySettings(input(40000), { expectedUpdatedAt: '2026-01-01T00:00:00.000Z', by: CATHERINE }).catch((e) => e)
    expect(old.status).toBe(409)
  })

  it('a stale save against the config (someone saved first, then cleared) shows the config', async () => {
    const err = await savePartySettings(input(), { expectedUpdatedAt: '2026-10-19T15:00:00.000Z', by: KADEN }).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.current).toEqual(configPartySettings())
  })

  it('a lost setIfMatch is retried', async () => {
    const { saved: first } = await savePartySettings(input(), { expectedUpdatedAt: null, by: KADEN })
    fake.state.loseNext = 1
    fake.state.writes = 0
    const { saved } = await savePartySettings(input(40000), { expectedUpdatedAt: first.updatedAt, by: CATHERINE })
    expect(fake.state.writes).toBe(2)
    expect(saved.packages[0].priceCents).toBe(40000)
    resetPartySettingsCache()
    expect((await getPartySettings()).packages[0].priceCents).toBe(40000)
  })

  it('gives up after three lost writes, saying so', async () => {
    const { saved: first } = await savePartySettings(input(), { expectedUpdatedAt: null, by: KADEN })
    fake.state.loseNext = 3
    const err = await savePartySettings(input(40000), { expectedUpdatedAt: first.updatedAt, by: KADEN }).catch((e) => e)
    expect(err).toBeInstanceOf(SettingsError)
    expect(err.status).toBe(503)
    expect(err.message).toBe('Someone else is saving at the same moment. Try again.')
  })

  it('updatedAt only moves forward', async () => {
    const later = new Date('2026-10-19T15:00:00Z')
    const { saved: a } = await savePartySettings(input(), { expectedUpdatedAt: null, by: KADEN, now: later })
    const { saved: b } = await savePartySettings(input(40000), { expectedUpdatedAt: a.updatedAt, by: KADEN, now: new Date('2026-10-19T14:00:00Z') })
    expect(b.updatedAt! > a.updatedAt!).toBe(true)
    const { saved: c } = await savePartySettings(input(41000), { expectedUpdatedAt: b.updatedAt, by: KADEN, now: later })
    expect(c.updatedAt! > b.updatedAt!).toBe(true)
  })

  it('a strict read error throws; a display read gets the last good, or the config', async () => {
    fake.state.down = true
    await expect(getPartySettings({ strict: true })).rejects.toThrow('blobs down')
    expect(await getPartySettings()).toEqual(configPartySettings())

    fake.state.down = false
    resetPartySettingsCache()
    const { saved } = await savePartySettings(input(), { expectedUpdatedAt: null, by: KADEN })
    fake.state.down = true
    await expect(getPartySettings({ strict: true, fresh: true })).rejects.toThrow('blobs down')
    expect(await getPartySettings({ fresh: true })).toEqual(saved)
  })

  it('remembers the answer for 60 seconds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
    expect((await getPartySettings()).updatedAt).toBeNull()
    // Another instance saves (written straight into the store).
    const other = { ...configPartySettings(), ...input(), updatedAt: '2026-10-19T15:00:01.000Z', by: KADEN, history: [] }
    fake.data.set('settings', { value: JSON.stringify(other), etag: 'x1' })
    vi.setSystemTime(new Date('2026-10-19T15:00:59Z'))
    expect((await getPartySettings()).updatedAt).toBeNull()
    expect((await getPartySettings({ strict: true })).updatedAt).toBeNull()
    vi.setSystemTime(new Date('2026-10-19T15:01:01Z'))
    expect((await getPartySettings()).updatedAt).toBe(other.updatedAt)
  })

  it('history is capped at 50, newest first, each with what it was before', async () => {
    let at: string | null = null
    for (let i = 0; i < 53; i++) {
      const { saved } = await savePartySettings(input(30000 + (i + 1) * 100), { expectedUpdatedAt: at, by: KADEN })
      at = saved.updatedAt
    }
    const s = await getPartySettings({ fresh: true })
    expect(s.history).toHaveLength(50)
    expect(s.history[0].before.packages[0].priceCents).toBe(30000 + 52 * 100)
    expect(s.history[49].before.packages[0].priceCents).toBe(30000 + 3 * 100)
    expect(s.history[0].changed).toEqual(['Changed a package: Whole studio'])
  })
})
