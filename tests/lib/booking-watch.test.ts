import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { watchBooking, failureText, moneyWords } from '@lib/booking-watch'
import { _setIncidentDeps, raiseIncident } from '@lib/booking-alarms'
import { memoryKv } from '../helpers-memory-kv'

let texts: string[]
let kv: ReturnType<typeof memoryKv>
beforeEach(() => {
  texts = []
  kv = memoryKv()
  _setIncidentDeps({ store: kv, send: async (_to, c) => { texts.push(c) }, now: () => new Date('2026-11-20T00:00:00Z'), phone: () => '+1', secret: () => 's' })
})
afterEach(() => _setIncidentDeps(null))

const LIVE = 'https://ourhometownstudio.com/api/workshops/book.json'
const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })
const call = (route: any, url = LIVE, body: unknown = { customer: { givenName: 'Sarah', familyName: 'Lee', phone: '2565550100' } }) =>
  route({ request: new Request(url, { method: 'POST', body: JSON.stringify(body) }) })
const describeIt = (b: any) => ({ who: `${b.customer.givenName} ${b.customer.familyName}`, phone: b.customer.phone, what: 'Christmas Needle Felting, 2 seats', when: 'Fri, Nov 20 · 7:00 PM', amount: '$60.00 before tax' })

describe('watchBooking', () => {
  it.each([
    [402, 'card_declined'], [409, 'sold_out'], [409, 'already_booked'], [400, 'invalid'], [429, 'unavailable'], [403, undefined],
  ])('stays quiet for a customer-side answer (%s %s)', async (status, code) => {
    const res = await call(watchBooking('class', answer(status, { code, detail: 'x' }), describeIt))
    expect(res.status).toBe(status)
    expect(texts).toHaveLength(0)
  })

  it('texts on our failure, saying who, what and that nothing was charged', async () => {
    await call(watchBooking('class', answer(502, { code: 'unavailable', detail: 'We couldn’t set up your tickets. Nothing was charged. Please try again.' }), describeIt))
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatch(/^BOOKING FAILED \(class\): Sarah Lee \(2565550100\) tried Christmas Needle Felting, 2 seats, on Fri, Nov 20 · 7:00 PM, \$60\.00 before tax\. Nothing was charged\. Why: We couldn’t set up your tickets\./)
    expect(texts[0]).toMatch(/\[unavailable\] Call them\. Got it: /)
  })

  it('twenty customers hitting the same failure is one text', async () => {
    const route = watchBooking('class', answer(502, { code: 'unavailable', detail: 'x' }), describeIt)
    for (let i = 0; i < 20; i++) await call(route)
    expect(texts).toHaveLength(1)
    expect(JSON.parse(kv.data.get('inc:booking:class:unavailable')!).count).toBe(20)
  })

  it('a payment that may have gone through is its own incident and says check Square', async () => {
    await call(watchBooking('class', answer(502, { code: 'unknown_outcome', detail: 'x' }), describeIt))
    expect(texts[0]).toMatch(/MAY have been charged\. Check Square first\./)
    const keys = [...kv.data.keys()]
    expect(keys[0]).toMatch(/^inc:money:class:unknown_outcome:/)
    expect(JSON.parse(kv.data.get(keys[0])!).autoResolve).toBe(false)
  })

  it('a crash answers 500 (not a success) and texts that money may have moved', async () => {
    const res = await call(watchBooking('party', async () => { throw new Error('boom') }, describeIt))
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('unknown_outcome')
    expect(texts[0]).toMatch(/^BOOKING FAILED \(party\):.*may have charged them\. Check Square first\. Why: The site crashed\./)
  })

  it('a booking that goes through clears the earlier "nothing charged" failure with Fixed', async () => {
    await call(watchBooking('class', answer(502, { code: 'unavailable' }), describeIt))
    await call(watchBooking('class', answer(200, { data: {} }), describeIt))
    expect(texts[1]).toBe('Fixed: class bookings are going through again (1 failed before this one).')
  })

  it('previews and localhost never text', async () => {
    await call(watchBooking('class', answer(502, { code: 'unavailable' }), describeIt), 'https://dev--iridescent-croissant-494fc3.netlify.app/api/workshops/book.json')
    await call(watchBooking('class', async () => { throw new Error('boom') }, describeIt), 'http://localhost:4321/api/workshops/book.json')
    expect(texts).toHaveLength(0)
  })

  it('a describe that hangs or throws still texts', async () => {
    await call(watchBooking('shop', answer(500, { code: 'unavailable', detail: 'x' }), () => { throw new Error('bad') }))
    expect(texts[0]).toMatch(/^BOOKING FAILED \(shop order\): Someone tried a shop order\./)
  })

  it('says so when the card was charged but the order did not save', () => {
    expect(moneyWords(undefined, 'Your card was charged but we could not save your order.', false)).toEqual({ line: 'Their card WAS charged but the booking did not save.', moneyUnclear: true })
    expect(moneyWords('unavailable', 'Your card was not charged.', false).moneyUnclear).toBe(false)
    expect(failureText('party', {}, 'unavailable', '', false)).toMatch(/^BOOKING FAILED \(party\): Someone tried a party\. Nothing was charged\./)
  })

  it('raising directly still works alongside', async () => {
    await raiseIncident({ key: 'money:class:partly:b1', text: 'BOOKING PROBLEM.' })
    expect(texts).toHaveLength(1)
  })
})
