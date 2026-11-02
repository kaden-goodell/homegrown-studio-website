/**
 * The per-party lock across servers (T12 review m1, m2): a store that honours
 * etags the way Netlify Blobs does (compare-and-set), shared by two separate
 * copies of party-lock.ts standing in for two servers. Covers: one at a time
 * across servers, the heartbeat keeping a long action's lease (a Netlify
 * function may run 60 s, longer than the 30 s lease), a dead server's lease
 * freeing itself, and fencing (a holder whose lease was taken over never
 * writes).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const store = vi.hoisted(() => {
  const data = new Map<string, { value: string; etag: string }>()
  let n = 0
  /** `delay`: ms each store call takes; `down`: every store call throws (the store unreachable) */
  const io = { delay: 0, down: false }
  const wait = async () => {
    if (io.delay) await new Promise((r) => setTimeout(r, io.delay))
    if (io.down) throw new Error('store timed out')
  }
  return {
    data,
    io,
    kv: {
      async get(k: string) { await wait(); return data.get(k)?.value ?? null },
      async getWithMeta(k: string) { await wait(); const d = data.get(k); return { value: d?.value ?? null, etag: d?.etag ?? null } },
      async setIfMatch(k: string, json: string, etag: string | null, exists: boolean) {
        await wait()
        const cur = data.get(k)
        if (exists ? cur?.etag !== etag : !!cur) return false
        data.set(k, { value: json, etag: `e${++n}` })
        return true
      },
      async set(k: string, json: string) { data.set(k, { value: json, etag: `e${++n}` }) },
      async delete(k: string) { data.delete(k) },
      async list() { return [...data.keys()] },
    },
  }
})
vi.mock('@lib/blob-store', () => ({ makeKvStore: () => store.kv }))

type Lock = typeof import('@lib/parties/party-lock')
async function server(): Promise<Lock> {
  vi.resetModules()
  const lock = await import('@lib/parties/party-lock')
  lock._setPartyLockWaitMs(3_000)
  lock._setPartyLockTimes({ leaseMs: 300, renewMs: 60 })
  return lock
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('party lock across two servers', () => {
  afterEach(() => { store.io.delay = 0; store.io.down = false })

  it('interleaved changes of one party on two servers run one at a time; all finish', async () => {
    const [a, b] = [await server(), await server()]
    let running = 0
    let most = 0
    const job = async () => { running++; most = Math.max(most, running); await sleep(5); running-- }
    await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? a : b).withPartyLock('pty_one', job)))
    expect(most).toBe(1)
  })

  it('an action longer than the lease keeps it (heartbeat): the other server waits instead of running alongside', async () => {
    const [a, b] = [await server(), await server()]
    const order: string[] = []
    const long = a.withPartyLock('pty_long', async () => { order.push('a start'); await sleep(900); await a.assertPartyLockHeld(); order.push('a end') })
    await sleep(50)
    const other = b.withPartyLock('pty_long', async () => { order.push('b') })
    await Promise.all([long, other])
    expect(order).toEqual(['a start', 'a end', 'b'])
  })

  it('a server that died holding the lease (no heartbeat): it frees itself after the lease time', async () => {
    const b = await server()
    store.data.set('lock-pty_dead', { value: JSON.stringify({ token: 'dead-server', until: Date.now() + 300 }), etag: 'dead' })
    const t0 = Date.now()
    await b.withPartyLock('pty_dead', async () => undefined)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250)
  })

  it('fencing: a holder whose lease was taken over is refused before it writes, with words that say it stopped', async () => {
    const a = await server()
    const out = a.withPartyLock('pty_fence', async () => {
      // Another server took the lease (this one's heartbeat couldn't reach the store for a whole lease).
      store.data.set('lock-pty_fence', { value: JSON.stringify({ token: 'someone-else', until: Date.now() + 10_000 }), etag: 'x' })
      await a.assertPartyLockHeld()
      return 'wrote'
    })
    await expect(out).rejects.toThrow('Someone else started changing this party at the same moment, so this stopped. Open the party again to check it, then try again.')
    await expect(out).rejects.toBeInstanceOf(a.PartyLockLostError)
    // Its release leaves the other server's lease alone.
    expect(JSON.parse(store.data.get('lock-pty_fence')!.value).token).toBe('someone-else')
  })

  it('outside a lock, the fencing check does nothing', async () => {
    const a = await server()
    await expect(a.assertPartyLockHeld()).resolves.toBeUndefined()
  })

  it('N2a: the heartbeat and fencing checks on one holder never race each other into a false "someone else" refusal', async () => {
    const a = await server()
    a._setPartyLockTimes({ leaseMs: 2_000, renewMs: 15 })
    store.io.delay = 10 // a slow store: every renewal overlaps the next heartbeat
    let checks = 0
    await a.withPartyLock('pty_race', async () => {
      for (let i = 0; i < 25; i++) {
        await a.assertPartyLockHeld()
        checks++
        expect(a.partyLockTaken()).toBe(false)
      }
    })
    expect(checks).toBe(25)
    // Released cleanly: the next request gets it at once.
    store.io.delay = 0
    await expect(a.withPartyLock('pty_race', async () => 'next')).resolves.toBe('next')
  })

  it('N2b: the store unreachable: fencing lets a write through only while the last good renewal is fresher than the lease', async () => {
    const a = await server()
    a._setPartyLockTimes({ leaseMs: 300, renewMs: 10_000 })
    const out = a.withPartyLock('pty_down', async () => {
      store.io.down = true
      await a.assertPartyLockHeld() // just renewed when acquired: still surely ours
      await sleep(350) // longer than the lease with no renewal
      await a.assertPartyLockHeld()
      return 'wrote'
    })
    const err = await out.catch((e) => e)
    expect(err).toBeInstanceOf(a.PartyLockLostError)
    expect(err.reason).toBe('unreachable')
    expect(err.message).toBe('The party couldn’t be reached for a while, so this stopped to be safe. Open the party again to check it, then try again.')
  })

  it('N2c: after the lease was really taken, partyLockTaken() says so (callers skip their cleanup writes)', async () => {
    const a = await server()
    let taken: boolean | null = null
    await a.withPartyLock('pty_taken', async () => {
      store.data.set('lock-pty_taken', { value: JSON.stringify({ token: 'other', until: Date.now() + 10_000 }), etag: 'o' })
      await a.assertPartyLockHeld().catch(() => undefined)
      taken = a.partyLockTaken()
    })
    expect(taken).toBe(true)
    expect(a.partyLockTaken()).toBe(false) // outside a lock
  })
})
