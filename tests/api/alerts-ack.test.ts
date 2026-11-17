import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET } from '../../src/pages/api/alerts/ack'
import { _setIncidentDeps, raiseIncident } from '@lib/booking-alarms'
import { memoryKv } from '../helpers-memory-kv'

let texts: string[]
beforeEach(() => {
  texts = []
  _setIncidentDeps({ store: memoryKv(), send: async (_t, c) => { texts.push(c) }, now: () => new Date('2026-11-20T00:00:00Z'), phone: () => '+1', secret: () => 's' })
})
afterEach(() => _setIncidentDeps(null))

describe('/api/alerts/ack (the Got it link)', () => {
  it('the link in the text stops the repeats', async () => {
    await raiseIncident({ key: 'booking:class:unavailable', text: 'Broke.' })
    const link = texts[0].match(/Got it: (\S+)$/)![1]
    const res = await (GET as any)({ url: new URL(link) })
    expect(res.status).toBe(200)
    expect(await res.text()).toMatch(/No more repeats/)
  })

  it('a tampered link does nothing', async () => {
    await raiseIncident({ key: 'k', text: 'Broke.' })
    const res = await (GET as any)({ url: new URL('https://ourhometownstudio.com/api/alerts/ack?k=k&s=00000000000000000000') })
    expect(await res.text()).toMatch(/Nothing to stop/)
    expect((await (GET as any)({ url: new URL('https://ourhometownstudio.com/api/alerts/ack') })).status).toBe(400)
  })
})
