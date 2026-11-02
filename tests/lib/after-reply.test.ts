import { describe, it, expect, vi } from 'vitest'
import { afterReply, waitUntilOf, withAfterReply } from '@lib/after-reply'

describe('afterReply (M7)', () => {
  it('with no waitUntil (tests, local, jobs) the work is simply awaited', async () => {
    const order: string[] = []
    await afterReply(async () => { order.push('work') })
    order.push('after')
    expect(order).toEqual(['work', 'after'])
  })

  it('inside a request with waitUntil the work is handed over and the caller doesn\'t wait for it', async () => {
    const handed: Promise<unknown>[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const done = vi.fn()
    await withAfterReply((p) => { handed.push(p) }, async () => {
      await afterReply(async () => { await gate; done() })
    })
    expect(handed).toHaveLength(1)
    expect(done).not.toHaveBeenCalled()
    release()
    await handed[0]
    expect(done).toHaveBeenCalled()
  })

  it('never throws, and reads Netlify\'s waitUntil from Astro locals', async () => {
    await expect(afterReply(async () => { throw new Error('boom') })).resolves.toBeUndefined()
    const ctx = { waitUntil: vi.fn() }
    const w = waitUntilOf({ netlify: { context: ctx } })!
    w(Promise.resolve())
    expect(ctx.waitUntil).toHaveBeenCalled()
    expect(waitUntilOf({})).toBeNull()
  })
})
