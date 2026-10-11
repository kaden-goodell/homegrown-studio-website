import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.doUnmock('@netlify/blobs'); vi.resetModules(); vi.unstubAllEnvs() })

describe('blob store handles (11 Oct 2026: "Token expired")', () => {
  it('opens a fresh store handle for each operation, so an expired token is never reused', async () => {
    vi.stubEnv('NETLIFY', 'true')
    let made = 0
    const getStore = vi.fn(() => {
      const n = ++made
      // Each handle works for its own request only; reusing one later fails.
      let uses = 0
      return {
        get: vi.fn(async () => {
          uses++
          if (uses > 2) throw new Error(`Netlify Blobs has generated an internal error (Failed to decode token: Token expired) [handle ${n}]`)
          return null
        }),
        getWithMetadata: vi.fn(async () => null),
        setJSON: vi.fn(), set: vi.fn(), delete: vi.fn(), list: vi.fn(async () => ({ blobs: [] })),
      }
    })
    vi.doMock('@netlify/blobs', () => ({ getStore }))
    const { makeKvStore } = await import('@lib/blob-store')
    const kv = makeKvStore('event-meta', 'event-meta')
    for (let i = 0; i < 5; i++) await expect(kv.get(`k${i}`)).resolves.toBeNull()
    expect(getStore.mock.calls.length).toBeGreaterThanOrEqual(5)
  })
})
