/**
 * Tests for CheckinEvent audit log, mutateCheckin, and normalize defaults.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeKvStore } from '@lib/blob-store'

// We'll directly test checkin-store by importing it. Since checkin-store uses a
// module-level kv singleton, we test the exported functions end-to-end in fs mode
// by pointing the store at a temp dir. Because there's no injection hook in
// checkin-store itself, we replicate the relevant logic here using the blob-store
// primitives, then also test the exported functions separately.

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFakeBlobStore(options: { failFirst?: boolean } = {}) {
  let callCount = 0
  const data: Record<string, string> = {}
  const etags: Record<string, string> = {}

  return {
    _data: data,
    _etags: etags,
    _failFirst: options.failFirst ?? false,

    async get(key: string, _opts?: unknown): Promise<string | null> {
      return data[key] ?? null
    },

    async getWithMetadata(key: string, _opts?: unknown) {
      const value = data[key]
      if (value === undefined) return null
      return { data: value, etag: etags[key] ?? undefined, metadata: {} }
    },

    async set(key: string, value: string, opts?: unknown) {
      callCount++
      const shouldFail = this._failFirst && callCount === 1
      if (shouldFail) {
        // Simulate lost race: don't update, return modified=false
        return { modified: false, etag: undefined }
      }
      data[key] = value
      etags[key] = `etag-${callCount}`
      return { modified: true, etag: etags[key] }
    },

    async list() {
      const blobs = Object.keys(data).map((key) => ({ key, etag: 'etag' }))
      return { blobs, directories: [] }
    },
  }
}

// ─── Import the module under test ────────────────────────────────────────────
// We import after the test file is loaded so we get the real module.
// Because checkin-store uses a module-level kv singleton pointing at .data/,
// we test it by creating a fresh module-level store using blob-store + fs mode.
// The checkin-store functions themselves are tested via their public API.

// ─── Tests using exported functions (fs mode via temp dir) ───────────────────

describe('checkin-events (via exported functions, fs mode)', () => {
  let tmpDir: string

  // We dynamically import checkin-store with a patched kv using unstable_vi
  // workaround: since checkin-store has a module-level kv, we use vi.mock
  // to inject a temp-dir KvStore. But vi.mock requires static calls.
  // Instead, we directly test via the blob-store pattern used in blob-store.test.ts:
  // create a KvStore with fsDirOverride, then call the lower-level logic directly.

  // For testing normalize and emptyState behavior, we need to access them.
  // Per the plan, normalize is EXPORTED in Step 2, so we can import it.

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'checkin-events-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // (b) normalize defaults events:[] on legacy blobs (JSON without the field)
  it('normalize defaults events:[] on legacy blobs', async () => {
    const { normalize } = await import('@lib/checkin-store')
    const legacy = {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      pickupCodeHash: null,
      // no 'events' field
    }
    const result = normalize(legacy)
    expect(result.events).toEqual([])
  })

  it('normalize preserves existing events', async () => {
    const { normalize } = await import('@lib/checkin-store')
    const withEvents = {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      pickupCodeHash: null,
      events: [{ at: '2026-01-01T00:00:00.000Z', action: 'checkin', personIds: ['adult'] }],
    }
    const result = normalize(withEvents)
    expect(result.events).toHaveLength(1)
    expect(result.events[0].action).toBe('checkin')
  })

  it('normalize sets events:[] when events is not an array', async () => {
    const { normalize } = await import('@lib/checkin-store')
    const malformed = {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      pickupCodeHash: null,
      events: 'not-an-array',
    }
    const result = normalize(malformed)
    expect(result.events).toEqual([])
  })
})

// ─── Tests using KvStore directly to test mutateCheckin ──────────────────────

describe('checkin-events (mutateCheckin via mocked kv)', () => {
  // These tests use vi.mock to inject a controllable kv into checkin-store.
  // We need a fresh module each test.

  // (d) mutateCheckin retries when setIfMatch returns false then succeeds

  it('mutateCheckin retries when setIfMatch returns false then succeeds', async () => {
    // Track setIfMatch call results
    let setIfMatchCalls = 0
    const data: Record<string, string> = {}
    const etags: Record<string, string> = {}

    const fakeKv = {
      async get(k: string) { return data[k] ?? null },
      async set(k: string, v: string) { data[k] = v; etags[k] = 'etag-1' },
      async getWithMeta(k: string) {
        return { value: data[k] ?? null, etag: etags[k] ?? null }
      },
      async setIfMatch(k: string, v: string, etag: string | null): Promise<boolean> {
        setIfMatchCalls++
        if (setIfMatchCalls === 1) return false // first attempt fails
        data[k] = v
        etags[k] = `etag-${setIfMatchCalls}`
        return true
      },
      async list() { return [] as string[] },
    }

    // Use vi.mock to inject the fake kv
    vi.doMock('@lib/blob-store', () => ({
      makeKvStore: () => fakeKv,
    }))

    vi.resetModules()
    const { mutateCheckin } = await import('@lib/checkin-store')

    let callbackCount = 0
    const state = await mutateCheckin('party-1', 'rec-1', (s) => {
      callbackCount++
      s.events.push({ at: new Date().toISOString(), action: 'checkin', personIds: ['adult'] })
    })

    expect(setIfMatchCalls).toBe(2) // failed once, succeeded on retry
    expect(callbackCount).toBe(2) // callback was called twice (once per attempt)
    expect(state.events).toHaveLength(1)

    vi.doUnmock('@lib/blob-store')
    vi.resetModules()
  })

  it('mutateCheckin throws after 3 failed setIfMatch attempts', async () => {
    const fakeKv = {
      async get(_k: string) { return null },
      async set(_k: string, _v: string) {},
      async getWithMeta(_k: string) { return { value: null, etag: null } },
      async setIfMatch(_k: string, _v: string, _etag: string | null): Promise<boolean> {
        return false // always fail
      },
      async list() { return [] as string[] },
    }

    vi.doMock('@lib/blob-store', () => ({
      makeKvStore: () => fakeKv,
    }))

    vi.resetModules()
    const { mutateCheckin } = await import('@lib/checkin-store')

    await expect(
      mutateCheckin('party-1', 'rec-1', (s) => {
        s.events.push({ at: new Date().toISOString(), action: 'checkin', personIds: ['adult'] })
      }),
    ).rejects.toThrow('Concurrent update')

    vi.doUnmock('@lib/blob-store')
    vi.resetModules()
  })
})

// ─── Tests for events append and history survives undo ───────────────────────

describe('checkin-events (append and history survival)', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'checkin-events-append-'))
    vi.resetModules()
    // Patch blob-store to use fs mode with tmpDir
    vi.doMock('@lib/blob-store', () => ({
      makeKvStore: (storeName: string, fsDirName: string) => {
        return makeKvStore(storeName, fsDirName, { fsDirOverride: tmpDir })
      },
    }))
  })

  afterEach(async () => {
    vi.doUnmock('@lib/blob-store')
    vi.resetModules()
    await rm(tmpDir, { recursive: true, force: true })
  })

  // (a) events append across mutations
  it('events append across multiple mutations', async () => {
    const { mutateCheckin } = await import('@lib/checkin-store')
    const now = new Date().toISOString()

    await mutateCheckin('party-a', 'rec-a', (s) => {
      s.events.push({ at: now, action: 'checkin', personIds: ['adult'] })
    })

    await mutateCheckin('party-a', 'rec-a', (s) => {
      s.events.push({ at: now, action: 'undo-checkin', personIds: ['adult'] })
    })

    // Read the state back
    const state3 = await mutateCheckin('party-a', 'rec-a', (_s) => {
      // no-op: just to read state back
    })

    expect(state3.events).toHaveLength(2)
    expect(state3.events[0].action).toBe('checkin')
    expect(state3.events[1].action).toBe('undo-checkin')
  })

  // (c) after checkin → undo-checkin, events array still contains BOTH entries
  it('history survives presence clearing in undo-checkin', async () => {
    const { mutateCheckin } = await import('@lib/checkin-store')
    const now = new Date().toISOString()

    // First mutation: checkin
    await mutateCheckin('party-b', 'rec-b', (s) => {
      s.presence['adult'] = { inAt: now, outAt: null }
      s.events.push({ at: now, action: 'checkin', personIds: ['adult'] })
    })

    // Second mutation: undo-checkin (clears presence)
    await mutateCheckin('party-b', 'rec-b', (s) => {
      const prevPresence = JSON.stringify(s.presence)
      s.presence = {}
      s.events.push({ at: now, action: 'undo-checkin', personIds: ['adult'], note: `cleared: ${prevPresence}` })
    })

    // Read final state
    const finalState = await mutateCheckin('party-b', 'rec-b', (_s) => {})

    // Presence is cleared
    expect(Object.keys(finalState.presence)).toHaveLength(0)
    // But BOTH events are still in history
    expect(finalState.events).toHaveLength(2)
    expect(finalState.events[0].action).toBe('checkin')
    expect(finalState.events[1].action).toBe('undo-checkin')
    expect(finalState.events[1].note).toContain('cleared:')
  })
})

// ─── Tests for setCheckin normalize + event cap ───────────────────────────────

describe('checkin-events (setCheckin normalizes and caps events)', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'checkin-cap-test-'))
    vi.resetModules()
    vi.doMock('@lib/blob-store', () => ({
      makeKvStore: (storeName: string, fsDirName: string) => {
        return makeKvStore(storeName, fsDirName, { fsDirOverride: tmpDir })
      },
    }))
  })

  afterEach(async () => {
    vi.doUnmock('@lib/blob-store')
    vi.resetModules()
    await rm(tmpDir, { recursive: true, force: true })
  })

  // (e) setCheckin normalizes (adds events:[]) and caps events at 500 on write
  it('setCheckin caps events at 500 on write', async () => {
    const { setCheckin, getCheckin } = await import('@lib/checkin-store')

    // Build a state with 600 events
    const events = Array.from({ length: 600 }, (_, i) => ({
      at: new Date(Date.now() + i).toISOString(),
      action: 'checkin' as const,
      personIds: ['adult'],
    }))

    const state = {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      pickupCodeHash: null,
      events,
    }

    await setCheckin('party-cap', 'rec-cap', state)

    const loaded = await getCheckin('party-cap', 'rec-cap')
    expect(loaded.events).toHaveLength(500)
    // Should keep the LAST 500 (slice(-500))
    expect(loaded.events[0]).toEqual(events[100]) // first kept = index 100
    expect(loaded.events[499]).toEqual(events[599]) // last kept = index 599
  })

  it('setCheckin adds events:[] to a legacy blob without events field', async () => {
    const { setCheckin, getCheckin } = await import('@lib/checkin-store')

    const legacyState = {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      pickupCodeHash: null,
      // no events field
    } as any

    await setCheckin('party-legacy', 'rec-legacy', legacyState)
    const loaded = await getCheckin('party-legacy', 'rec-legacy')
    expect(loaded.events).toEqual([])
  })
})

// ─── toPublicCheckin does NOT include events ──────────────────────────────────

describe('toPublicCheckin', () => {
  it('does not include events in the public shape', async () => {
    vi.resetModules()
    const { toPublicCheckin } = await import('@lib/checkin-store')
    const state = {
      expected: null,
      presence: {},
      pickedUpBy: null,
      confirmedPickup: [],
      pickupCodeHash: null,
      events: [{ at: '2026-01-01T00:00:00.000Z', action: 'checkin' as const, personIds: ['adult'] }],
    }
    const pub = toPublicCheckin(state)
    expect((pub as any).events).toBeUndefined()
    expect(pub.hasPickupCode).toBe(false)
  })
})
