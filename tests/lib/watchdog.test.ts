import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runWatchdog, liveChecks, strikesNeeded } from '@lib/watchdog'
import { _setIncidentDeps } from '@lib/booking-alarms'
import { watchdogDue } from '../../src/pages/api/jobs/alerts-tick.json'
import { WATCHDOG_EVERY_MINUTES } from '@config/alerts'
import { memoryKv } from '../helpers-memory-kv'

let texts: string[]
let kv: ReturnType<typeof memoryKv>
beforeEach(() => {
  texts = []
  kv = memoryKv()
  _setIncidentDeps({ store: kv, send: async (_t, c) => { texts.push(c) }, now: () => new Date('2026-11-20T00:00:00Z'), phone: () => '+1', secret: () => 's' })
})
afterEach(() => _setIncidentDeps(null))

const DAY = new Date('2026-11-20T18:00:00Z') // noon studio time
const NIGHT = new Date('2026-11-23T08:00:00Z') // 2 AM studio time
const ok = { name: 'Class list', run: async () => {} }
const bad = { name: 'Square', run: async () => { throw new Error('answered 503') } }

describe('the robot customer', () => {
  it('one failed run is quiet; two in a row texts; a good run sends Fixed', async () => {
    expect((await runWatchdog([ok, bad], kv, DAY)).texted).toBe(false)
    expect(texts).toHaveLength(0)
    const second = await runWatchdog([ok, bad], kv, DAY)
    expect(second.texted).toBe(true)
    expect(texts[0]).toMatch(/^BOOKING CHECK FAILING \(2 checks in a row\): Square: answered 503\. Customers may not be able to book\./)
    await runWatchdog([ok, bad], kv, DAY)
    expect(texts).toHaveLength(1) // still open: no new text (the sweep repeats it)
    expect((await runWatchdog([ok], kv, DAY)).ok).toBe(true)
    expect(texts[1]).toBe('Fixed: the booking check passes again. Booking is working.')
  })

  it('a blip that recovers never texts', async () => {
    await runWatchdog([bad], kv, DAY)
    await runWatchdog([ok], kv, DAY)
    await runWatchdog([bad], kv, DAY)
    expect(texts).toHaveLength(0)
  })

  it('checks the public class list with a short timeout', async () => {
    const ask = vi.fn().mockResolvedValue(new Response(JSON.stringify({ workshops: [] }), { status: 200 }))
    await liveChecks('https://ourhometownstudio.com/', ask as any)[0].run()
    expect(ask.mock.calls[0][0]).toBe('https://ourhometownstudio.com/api/workshops.json')
    const broken = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))
    await expect(liveChecks('https://x.test', broken as any)[0].run()).rejects.toThrow('not a class list')
    const down = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    await expect(liveChecks('https://x.test', down as any)[0].run()).rejects.toThrow('answered 502')
  })

  it('asks for the class list a second time before failing (the first request only wakes a sleeping site)', async () => {
    const slowThenFine = vi.fn()
      .mockRejectedValueOnce(new Error('Class list took over 8s'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workshops: [] }), { status: 200 }))
    await liveChecks('https://x.test', slowThenFine as any)[0].run()
    expect(slowThenFine).toHaveBeenCalledTimes(2)
    const downTwice = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    await expect(liveChecks('https://x.test', downTwice as any)[0].run()).rejects.toThrow('answered 502')
    expect(downTwice).toHaveBeenCalledTimes(2)
  })

  it('needs 2 failed runs by day, 4 from 11 PM to 6 AM studio time', () => {
    expect(strikesNeeded(DAY)).toBe(2)
    expect(strikesNeeded(NIGHT)).toBe(4)
    expect(strikesNeeded(new Date('2026-11-23T04:59:00Z'))).toBe(2) // 10:59 PM
    expect(strikesNeeded(new Date('2026-11-23T05:00:00Z'))).toBe(4) // 11 PM
    expect(strikesNeeded(new Date('2026-11-23T12:00:00Z'))).toBe(2) // 6 AM
  })

  it('at night a short outage stays quiet; an hour of failures still texts', async () => {
    for (let i = 0; i < 3; i++) expect((await runWatchdog([bad], kv, NIGHT)).texted).toBe(false)
    expect(texts).toHaveLength(0)
    expect((await runWatchdog([bad], kv, NIGHT)).texted).toBe(true)
    expect(texts[0]).toMatch(/^BOOKING CHECK FAILING \(4 checks in a row\)/)
  })

  it(`runs every ${WATCHDOG_EVERY_MINUTES} minutes on the 5-minute tick`, () => {
    const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 20, h, m, 10))
    const due = Array.from({ length: 12 }, (_, i) => watchdogDue(at(3, i * 5))).filter(Boolean).length
    expect(due).toBe(60 / WATCHDOG_EVERY_MINUTES)
  })
})
