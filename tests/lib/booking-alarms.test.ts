import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  _setIncidentDeps, ackIncident, ackSignature, alertsLiveFor, raiseIncident, resolveIncident, resolveIncidentsLike, sweepIncidents,
} from '@lib/booking-alarms'
import { memoryKv } from '../helpers-memory-kv'

let texts: { to: string; content: string }[]
let now: Date
let kv: ReturnType<typeof memoryKv>
const later = (min: number) => { now = new Date(now.getTime() + min * 60_000) }

beforeEach(() => {
  texts = []
  now = new Date('2026-11-20T00:00:00Z')
  kv = memoryKv()
  _setIncidentDeps({
    store: kv,
    send: async (to, content) => { texts.push({ to, content }) },
    now: () => now,
    phone: () => '+14029802907',
    secret: () => 'test-secret',
  })
})
afterEach(() => _setIncidentDeps(null))

describe('raiseIncident', () => {
  it('texts Kaden at once, with a Got it link', async () => {
    expect(await raiseIncident({ key: 'booking:class:unavailable', text: 'BOOKING FAILED: x.' })).toBe(true)
    expect(texts).toHaveLength(1)
    expect(texts[0].to).toBe('+14029802907')
    expect(texts[0].content).toMatch(/^BOOKING FAILED: x\. Got it: https:\/\/ourhometownstudio\.com\/api\/alerts\/ack\?k=booking%3Aclass%3Aunavailable&s=[0-9a-f]{20}$/)
  })

  it('the same problem again only counts: a storm is one text', async () => {
    for (let i = 0; i < 20; i++) await raiseIncident({ key: 'k', text: 'Broke.' })
    expect(texts).toHaveLength(1)
    expect(JSON.parse(kv.data.get('inc:k')!).count).toBe(20)
  })

  it('still texts once when the store is down', async () => {
    kv.failReads = true
    expect(await raiseIncident({ key: 'k', text: 'Broke.' })).toBe(true)
    expect(texts).toHaveLength(1)
  })

  it('never throws when the text fails', async () => {
    _setIncidentDeps({ store: kv, send: async () => { throw new Error('quo down') }, now: () => now, phone: () => '+1', secret: () => 's' })
    await expect(raiseIncident({ key: 'k', text: 'Broke.' })).resolves.toBe(false)
  })
})

describe('sweepIncidents (every 5 minutes)', () => {
  it('repeats an unanswered urgent text every 10 minutes, 12 times, then hourly', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    later(5); await sweepIncidents()
    expect(texts).toHaveLength(1) // not yet
    later(5); await sweepIncidents()
    expect(texts).toHaveLength(2)
    expect(texts[1].content).toMatch(/^STILL BROKEN: Broke\. Got it: /)
    for (let i = 0; i < 22; i++) { later(5); await sweepIncidents() }
    expect(texts).toHaveLength(13) // 1 + 12 fast repeats (every 10 min for 2 hours)
    later(30); await sweepIncidents()
    expect(texts).toHaveLength(13) // now hourly
    later(30); await sweepIncidents()
    expect(texts).toHaveLength(14)
  })

  it('says how many times it happened', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    await raiseIncident({ key: 'k', text: 'Broke.' })
    later(10); await sweepIncidents()
    expect(texts[1].content).toMatch(/^STILL BROKEN \(2 times since 6:00 PM\): Broke\./)
  })

  it('Got it stops the repeats; more failures afterwards get one note an hour', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    const inc = JSON.parse(kv.data.get('inc:k')!)
    expect(await ackIncident('k', ackSignature('k', inc.openedAt))).toBe(true)
    later(30); await sweepIncidents()
    expect(texts).toHaveLength(1)
    await raiseIncident({ key: 'k', text: 'Broke.' })
    await raiseIncident({ key: 'k', text: 'Broke.' })
    later(30); await sweepIncidents()
    expect(texts).toHaveLength(2)
    expect(texts[1].content).toBe('Still happening: Broke. 2 more since you tapped Got it.')
    later(30); await sweepIncidents()
    expect(texts).toHaveLength(2) // nothing new
  })

  it('a wrong or old Got it link does nothing', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    expect(await ackIncident('k', 'f'.repeat(20))).toBe(false)
    expect(await ackIncident('other', ackSignature('k', now.toISOString()))).toBe(false)
  })

  it('a problem that clears by itself closes quietly after 2 quiet hours', async () => {
    await raiseIncident({ key: 'booking:class:x', text: 'Broke.', autoResolve: true })
    const inc = JSON.parse(kv.data.get('inc:booking:class:x')!)
    await ackIncident('booking:class:x', ackSignature('booking:class:x', inc.openedAt))
    later(121); await sweepIncidents()
    expect(kv.data.has('inc:booking:class:x')).toBe(false)
    expect(texts).toHaveLength(1)
  })

  it('a money problem keeps repeating until Got it, however quiet', async () => {
    await raiseIncident({ key: 'money:class:x', text: 'MAY have been charged.', autoResolve: false })
    for (let i = 0; i < 48; i++) { later(5); await sweepIncidents() }
    expect(kv.data.has('inc:money:class:x')).toBe(true)
    expect(texts.length).toBeGreaterThan(10)
  })
})

describe('resolveIncident', () => {
  it('sends Fixed when something was texted', async () => {
    await raiseIncident({ key: 'k', text: 'Class list broke. More words.' })
    await raiseIncident({ key: 'k', text: 'Class list broke. More words.' })
    expect(await resolveIncident('k')).toBe(true)
    expect(texts[1].content).toBe('Fixed: Class list broke. (2 times since 6:00 PM).')
    expect(kv.data.has('inc:k')).toBe(false)
  })

  it('a booking that went through clears only the problems that clear by themselves', async () => {
    await raiseIncident({ key: 'booking:class:unavailable', text: 'A.', autoResolve: true })
    await raiseIncident({ key: 'booking:class:browser-crash', text: 'B.', autoResolve: true })
    await raiseIncident({ key: 'money:class:unknown_outcome:Sam', text: 'C.', autoResolve: false })
    await raiseIncident({ key: 'booking:party:unavailable', text: 'D.', autoResolve: true })
    expect(await resolveIncidentsLike('booking:class:', () => 'Fixed: classes.')).toBe(2)
    expect([...kv.data.keys()].sort()).toEqual(['inc:booking:party:unavailable', 'inc:money:class:unknown_outcome:Sam'])
  })
})

describe('alertsLiveFor', () => {
  it('only the live site texts', () => {
    expect(alertsLiveFor('https://ourhometownstudio.com/api/workshops/book.json')).toBe(true)
    expect(alertsLiveFor('https://www.ourhometownstudio.com/x')).toBe(true)
    expect(alertsLiveFor('https://dev--iridescent-croissant-494fc3.netlify.app/api/x')).toBe(false)
    expect(alertsLiveFor('http://localhost:4321/api/x')).toBe(false)
    expect(alertsLiveFor(undefined)).toBe(false)
  })
})

describe('the alarm store', () => {
  it('is never the injury-report store or any other existing store', async () => {
    const { ALARM_STORE } = await import('@config/alerts')
    expect(ALARM_STORE).toBe('booking-alarms')
    const { readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
    })
    // The injury reports (/staff 🚑 Incident) keep their own store.
    expect(readFileSync('src/lib/incident-store.ts', 'utf8')).toMatch(/makeKvStore\('incidents', 'incidents'\)/)
    expect(ALARM_STORE).not.toBe('incidents')
    // Nothing else may write into the alarm store, and the alarms write nowhere else.
    const users = [...walk('src'), ...walk('netlify')].filter((f) => {
      const s = readFileSync(f, 'utf8')
      return s.includes(`'${ALARM_STORE}'`) || /makeKvStore\(ALARM_STORE/.test(s)
    }).sort()
    expect(users).toEqual(['netlify/functions/alerts-tick.ts', 'src/config/alerts.ts', 'src/lib/booking-alarms.ts', 'src/lib/watchdog.ts'])
    for (const f of ['src/lib/booking-alarms.ts', 'src/lib/watchdog.ts', 'netlify/functions/alerts-tick.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/makeKvStore\('incidents'|name: 'incidents'/)
    }
  })
})
