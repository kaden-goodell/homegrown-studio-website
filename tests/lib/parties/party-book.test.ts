import { describe, it, expect, vi, beforeEach } from 'vitest'

// The fs kv in tests has no etags, so give it real compare-and-swap: a version
// per key, each read and conditional write one atomic step (as on Netlify
// Blobs). Shared across module copies, so two copies of party-book act as two
// servers on one store. `failRead` makes every read throw (store down).
const cas = vi.hoisted(() => ({ versions: new Map<string, number>(), queues: new Map<string, Promise<unknown>>(), failRead: false, hang: false, writes: 0, lost: 0 }))
vi.mock('@lib/blob-store', async (orig) => {
  const real = await orig<typeof import('@lib/blob-store')>()
  const atomic = <T,>(k: string, fn: () => Promise<T>): Promise<T> => {
    const run = (cas.queues.get(k) ?? Promise.resolve()).then(fn, fn)
    cas.queues.set(k, run.catch(() => undefined))
    return run
  }
  return {
    ...real,
    makeKvStore: (...a: Parameters<typeof real.makeKvStore>) => {
      const kv = real.makeKvStore(...a)
      const id = (k: string) => `${a[0]}/${k}`
      const version = (k: string) => String(cas.versions.get(id(k)) ?? 0)
      const bump = (k: string) => cas.versions.set(id(k), (cas.versions.get(id(k)) ?? 0) + 1)
      return {
        ...kv,
        get: (k: string) => atomic(id(k), async () => { if (cas.failRead) throw new Error('blob store down'); return kv.get(k) }),
        getWithMeta: (k: string) => cas.hang ? (cas.hang = false, new Promise<never>(() => {})) : atomic(id(k), async () => {
          if (cas.failRead) throw new Error('blob store down')
          return { value: await kv.get(k), etag: version(k) }
        }),
        setIfMatch: (k: string, json: string, etag: string | null) => atomic(id(k), async () => {
          if (version(k) !== etag) { cas.lost++; return false }
          await kv.set(k, json)
          bump(k)
          cas.writes++
          return true
        }),
        set: (k: string, json: string) => atomic(id(k), async () => { await kv.set(k, json); bump(k) }),
      }
    },
  }
})

import { holdsBetween, holdTime, confirmTime, extendHold, releaseTime, resizeTime, moveTime, _setStoreTimeoutMs } from '@lib/parties/party-book'
import { localToUtcISO } from '@lib/parties/party-times'
import type { Busy } from '@lib/classes/studio-schedule'

const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
// Real now: confirmTime judges other holds by the real clock.
const NOW = new Date()
const later = (min: number) => new Date(NOW.getTime() + min * 60_000)
let n = 0
const pid = () => `pty_t${++n}`
const hold = (partyId: string, ymd: string, start: string, end: string, others: Busy[] = [], ttl: number | null = 10, now = NOW) =>
  holdTime({ partyId, startIso: at(ymd, start), endIso: at(ymd, end), ttlMinutes: ttl }, others, now)
const dayOf = (ymd: string) => [at(ymd, '00:00'), at(ymd, '23:59')] as const

beforeEach(() => { cas.failRead = false; cas.hang = false })

// Each test uses its own far-future Sunday so the shared month docs don't collide.
describe('party book', () => {
  it('a hold shows in holdsBetween; a replay of the same party and start is ok', async () => {
    const d = '2031-01-05', p = pid()
    expect(await hold(p, d, '13:00', '14:30')).toEqual({ ok: true, replay: false })
    const list = await holdsBetween(...dayOf(d), NOW)
    expect(list).toEqual([expect.objectContaining({ partyId: p, startIso: at(d, '13:00'), endIso: at(d, '14:30'), state: 'held', holdExpiresAt: later(10).toISOString() })])
    expect(await hold(p, d, '13:00', '14:30')).toEqual({ ok: true, replay: true })
    expect(await holdsBetween(...dayOf(d), NOW)).toHaveLength(1)
  })

  it('concurrent holds: two servers racing for the same start, exactly one wins', async () => {
    const d = '2031-01-12'
    vi.resetModules()
    const serverA = await import('@lib/parties/party-book')
    vi.resetModules()
    const serverB = await import('@lib/parties/party-book')
    expect(serverA.holdTime).not.toBe(serverB.holdTime) // two module copies: no shared in-process lock
    const writesBefore = cas.writes, lostBefore = cas.lost
    const [a, b] = await Promise.all([
      serverA.holdTime({ partyId: 'pty_a', startIso: at(d, '13:00'), endIso: at(d, '14:30'), ttlMinutes: 10 }, [], NOW),
      serverB.holdTime({ partyId: 'pty_b', startIso: at(d, '13:00'), endIso: at(d, '14:30'), ttlMinutes: 10 }, [], NOW),
    ])
    const wins = [a, b].filter((r) => r.ok)
    const lost = [a, b].filter((r) => !r.ok)
    expect(wins).toHaveLength(1)
    expect(lost).toEqual([{ ok: false, reason: 'taken', message: expect.stringMatching(/just taken/) }])
    expect(cas.writes - writesBefore).toBe(1)
    expect(cas.lost - lostBefore).toBe(1) // the loser's conditional write really failed, then it re-read
    expect(await holdsBetween(...dayOf(d), NOW)).toHaveLength(1)
  })

  it('concurrent holds in one server: one wins, the other is taken', async () => {
    const d = '2031-01-19'
    const [a, b] = await Promise.all([hold('pty_c1', d, '13:00', '14:30'), hold('pty_c2', d, '13:30', '15:30')])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(await holdsBetween(...dayOf(d), NOW)).toHaveLength(1)
  })

  it('a 1:00 and a 3:30 party on one Sunday both fit (150-minute step)', async () => {
    const d = '2031-01-26'
    expect((await hold(pid(), d, '13:00', '14:30')).ok).toBe(true)
    expect((await hold(pid(), d, '15:30', '17:00')).ok).toBe(true)
    expect(await holdsBetween(...dayOf(d), NOW)).toHaveLength(2)
  })

  it('extra time clashes: 1:00 with 30 extra (ends 3:00, + 60) refuses 3:30, and the other way round', async () => {
    const d = '2031-02-02'
    expect((await hold(pid(), d, '13:00', '15:00')).ok).toBe(true) // 90 min + 30 extra
    const r = await hold(pid(), d, '15:30', '17:00')
    expect(r).toEqual({ ok: false, reason: 'taken', message: expect.any(String) })

    const d2 = '2031-02-09'
    expect((await hold(pid(), d2, '15:30', '17:00')).ok).toBe(true)
    expect((await hold(pid(), d2, '13:00', '15:00')).ok).toBe(false)
    expect((await hold(pid(), d2, '13:00', '14:30')).ok).toBe(true)
  })

  it('a clash with something else (a class) is a "clash" naming it', async () => {
    const d = '2031-02-16'
    const cls: Busy = { kind: 'class', id: 'cls_x', label: 'Pottery Night', startIso: at(d, '15:00'), endIso: at(d, '17:00') }
    const r = await hold(pid(), d, '13:00', '14:30', [cls])
    expect(r).toEqual({ ok: false, reason: 'clash', message: expect.stringContaining('Pottery Night') })
    expect(await holdsBetween(...dayOf(d), NOW)).toEqual([])
  })

  it('party candidate keeps 60 minutes from blocked time (R11)', async () => {
    const d = '2031-02-23'
    const blk: Busy = { kind: 'blocked', id: 'blk_x', label: 'Deep clean', startIso: at(d, '16:00'), endIso: at(d, '17:00') }
    expect((await hold(pid(), d, '13:00', '15:01', [blk])).ok).toBe(false)
    expect((await hold(pid(), d, '13:00', '15:00', [blk])).ok).toBe(true)
  })

  it('no party crosses midnight: a hold whose end + 60 passes local midnight is refused', async () => {
    const d = '2031-03-02'
    const r = await hold(pid(), d, '21:00', '23:30')
    expect(r).toEqual({ ok: false, reason: 'clash', message: 'A party and its hour of cleanup have to finish by midnight.' })
    expect((await hold(pid(), d, '21:00', '23:00')).ok).toBe(true)
  })

  it('an expired hold frees the time; a booked one never expires', async () => {
    const d = '2031-03-09', p = pid()
    await hold(p, d, '13:00', '14:30')
    expect(await holdsBetween(...dayOf(d), later(10))).toEqual([])
    expect((await hold(pid(), d, '13:00', '14:30', [], 10, later(10))).ok).toBe(true)

    const d2 = '2031-03-16', q = pid()
    await hold(q, d2, '13:00', '14:30')
    await confirmTime(q, at(d2, '13:00'), at(d2, '14:30'))
    expect(await holdsBetween(...dayOf(d2), later(60 * 24 * 365))).toEqual([expect.objectContaining({ partyId: q, state: 'booked', holdExpiresAt: null })])
  })

  it('a link hold (ttl null) never expires', async () => {
    const d = '2031-03-23', p = pid()
    await hold(p, d, '13:00', '14:30', [], null)
    expect(await holdsBetween(...dayOf(d), later(60 * 24 * 30))).toEqual([expect.objectContaining({ partyId: p, state: 'held', holdExpiresAt: null })])
  })

  it('confirm keeps the time; confirming twice is fine', async () => {
    const d = '2031-03-30', p = pid()
    await hold(p, d, '13:00', '14:30')
    expect(await confirmTime(p, at(d, '13:00'), at(d, '14:30'))).toEqual({ overlap: false })
    expect(await confirmTime(p, at(d, '13:00'), at(d, '14:30'))).toEqual({ overlap: false })
    expect((await hold(pid(), d, '13:00', '14:30')).ok).toBe(false)
  })

  it('confirm after the hold ran out and the time was resold: recorded as booked, overlap reported, never throws (R6)', async () => {
    const d = '2031-04-06', p = pid(), other = pid()
    await hold(p, d, '13:00', '14:30')
    expect((await hold(other, d, '13:00', '14:30', [], 10, later(11))).ok).toBe(true) // sweeps p's expired hold
    expect(await confirmTime(p, at(d, '13:00'), at(d, '14:30'), later(11))).toEqual({ overlap: true })
    const list = await holdsBetween(...dayOf(d), later(11))
    expect(list.map((h) => [h.partyId, h.state]).sort()).toEqual([[other, 'held'], [p, 'booked']].sort())
  })

  it('confirm of a lost hold with no rival re-creates it as booked', async () => {
    const d = '2031-04-13', p = pid()
    expect(await confirmTime(p, at(d, '13:00'), at(d, '14:30'))).toEqual({ overlap: false })
    expect(await holdsBetween(...dayOf(d), NOW)).toEqual([expect.objectContaining({ partyId: p, state: 'booked' })])
  })

  it('extendHold keeps an unknown-outcome hold 24 hours (R15)', async () => {
    const d = '2031-04-20', p = pid()
    await hold(p, d, '13:00', '14:30')
    expect(await extendHold(p, at(d, '13:00'), later(24 * 60).toISOString(), at(d, '14:30'))).toEqual({ held: true })
    expect(await holdsBetween(...dayOf(d), later(60))).toHaveLength(1)
    expect((await hold(pid(), d, '13:00', '14:30', [], 10, later(60))).ok).toBe(false)
    expect(await holdsBetween(...dayOf(d), later(24 * 60))).toEqual([])
  })

  it('release frees the time (held or booked)', async () => {
    const d = '2031-04-27', p = pid(), q = pid()
    await hold(p, d, '13:00', '14:30')
    await releaseTime(p, at(d, '13:00'))
    expect(await holdsBetween(...dayOf(d), NOW)).toEqual([])
    await hold(q, d, '13:00', '14:30')
    await confirmTime(q, at(d, '13:00'), at(d, '14:30'))
    await releaseTime(q, at(d, '13:00'))
    expect((await hold(pid(), d, '13:00', '14:30')).ok).toBe(true)
  })

  it('resize: refused on a clash, allowed when free', async () => {
    const d = '2031-05-04', p = pid()
    await hold(p, d, '13:00', '14:30')
    await hold(pid(), d, '15:30', '17:00')
    const r = await resizeTime(p, at(d, '13:00'), at(d, '15:30'), [], NOW)
    expect(r).toEqual({ ok: false, message: expect.any(String) })
    expect(await resizeTime(p, at(d, '13:00'), at(d, '14:00'), [], NOW)).toEqual({ ok: true })
    const mine = (await holdsBetween(...dayOf(d), NOW)).find((h) => h.partyId === p)!
    expect(mine.endIso).toBe(at(d, '14:00'))
    // a class later on clashes with a longer party
    const cls: Busy = { kind: 'class', id: 'cls_y', label: 'Candles', startIso: at('2031-05-11', '16:00'), endIso: at('2031-05-11', '17:00') }
    const q = pid()
    await hold(q, '2031-05-11', '13:00', '14:00')
    expect(await resizeTime(q, at('2031-05-11', '13:00'), at('2031-05-11', '15:30'), [cls], NOW)).toEqual({ ok: false, message: expect.stringContaining('Candles') })
    expect(await resizeTime(q, at('2031-05-11', '13:00'), at('2031-05-11', '15:00'), [cls], NOW)).toEqual({ ok: true })
  })

  it('resize past midnight is refused', async () => {
    const d = '2031-05-18', p = pid()
    await hold(p, d, '20:00', '22:00')
    expect(await resizeTime(p, at(d, '20:00'), at(d, '23:30'), [], NOW)).toEqual({ ok: false, message: expect.stringMatching(/midnight/) })
  })

  it('move within a month: new hold written (state kept), old one released by the caller', async () => {
    const d = '2031-05-25', p = pid()
    await hold(p, d, '13:00', '14:30')
    await confirmTime(p, at(d, '13:00'), at(d, '14:30'))
    // the party moving over its own old time is not a clash with itself
    expect(await moveTime(p, { startIso: at(d, '13:00') }, { startIso: at(d, '14:00'), endIso: at(d, '16:00') }, [], NOW)).toEqual({ ok: true })
    let list = await holdsBetween(...dayOf(d), NOW)
    expect(list.map((h) => [h.startIso, h.state])).toEqual([[at(d, '13:00'), 'booked'], [at(d, '14:00'), 'booked']])
    await releaseTime(p, at(d, '13:00'))
    list = await holdsBetween(...dayOf(d), NOW)
    expect(list).toEqual([expect.objectContaining({ partyId: p, startIso: at(d, '14:00'), state: 'booked' })])
  })

  it('move refused onto a taken time; and a party with no time cannot move', async () => {
    const d = '2031-06-01', p = pid()
    await hold(p, d, '13:00', '14:30')
    await hold(pid(), d, '15:30', '17:00')
    expect(await moveTime(p, { startIso: at(d, '13:00') }, { startIso: at(d, '15:30'), endIso: at(d, '17:30') }, [], NOW)).toEqual({ ok: false, message: expect.any(String) })
    expect(await moveTime(pid(), { startIso: at(d, '13:00') }, { startIso: at(d, '18:00'), endIso: at(d, '20:00') }, [], NOW)).toEqual({ ok: false, message: expect.any(String) })
  })

  it('move Oct → Nov writes the new month first', async () => {
    const p = pid()
    await hold(p, '2032-10-31', '13:00', '14:30')
    await confirmTime(p, at('2032-10-31', '13:00'), at('2032-10-31', '14:30'))
    expect(await moveTime(p, { startIso: at('2032-10-31', '13:00') }, { startIso: at('2032-11-07', '13:00'), endIso: at('2032-11-07', '15:00') }, [], NOW)).toEqual({ ok: true })
    await releaseTime(p, at('2032-10-31', '13:00'))
    expect(await holdsBetween(...dayOf('2032-10-31'), NOW)).toEqual([])
    expect(await holdsBetween(...dayOf('2032-11-07'), NOW)).toEqual([expect.objectContaining({ partyId: p, state: 'booked' })])
    // holdsBetween across both months
    expect(await holdsBetween(at('2032-10-25', '00:00'), at('2032-11-10', '00:00'), NOW)).toHaveLength(1)
  })

  it('Sun Nov 1 2026 (clock change): real instants, 1:00 PM CST', async () => {
    const p = pid()
    expect((await hold(p, '2026-11-01', '13:00', '14:30')).ok).toBe(true)
    const [h] = await holdsBetween(...dayOf('2026-11-01'), NOW)
    expect(h.startIso).toBe('2026-11-01T19:00:00.000Z') // CST = UTC−6 after 2 AM
    expect(h.endIso).toBe('2026-11-01T20:30:00.000Z')
    // a 3:30 still fits after the 1:00 (exactly the hour's cleanup), a 3:29 does not
    expect((await hold(pid(), '2026-11-01', '15:29', '16:59')).ok).toBe(false)
    expect((await hold(pid(), '2026-11-01', '15:30', '17:00')).ok).toBe(true)
    await releaseTime(p, h.startIso)
  })

  it('a read error throws instead of reporting the time free', async () => {
    cas.failRead = true
    await expect(holdsBetween(...dayOf('2031-06-08'), NOW)).rejects.toThrow()
    await expect(hold(pid(), '2031-06-08', '13:00', '14:30')).rejects.toThrow()
  })

  it('refuses a start not before its end', async () => {
    await expect(hold(pid(), '2031-06-15', '15:00', '15:00')).rejects.toThrow()
  })

  // ---- fix round 1: holds only grow; same-start moves refused; confirm needs the end

  it('concurrent holds: two servers racing for 1:00 and 1:30, exactly one wins', async () => {
    const d = '2031-07-06'
    vi.resetModules()
    const serverA = await import('@lib/parties/party-book')
    vi.resetModules()
    const serverB = await import('@lib/parties/party-book')
    const lostBefore = cas.lost
    const [a, b] = await Promise.all([
      serverA.holdTime({ partyId: 'pty_one', startIso: at(d, '13:00'), endIso: at(d, '14:30'), ttlMinutes: 10 }, [], NOW),
      serverB.holdTime({ partyId: 'pty_half', startIso: at(d, '13:30'), endIso: at(d, '15:00'), ttlMinutes: 10 }, [], NOW),
    ])
    expect([a, b].filter((r) => r.ok)).toHaveLength(1)
    expect([a, b].filter((r) => !r.ok)).toEqual([{ ok: false, reason: 'taken', message: expect.stringMatching(/just taken/) }])
    expect(cas.lost - lostBefore).toBe(1)
    expect(await holdsBetween(...dayOf(d), NOW)).toHaveLength(1)
  })

  it('a move to the party\'s own start is refused, and its hold stays', async () => {
    const d = '2031-07-13', p = pid()
    await hold(p, d, '13:00', '14:30')
    await confirmTime(p, at(d, '13:00'), at(d, '14:30'))
    expect(await moveTime(p, { startIso: at(d, '13:00') }, { startIso: at(d, '13:00'), endIso: at(d, '15:00') }, [], NOW))
      .toEqual({ ok: false, message: "That's already this party's time." })
    expect(await holdsBetween(...dayOf(d), NOW)).toEqual([expect.objectContaining({ partyId: p, endIso: at(d, '14:30'), state: 'booked' })])
  })

  it('a stale copy of a book party in "others" never decides: the locked doc does', async () => {
    const d = '2031-07-20', p = pid()
    const stale: Busy = { kind: 'party', id: 'pty_gone', label: 'a party', startIso: at(d, '13:00'), endIso: at(d, '14:30'), party: { state: 'held', partyId: 'pty_gone' } }
    expect((await hold(p, d, '13:00', '14:30', [stale])).ok).toBe(true) // released since; the doc is free
    const rival = await hold(pid(), d, '13:30', '15:00', [])
    expect(rival).toEqual({ ok: false, reason: 'taken', message: expect.stringMatching(/just taken/) })
  })

  it('a repeat hold only grows: a later end (rechecked) and a longer expiry are kept, never shorter', async () => {
    const d = '2031-07-27', p = pid()
    await hold(p, d, '13:00', '14:30', [], 10)
    // replayed as a payment link: no expiry now
    expect(await hold(p, d, '13:00', '14:30', [], null)).toEqual({ ok: true, replay: true })
    expect(await holdsBetween(...dayOf(d), later(60 * 24))).toEqual([expect.objectContaining({ partyId: p, holdExpiresAt: null })])
    // a 10-min replay does not shorten it
    await hold(p, d, '13:00', '14:30', [], 10)
    expect((await holdsBetween(...dayOf(d), later(60)))[0].holdExpiresAt).toBeNull()
    // a later end is kept; a shorter end is ignored
    expect(await hold(p, d, '13:00', '15:00')).toEqual({ ok: true, replay: true })
    expect(await hold(p, d, '13:00', '14:00')).toEqual({ ok: true, replay: true })
    expect((await holdsBetween(...dayOf(d), NOW))[0].endIso).toBe(at(d, '15:00'))
    // a later end that clashes is refused
    await hold(pid(), d, '16:00', '17:30')
    expect(await hold(p, d, '13:00', '15:30')).toEqual({ ok: false, reason: 'taken', message: expect.any(String) })
    expect((await holdsBetween(...dayOf(d), NOW)).find((h) => h.partyId === p)!.endIso).toBe(at(d, '15:00'))
  })

  it('extendHold never shortens, keeps a payment-link hold with no expiry, and null means no expiry', async () => {
    const d = '2031-08-03', p = pid(), link = pid()
    await hold(p, d, '13:00', '14:30', [], 60)
    expect(await extendHold(p, at(d, '13:00'), later(5).toISOString(), at(d, '14:30'))).toEqual({ held: true })
    expect((await holdsBetween(...dayOf(d), later(30))).map((h) => h.partyId)).toEqual([p]) // still the 60-min expiry
    // unclear outcome: held until an owner sorts it out
    expect(await extendHold(p, at(d, '13:00'), null, at(d, '14:30'))).toEqual({ held: true })
    expect(await holdsBetween(...dayOf(d), later(60 * 24 * 7))).toEqual([expect.objectContaining({ partyId: p, holdExpiresAt: null })])
    // a payment link's hold never expires; a 24 h extension leaves it so
    await hold(link, d, '15:30', '17:00', [], null)
    expect(await extendHold(link, at(d, '15:30'), later(24 * 60).toISOString(), at(d, '17:00'))).toEqual({ held: true })
    expect((await holdsBetween(...dayOf(d), later(60 * 24 * 7))).find((h) => h.partyId === link)!.holdExpiresAt).toBeNull()
  })

  it('extendHold puts back a hold that ran out when nothing clashes, and says when it cannot', async () => {
    const d = '2031-08-10', p = pid(), q = pid()
    await hold(p, d, '13:00', '14:30')
    expect(await holdsBetween(...dayOf(d), later(11))).toEqual([])
    expect(await extendHold(p, at(d, '13:00'), later(24 * 60).toISOString(), at(d, '14:30'), later(11))).toEqual({ held: true })
    expect(await holdsBetween(...dayOf(d), later(60))).toEqual([expect.objectContaining({ partyId: p, state: 'held' })])
    // gone entirely and resold meanwhile
    await hold(q, d, '15:30', '17:00')
    await releaseTime(q, at(d, '15:30'))
    await hold(pid(), d, '15:30', '17:00')
    expect(await extendHold(q, at(d, '15:30'), null, at(d, '17:00'))).toEqual({ held: false, clash: expect.stringMatching(/just taken/) })
    // a booked time is already kept
    await confirmTime(p, at(d, '13:00'), at(d, '14:30'))
    expect(await extendHold(p, at(d, '13:00'), later(5).toISOString(), at(d, '14:30'))).toEqual({ held: true })
  })

  it('confirm never shortens a hold; it keeps the later end', async () => {
    const d = '2031-08-17', p = pid()
    await hold(p, d, '13:00', '15:00')
    expect(await confirmTime(p, at(d, '13:00'), at(d, '14:30'))).toEqual({ overlap: false })
    expect(await holdsBetween(...dayOf(d), NOW)).toEqual([expect.objectContaining({ state: 'booked', endIso: at(d, '15:00') })])
  })

  it('a store call that never answers times out and frees the month for the next write', async () => {
    const d = '2031-08-24'
    _setStoreTimeoutMs(50)
    try {
      cas.hang = true
      await expect(hold(pid(), d, '13:00', '14:30')).rejects.toThrow(/did not answer/)
      expect((await hold(pid(), d, '13:00', '14:30')).ok).toBe(true)
    } finally {
      _setStoreTimeoutMs(10_000)
    }
  })
})
