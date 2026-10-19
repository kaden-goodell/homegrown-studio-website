// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** An in-memory blob store with real etags, so compare-and-set is really tested. */
const fake = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  const state = { down: false, loseNext: 0, writes: 0 }
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
        // Someone else wrote in between.
        const cur = data.get(key)
        data.set(key, { value: cur?.value ?? value, etag: `e${++n}` })
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
vi.mock('@lib/blob-store', () => ({ makeKvStore: () => fake.store }))

import {
  CACHE_MS, configSettings, describeChanges, getClosures, getSettingsView, getStudioDays, HISTORY_CAP, resetStudioDaysCache,
  saveStudioSettings, SettingsError, StaleSettingsError, validateSettings, type SettingsInput,
} from '@lib/studio-settings'
import { CONFIG_STUDIO_DAYS } from '@config/studio-days'
import { closures as configClosures } from '@config/closures'
import { cafeHoursOn, CAFE_HOURS, CAFE_SPECIAL_DAYS } from '@config/hours'

const CATHERINE = { id: 'owner-catherine', name: 'Catherine' }
const KADEN = { id: 'owner-kaden', name: 'Kaden' }

const base = (): SettingsInput => ({
  cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '12:00' }],
  cafeSpecialDays: [{ date: '2026-11-07', opens: '09:00', closes: '21:00', name: 'Craft Café grand opening' }],
  closures: [{ id: 'clo_a', from: '2026-11-26', to: '2026-11-27', name: 'Thanksgiving', holiday: 'thanksgiving' }],
})

beforeEach(() => {
  fake.data.clear()
  fake.state.down = false
  fake.state.loseNext = 0
  fake.state.writes = 0
  resetStudioDaysCache()
})
afterEach(() => vi.useRealTimers())

describe('nothing saved yet: the config, exactly as before', () => {
  it('getStudioDays is the config list and hours', async () => {
    const days = await getStudioDays()
    expect(days).toBe(CONFIG_STUDIO_DAYS)
    expect(days.closures).toBe(configClosures)
    expect(days.cafe.special).toBe(CAFE_SPECIAL_DAYS)
    expect(days.cafe.weekly).toEqual(CAFE_HOURS.flatMap((h) => h.days.map((weekday) => ({ weekday, opens: h.opens, closes: h.closes }))))
    // The rules give the same answers as the config always did.
    expect(cafeHoursOn('2026-11-14', days.cafe)).toEqual(cafeHoursOn('2026-11-14'))
    expect(cafeHoursOn('2026-11-07', days.cafe)).toEqual({ opens: '09:00', closes: '21:00' })
  })

  it('/admin sees the config as settings, with no updatedAt; config closures get stable ids', async () => {
    const view = await getSettingsView()
    expect(view.updatedAt).toBeNull()
    expect(view.by).toBeNull()
    expect(view.history).toEqual([])
    expect(view.closures.map((c) => c.id)).toEqual(configClosures.map((c) => `cfg-${c.from}`))
    expect(configSettings().closures.map((c) => c.id)).toEqual(view.closures.map((c) => c.id))
  })

  it('a store that can’t be read falls back to the config, or throws when strict', async () => {
    fake.state.down = true
    expect(await getStudioDays()).toBe(CONFIG_STUDIO_DAYS)
    resetStudioDaysCache()
    await expect(getStudioDays({ strict: true })).rejects.toThrow('blobs down')
  })
})

describe('saving', () => {
  it('first save is create-only; it becomes what everything reads, with who and what changed', async () => {
    const input = { ...base(), closures: [...base().closures, { id: 'clo_b', from: '2027-03-15', to: '2027-03-19', name: 'Spring break' }] }
    const { saved, before, changed } = await saveStudioSettings(input, { expectedUpdatedAt: null, by: CATHERINE, now: new Date('2026-10-19T15:00:00Z') })
    expect(saved.updatedAt).toBe('2026-10-19T15:00:00.000Z')
    expect(saved.by).toEqual(CATHERINE)
    expect(before.closures.map((c) => c.id)).toEqual(configClosures.map((c) => `cfg-${c.from}`))
    expect(changed).toContain('Closed Mon, Mar 15 – Fri, Mar 19 (Spring break)')
    expect(saved.history).toHaveLength(1)
    expect(saved.history[0]).toMatchObject({ by: CATHERINE, changed })
    // The instance that saved reads it at once.
    expect((await getClosures()).map((c) => c.name)).toEqual(['Thanksgiving', 'Spring break'])
    expect((await getSettingsView()).updatedAt).toBe(saved.updatedAt)
  })

  it('a save from a stale screen is refused with what is there now; nothing is written', async () => {
    const first = await saveStudioSettings(base(), { expectedUpdatedAt: null, by: CATHERINE })
    await expect(saveStudioSettings(base(), { expectedUpdatedAt: null, by: KADEN })).rejects.toBeInstanceOf(StaleSettingsError)
    try {
      await saveStudioSettings({ ...base(), closures: [] }, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z', by: KADEN })
    } catch (e) {
      expect((e as StaleSettingsError).status).toBe(409)
      expect((e as StaleSettingsError).current.updatedAt).toBe(first.saved.updatedAt)
    }
    expect((await getSettingsView()).closures).toHaveLength(1)
    // With the right updatedAt it saves, and history keeps both, newest first.
    const second = await saveStudioSettings({ ...base(), closures: [] }, { expectedUpdatedAt: first.saved.updatedAt, by: KADEN })
    expect(second.saved.history.map((h) => h.by.name)).toEqual(['Kaden', 'Catherine'])
    expect(second.changed).toEqual(['Removed a closed day: Thu, Nov 26 – Fri, Nov 27 (Thanksgiving)'])
    expect(second.saved.history[0].before.closures).toHaveLength(1)
  })

  it('compare-and-set: a write that loses the race reads again and retries; three losses is a 503', async () => {
    const first = await saveStudioSettings(base(), { expectedUpdatedAt: null, by: CATHERINE })
    fake.state.loseNext = 1
    // The other writer only bumped the etag (same content, same updatedAt), so the retry succeeds.
    const second = await saveStudioSettings({ ...base(), closures: [] }, { expectedUpdatedAt: first.saved.updatedAt, by: KADEN })
    expect(second.saved.closures).toEqual([])
    fake.state.loseNext = 3
    await expect(saveStudioSettings(base(), { expectedUpdatedAt: second.saved.updatedAt, by: KADEN })).rejects.toMatchObject({ status: 503 })
  })

  it('updatedAt always moves forward, even within the same millisecond', async () => {
    const now = new Date('2026-10-19T15:00:00Z')
    const a = await saveStudioSettings(base(), { expectedUpdatedAt: null, by: CATHERINE, now })
    const b = await saveStudioSettings({ ...base(), closures: [] }, { expectedUpdatedAt: a.saved.updatedAt, by: CATHERINE, now })
    expect(b.saved.updatedAt > a.saved.updatedAt).toBe(true)
  })

  it(`keeps the last ${HISTORY_CAP} changes`, async () => {
    let at: string | null = null
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      const input = { ...base(), cafeWeekly: [{ weekday: 'Saturday' as const, opens: '09:00', closes: i % 2 ? '12:00' : '13:00' }] }
      at = (await saveStudioSettings(input, { expectedUpdatedAt: at, by: CATHERINE })).saved.updatedAt
    }
    const view = await getSettingsView()
    expect(view.history).toHaveLength(HISTORY_CAP)
    expect(view.history[0].changed).toEqual(['Craft Café weekly hours'])
  })
})

describe('the minute-long memory', () => {
  it('another server’s save shows within a minute; a fresh read sees it at once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-19T15:00:00Z'))
    await saveStudioSettings(base(), { expectedUpdatedAt: null, by: CATHERINE })
    expect((await getClosures()).length).toBe(1)
    // Another instance writes straight to the store.
    const raw = JSON.parse(fake.data.get('settings')!.value)
    fake.data.set('settings', { value: JSON.stringify({ ...raw, closures: [] }), etag: 'other' })
    expect((await getClosures()).length).toBe(1)
    expect((await getClosures({ fresh: true })).length).toBe(0)
    fake.data.set('settings', { value: JSON.stringify(raw), etag: 'other2' })
    vi.setSystemTime(new Date(Date.parse('2026-10-19T15:00:00Z') + CACHE_MS + 1))
    expect((await getClosures()).length).toBe(1)
  })

  it('when the store goes down, the last answer this server had is used (never the config over a saved closure)', async () => {
    await saveStudioSettings({ ...base(), closures: [{ id: 'clo_x', from: '2027-02-01', to: '2027-02-01', name: 'a snow day' }] }, { expectedUpdatedAt: null, by: CATHERINE })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.now() + CACHE_MS + 1))
    fake.state.down = true
    expect((await getClosures({ strict: true })).map((c) => c.name)).toEqual(['a snow day'])
  })
})

describe('validation', () => {
  const bad = (over: Partial<SettingsInput> | any, field?: string, message?: RegExp) => {
    try {
      validateSettings({ ...base(), ...over })
    } catch (e) {
      expect(e).toBeInstanceOf(SettingsError)
      if (field) expect((e as SettingsError).field).toBe(field)
      if (message) expect((e as SettingsError).message).toMatch(message)
      return
    }
    throw new Error('expected a refusal')
  }

  it('times are HH:MM and it closes after it opens', () => {
    bad({ cafeWeekly: [{ weekday: 'Saturday', opens: '9:00', closes: '12:00' }] }, 'cafeWeekly.0', /opens/)
    bad({ cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '24:00' }] }, 'cafeWeekly.0', /closes/)
    bad({ cafeWeekly: [{ weekday: 'Saturday', opens: '12:00', closes: '12:00' }] }, 'cafeWeekly.0', /close after it opens/)
    bad({ cafeSpecialDays: [{ date: '2026-11-07', opens: '21:00', closes: '09:00', name: 'x' }] }, 'cafeSpecialDays.0', /close after/)
  })

  it('days of the week once each; real dates; one special day per date', () => {
    bad({ cafeWeekly: [{ weekday: 'Caturday', opens: '09:00', closes: '12:00' }] }, 'cafeWeekly.0', /day of the week/)
    bad({ cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '12:00' }, { weekday: 'Saturday', opens: '13:00', closes: '14:00' }] }, 'cafeWeekly.1', /twice/)
    bad({ cafeSpecialDays: [{ date: '2026-02-30', opens: '09:00', closes: '12:00', name: '' }] }, 'cafeSpecialDays.0', /Pick the day/)
    bad({ cafeSpecialDays: [{ date: '2026-11-07', opens: '09:00', closes: '12:00', name: '' }, { date: '2026-11-07', opens: '13:00', closes: '14:00', name: '' }] }, 'cafeSpecialDays.1')
  })

  it('closed days: a real first day, a last day not before it (blank = one day), up to a year', () => {
    bad({ closures: [{ from: '', to: '', name: 'x' }] }, 'closures.0', /first closed day/)
    bad({ closures: [{ from: '2026-12-02', to: '2026-12-01', name: 'x' }] }, 'closures.0', /before the first/)
    bad({ closures: [{ from: '2026-01-01', to: '2027-06-01', name: 'x' }] }, 'closures.0', /year/)
    const ok = validateSettings({ ...base(), closures: [{ from: '2026-12-02', to: '', name: '  Snow   day ' }] })
    expect(ok.closures[0]).toMatchObject({ from: '2026-12-02', to: '2026-12-02', name: 'Snow day' })
    expect(ok.closures[0].id).toMatch(/^clo_/)
  })

  it('names are at most 60 characters; blank names get a plain one; unknown holidays are dropped', () => {
    bad({ closures: [{ from: '2026-12-02', to: '2026-12-02', name: 'x'.repeat(61) }] }, 'closures.0', /60/)
    bad({ cafeSpecialDays: [{ date: '2026-11-07', opens: '09:00', closes: '12:00', name: 'y'.repeat(61) }] }, 'cafeSpecialDays.0', /60/)
    const ok = validateSettings({
      ...base(),
      cafeSpecialDays: [{ date: '2026-12-12', opens: '09:00', closes: '17:00', name: '' }],
      closures: [{ from: '2026-12-02', name: '', holiday: 'easter' }, { from: '2026-10-31', name: 'Halloween', holiday: 'halloween' }],
    })
    expect(ok.cafeSpecialDays[0].name).toBe('Special hours')
    // Sorted by first day.
    expect(ok.closures.map((c) => [c.name, c.holiday])).toEqual([['Halloween', 'halloween'], ['a break', undefined]])
  })

  it('all three lists come together; ids that clash are replaced', () => {
    bad({ closures: undefined }, undefined, /together/)
    const ok = validateSettings({ ...base(), closures: [{ id: 'same', from: '2026-12-01' }, { id: 'same', from: '2026-12-05' }] })
    expect(new Set(ok.closures.map((c) => c.id)).size).toBe(2)
  })
})

describe('what changed, in plain words', () => {
  it('names each special day and closed day added, changed or removed', () => {
    const before = base()
    const after: SettingsInput = {
      cafeWeekly: [{ weekday: 'Saturday', opens: '09:00', closes: '13:00' }, { weekday: 'Sunday', opens: '13:00', closes: '15:00' }],
      cafeSpecialDays: [{ date: '2026-11-07', opens: '09:00', closes: '20:00', name: 'Craft Café grand opening' }, { date: '2026-12-12', opens: '09:00', closes: '17:00', name: 'Holiday market' }],
      closures: [],
    }
    expect(describeChanges(before, after)).toEqual([
      'Craft Café weekly hours',
      'Changed a special day: Sat, Nov 7',
      'Added a special day: Sat, Dec 12',
      'Removed a closed day: Thu, Nov 26 – Fri, Nov 27 (Thanksgiving)',
    ])
    expect(describeChanges(before, before)).toEqual([])
  })
})
