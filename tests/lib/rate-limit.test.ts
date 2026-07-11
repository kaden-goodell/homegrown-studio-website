import { describe, it, expect, vi } from 'vitest'
import { rateLimited } from '@lib/rate-limit'

describe('rateLimited', () => {
  it('allows up to max hits within the window', () => {
    const now = Date.now()
    for (let i = 0; i < 10; i++) {
      expect(rateLimited('test-allow', 10, 60_000, now + i)).toBe(false)
    }
  })

  it('blocks the 11th hit within the window', () => {
    const now = Date.now()
    const key = 'test-block-11th'
    for (let i = 0; i < 10; i++) {
      rateLimited(key, 10, 60_000, now + i)
    }
    expect(rateLimited(key, 10, 60_000, now + 10)).toBe(true)
  })

  it('separate keys are independent', () => {
    const now = Date.now()
    const keyA = 'test-independent-a'
    const keyB = 'test-independent-b'
    // Exhaust key A
    for (let i = 0; i < 10; i++) {
      rateLimited(keyA, 10, 60_000, now + i)
    }
    // Key B should still be free
    expect(rateLimited(keyB, 10, 60_000, now)).toBe(false)
  })

  it('window slides: old hits drop out and new ones are allowed', () => {
    const now = Date.now()
    const key = 'test-sliding'
    const windowMs = 60_000
    // Fill up the window at t=0
    for (let i = 0; i < 10; i++) {
      rateLimited(key, 10, windowMs, now + i)
    }
    // At t=0+10ms still blocked (all 10 hits within window)
    expect(rateLimited(key, 10, windowMs, now + 10)).toBe(true)

    // Advance time past the window so the initial hits expire
    const later = now + windowMs + 1
    // First hit in the new window should be allowed
    expect(rateLimited(key, 10, windowMs, later)).toBe(false)
  })

  it('memory guard evicts expired keys without resetting active limits', async () => {
    // Fresh module so the private hits map starts empty and sizes are exact.
    vi.resetModules()
    const { rateLimited: rl } = (await import('@lib/rate-limit')) as typeof import('@lib/rate-limit')

    const windowMs = 60_000
    const t0 = Date.now()
    // 9,999 stale keys hit once at t0.
    for (let i = 0; i < 9_999; i++) {
      rl(`stale-${i}`, 10, windowMs, t0)
    }
    // One active key maxed out at t1 (a full window later, so the stale keys
    // have aged out but this one hasn't). Map size is now exactly 10,000.
    const t1 = t0 + windowMs
    for (let i = 0; i < 10; i++) {
      rl('active', 10, windowMs, t1)
    }
    // The 10,001st key pushes past the guard and triggers eviction.
    expect(rl('trigger', 10, windowMs, t1)).toBe(false)
    // The active key's limit must survive eviction — 11th hit still blocked.
    expect(rl('active', 10, windowMs, t1)).toBe(true)
    // And an evicted stale key behaves as brand new.
    expect(rl('stale-0', 10, windowMs, t1)).toBe(false)
  })
})
