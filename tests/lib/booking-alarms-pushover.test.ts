import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { _setIncidentDeps, ackIncident, ackSignature, raiseIncident, resolveIncident, sweepIncidents } from '@lib/booking-alarms'
import type { PushoverMessage } from '@lib/pushover'
import { memoryKv } from '../helpers-memory-kv'

/**
 * Kaden, 17 Nov 2026: alarms go through Pushover (emergencies ring through
 * silent), with the old text as the fallback so nothing is ever lost.
 */
let texts: string[]
let pushes: PushoverMessage[]
let cancels: string[]
let pushWorks: boolean
let now: Date
let kv: ReturnType<typeof memoryKv>
const later = (min: number) => { now = new Date(now.getTime() + min * 60_000) }

beforeEach(() => {
  texts = []
  pushes = []
  cancels = []
  pushWorks = true
  now = new Date('2026-11-20T00:00:00Z')
  kv = memoryKv()
  _setIncidentDeps({
    store: kv,
    send: async (_to, content) => { texts.push(content) },
    push: async (m) => {
      pushes.push(m)
      return pushWorks ? { sent: true, ...(m.priority === 2 ? { receipt: `rcpt${pushes.length}` } : {}) } : { sent: false }
    },
    cancelPush: async (r) => { cancels.push(r); return true },
    now: () => now,
    phone: () => '+14029802907',
    secret: () => 'test-secret',
  })
})
afterEach(() => _setIncidentDeps(null))

describe('alarms through Pushover', () => {
  it('an urgent incident is a Pushover emergency with the Got it link, and no text as well', async () => {
    expect(await raiseIncident({ key: 'booking:class:x', text: 'BOOKING FAILED (class): Sarah Lee tried Felting.' })).toBe(true)
    expect(texts).toEqual([])
    expect(pushes).toHaveLength(1)
    expect(pushes[0]).toMatchObject({ priority: 2, title: 'BOOKING FAILED (class)', urlTitle: 'Got it (stop the alarm)' })
    expect(pushes[0].url).toMatch(/\/api\/alerts\/ack\?k=booking%3Aclass%3Ax&s=[0-9a-f]{20}$/)
    expect(JSON.parse(kv.data.get('inc:booking:class:x')!)).toMatchObject({ via: 'pushover', receipt: 'rcpt1' })
  })

  it('a heads-up (rage taps) is a normal Pushover note: no emergency, no link', async () => {
    await raiseIncident({ key: 'rage:/book:x', text: 'RAGE TAPS on /book: someone tapped it.', urgent: false, autoResolve: true })
    expect(pushes[0].priority).toBe(0)
    expect(pushes[0].url).toBeUndefined()
    expect(texts).toEqual([])
  })

  it('"Fixed" is a normal note, and it stops Pushover\'s own repeats', async () => {
    await raiseIncident({ key: 'watchdog', text: 'BOOKING CHECK FAILING: x.', autoResolve: true })
    await resolveIncident('watchdog')
    expect(cancels).toEqual(['rcpt1'])
    expect(pushes[1]).toMatchObject({ priority: 0, title: 'Fixed' })
  })

  it('falls back to the old text when Pushover is not set up or refuses', async () => {
    pushWorks = false
    await raiseIncident({ key: 'k', text: 'BOOKING FAILED: x.' })
    expect(pushes).toHaveLength(1)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatch(/^BOOKING FAILED: x\. Got it: https:/)
    expect(JSON.parse(kv.data.get('inc:k')!).via).toBe('text')
  })

  it('falls back to the text when the Pushover call throws', async () => {
    _setIncidentDeps({
      store: kv,
      send: async (_to, content) => { texts.push(content) },
      push: async () => { throw new Error('boom') },
      cancelPush: async () => true,
      now: () => now,
      phone: () => '+1',
      secret: () => 's',
    })
    expect(await raiseIncident({ key: 'k', text: 'Broke.' })).toBe(true)
    expect(texts).toHaveLength(1)
  })

  it('a Pushover emergency is not re-sent every 10 minutes (Pushover rings by itself for an hour); after that, again', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    for (let i = 0; i < 11; i++) { later(5); await sweepIncidents() }
    expect(pushes).toHaveLength(1)
    later(6)
    await sweepIncidents()
    expect(pushes).toHaveLength(2)
    expect(pushes[1]).toMatchObject({ priority: 2 })
    expect(pushes[1].message).toMatch(/^STILL BROKEN: Broke\./)
    expect(texts).toEqual([])
  })

  it('a texted incident keeps the 10-minute repeats', async () => {
    pushWorks = false
    await raiseIncident({ key: 'k', text: 'Broke.' })
    later(10)
    await sweepIncidents()
    expect(texts).toHaveLength(2)
  })

  it('Got it stops our repeats and cancels Pushover\'s', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    const inc = JSON.parse(kv.data.get('inc:k')!)
    expect(await ackIncident('k', ackSignature('k', inc.openedAt))).toBe(true)
    expect(cancels).toEqual(['rcpt1'])
    later(180)
    await sweepIncidents()
    expect(pushes).toHaveLength(1)
    expect(texts).toEqual([])
  })
})
