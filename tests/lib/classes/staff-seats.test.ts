import { describe, it, expect } from 'vitest'
import { addDoorSeats } from '@lib/classes/staff-seats'
import { bookingIdFor, CLASS_TAX_PERCENT } from '@lib/classes/checkout'
import { quote } from '@lib/classes/pricing'
import { getLedger, hold } from '@lib/classes/seat-ledger'
import { defaultRules } from '@lib/classes/validate'
import type { ScheduledClass } from '@lib/classes/types'

const by = { id: 'crew', name: 'Crew' }
const customer = { givenName: 'Dora', familyName: 'Door', email: '', phone: '' }

function makeClass(): ScheduledClass {
  const id = `cls_seat${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return {
    id, libraryId: null, libraryVersion: null,
    content: {
      name: 'Looms', description: '', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'Class', covers: { kind: 'all' } }],
      prices: { all: { person: 2500 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 60,
    },
    sessions: [{ id: 'ses_1', startIso: '2031-05-01T15:00:00.000Z', endIso: '2031-05-01T16:00:00.000Z', capacity: 8 }],
    status: 'open', square: { itemId: null, variations: {} }, createdAt: '', updatedAt: '', by, history: [],
  }
}

describe('door seats', () => {
  it('n1: a retry judged on the request’s own clock finds its own live hold and confirms it (never a 500 on a clock race)', async () => {
    const cls = makeClass()
    const request = { passId: 'all', tickets: { person: 1 } }
    // The sheet's request time: the server clock has since moved on more than a hold lasts.
    const now = new Date(Date.now() - 11 * 60_000)
    const attempt = 'att-n1'
    const bookingId = bookingIdFor(`door:${cls.id}:${attempt}`)
    // A first try held the seat and stopped before confirming.
    const q = quote(cls, request, now, CLASS_TAX_PERCENT, { door: true })
    if (!q.ok) throw new Error(q.error)
    await hold(cls, q.value, { bookingId, passId: 'all', source: 'door-counter', customer, ttlMinutes: 10, by }, now)
    const r = await addDoorSeats({ cls, mode: 'door-counter', request, customer, by, attempt, now })
    expect(r.ok).toBe(true)
    expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === bookingId).map((l) => l.state)).toEqual(['confirmed'])
  })
})
