import { describe, it, expect, vi, afterEach } from 'vitest'
import { squareFetch, SQUARE_TIMEOUT_MS } from '@lib/classes/square-api'

afterEach(() => vi.unstubAllGlobals())

describe('squareFetch (M2)', () => {
  it('gives every call a time limit, so a function never hangs on Square', async () => {
    const seen: (AbortSignal | null | undefined)[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(init.signal)
      return new Response('{"ok":true}', { status: 200 })
    }))
    await squareFetch('/locations', { method: 'GET' })
    expect(seen[0]).toBeInstanceOf(AbortSignal)
    expect(seen[0]!.aborted).toBe(false)
    expect(SQUARE_TIMEOUT_MS).toBe(8_000)
  })

  it('a call that runs out of time throws like any other failure', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })))
    })))
    const ctl = new AbortController()
    const call = squareFetch('/orders/search', { method: 'POST', body: '{}', signal: ctl.signal })
    ctl.abort()
    await expect(call).rejects.toThrow(/timeout/)
  })
})
