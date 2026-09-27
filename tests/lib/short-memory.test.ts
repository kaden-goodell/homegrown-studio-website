import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { remember, forgetAll } from '@lib/short-memory'

describe('remember', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'))
    forgetAll()
  })
  afterEach(() => vi.useRealTimers())

  it('asks once and answers the next caller from what it holds', async () => {
    const load = vi.fn().mockResolvedValue(['a'])
    expect(await remember('k', 1000, load)).toEqual(['a'])
    expect(await remember('k', 1000, load)).toEqual(['a'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('shares one lookup between callers that arrive together', async () => {
    const load = vi.fn().mockResolvedValue('x')
    await Promise.all([remember('k', 1000, load), remember('k', 1000, load), remember('k', 1000, load)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('asks again after the time is up', async () => {
    const load = vi.fn().mockResolvedValue('x')
    await remember('k', 1000, load)
    vi.setSystemTime(new Date('2026-10-01T12:00:01.001Z'))
    await remember('k', 1000, load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps different questions apart', async () => {
    expect(await remember('a', 1000, async () => 1)).toBe(1)
    expect(await remember('b', 1000, async () => 2)).toBe(2)
  })

  it('does not remember a failure', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('up')
    await expect(remember('k', 1000, load)).rejects.toThrow('down')
    expect(await remember('k', 1000, load)).toBe('up')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
