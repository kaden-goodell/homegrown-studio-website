// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { CAS_ATTEMPTS, _setCasSleepForTests, casDelayMs, casPause, casRetry } from '@lib/cas-retry'

describe('shared CAS retry (I-7)', () => {
  afterEach(() => _setCasSleepForTests())

  it('tries 6–8 times with a jittered pause between tries, none before the first', async () => {
    expect(CAS_ATTEMPTS).toBeGreaterThanOrEqual(6)
    expect(CAS_ATTEMPTS).toBeLessThanOrEqual(8)
    expect(casDelayMs(0)).toBe(0)
    for (let a = 1; a < CAS_ATTEMPTS; a++) {
      expect(casDelayMs(a, () => 0)).toBe(10)
      expect(casDelayMs(a, () => 1)).toBeLessThanOrEqual(150)
    }
    expect(casDelayMs(1, () => 0.5)).not.toBe(casDelayMs(5, () => 0.9))
    const slept: number[] = []
    _setCasSleepForTests(async (ms) => { slept.push(ms) })
    await casPause(0)
    await casPause(3)
    expect(slept).toHaveLength(1)
  })

  it('casRetry stops at the first landed write and gives up after CAS_ATTEMPTS', async () => {
    let n = 0
    expect(await casRetry(async () => (++n === 4 ? { done: true, value: 'ok' } : { done: false }))).toBe('ok')
    expect(n).toBe(4)
    n = 0
    await expect(casRetry(async () => { n++; return { done: false } })).rejects.toThrow(/retry/)
    expect(n).toBe(CAS_ATTEMPTS)
  })
})
