import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST, isNoise } from '../../src/pages/api/alerts/client.json'
import { _setIncidentDeps } from '@lib/booking-alarms'
import { memoryKv } from '../helpers-memory-kv'

let texts: string[]
let ip = 0
beforeEach(() => {
  texts = []
  ip += 1
  _setIncidentDeps({ store: memoryKv(), send: async (_t, c) => { texts.push(c) }, now: () => new Date('2026-11-20T00:00:00Z'), phone: () => '+1', secret: () => 's' })
})
afterEach(() => _setIncidentDeps(null))

const send = (body: unknown, url = 'https://ourhometownstudio.com/api/alerts/client.json', addr = `10.0.0.${ip}`) =>
  (POST as any)({ request: new Request(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), clientAddress: addr })

describe('/api/alerts/client.json', () => {
  it('a crashed booking pop-up texts Kaden', async () => {
    const res = await send({ kind: 'class', problem: 'crash', detail: 'TypeError: x is undefined', page: '/workshops' })
    expect(res.status).toBe(204)
    expect(texts[0]).toMatch(/^BOOKING BROKE on a customer's phone \(class\): The booking pop-up crashed\. "TypeError: x is undefined" Page: \/workshops\./)
  })

  it('many phones with the same problem are one text', async () => {
    for (let i = 0; i < 5; i++) await send({ kind: 'party', problem: 'payment_form' }, undefined, `10.1.0.${i}`)
    expect(texts).toHaveLength(1)
  })

  it('is rate-limited per address', async () => {
    const addr = '10.9.9.9'
    for (const problem of ['crash', 'payment_form', 'booking_network', 'booking_bad_answer']) {
      await send({ kind: 'shop', problem }, undefined, addr)
    }
    expect(texts).toHaveLength(3)
  })

  it('ignores browser add-ons, unknown problems, bad bodies and previews', async () => {
    await send({ kind: 'class', problem: 'crash', detail: 'chrome-extension://abc failed' })
    await send({ kind: 'class', problem: 'hack-the-planet' })
    await send({ kind: 'admin', problem: 'crash' })
    await send('not json')
    await send('x'.repeat(3000))
    await send({ kind: 'class', problem: 'crash' }, 'https://dev--iridescent-croissant-494fc3.netlify.app/api/alerts/client.json')
    expect(texts).toHaveLength(0)
    expect(isNoise('Script error.')).toBe(true)
    expect(isNoise('TypeError: cannot read')).toBe(false)
  })
})
