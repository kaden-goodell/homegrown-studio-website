// tests/lib/classes/series.test.ts — a Repeat's dates as one series (final review I3): change or cancel all, safely.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ classes: [] as any[], ledgers: {} as Record<string, any[]>, updates: [] as any[], cancels: [] as any[], refuse: {} as Record<string, string> }))
vi.mock('@lib/classes/class-store', async (orig) => ({
  ...(await orig<any>()),
  getClass: async (id: string) => h.classes.find((c) => c.id === id) ?? null,
  listClasses: async () => h.classes,
}))
vi.mock('@lib/classes/seat-ledger', async (orig) => ({ ...(await orig<any>()), getLedger: async (id: string) => ({ classId: id, lines: h.ledgers[id] ?? [] }) }))
vi.mock('@lib/classes/admin-actions', async (orig) => {
  const real = await orig<any>()
  return {
    ...real,
    updateScheduledClass: async (body: any) => {
      if (h.refuse[body.id]) throw new real.ActionError(409, h.refuse[body.id])
      h.updates.push(body)
      const c = h.classes.find((x) => x.id === body.id)
      const next = { ...c, ...(body.content ? { content: body.content } : {}), ...(body.sessions ? { sessions: body.sessions } : {}) }
      return { data: { class: next } }
    },
    cancelClass: async (body: any) => { h.cancels.push(body); return { data: { class: { ...h.classes.find((x) => x.id === body.id), status: 'cancelled' }, booked: real.bookedPeople({ classId: body.id, lines: h.ledgers[body.id] ?? [] }) } } },
  }
})

import { cancelSeries, seriesCapacity, seriesInfo, updateSeries } from '@lib/classes/series'
import { shiftEarlyBird } from '@lib/classes/repeat'
import { defaultRules } from '@lib/classes/validate'

const by = { id: 'o', name: 'Catherine' }
const content = (o: any = {}) => ({
  name: 'Pottery', description: 'Mud.', imageUrl: null, instructor: null, rules: defaultRules(), ticketTypes: [{ id: 'person', label: 'Person' }],
  passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }], prices: { all: { person: 3000 } }, questions: [], addOns: [], defaultCapacity: 8, defaultMinutes: 90, ...o,
})
const day = (ymd: string, id: string, o: any = {}) => ({
  id, libraryId: null, libraryVersion: null, status: 'open', seriesId: 'ser_k1', content: content(),
  sessions: [{ id: `ses_${id}`, startIso: `${ymd}T16:00:00.000Z`, endIso: `${ymd}T17:30:00.000Z`, capacity: 8 }],
  square: { itemId: null, variations: {} }, createdAt: '', updatedAt: `u-${id}`, by, history: [], ...o,
})
const seat = (o: any = {}) => ({
  id: 'led_1', bookingId: 'bkg_1', sessionIds: [], ticketTypeId: 'person', passId: 'all', seat: 1, priceCents: 3000, taxCents: 270, addOns: {}, addOnCents: 0, addOnTaxCents: 0,
  answers: {}, source: 'online', state: 'confirmed', holdExpiresAt: null, customer: { givenName: 'Ada', familyName: 'L', email: 'ada@x.co', phone: '1' },
  square: { orderId: 'o', paymentId: 'p', lineUid: null, chargedCents: 3270 }, by: null, refunds: [], at: '', ...o,
})
const now = new Date('2031-03-01T12:00:00Z')

beforeEach(() => {
  h.classes = [day('2031-03-05', 'cls_a'), day('2031-03-12', 'cls_b'), day('2031-03-19', 'cls_c'), day('2031-02-26', 'cls_past'), day('2031-03-26', 'cls_gone', { status: 'cancelled' }), day('2031-03-12', 'cls_other', { seriesId: 'ser_zz' })]
  h.ledgers = { cls_b: [seat()] }
  h.updates = []; h.cancels = []; h.refuse = {}
})

describe('a Repeat series', () => {
  it('lists the dates still to come, not cancelled, in order, with who is booked', async () => {
    const r = await seriesInfo('cls_b', now)
    expect(r.data.members.map((m) => m.id)).toEqual(['cls_a', 'cls_b', 'cls_c'])
    expect(r.data.members[1].booked).toEqual([{ name: 'Ada L', phone: '1', email: 'ada@x.co', seats: 1 }])
    h.classes[0] = { ...h.classes[0], seriesId: undefined }
    expect((await seriesInfo('cls_a', now)).data.members).toEqual([])
  })

  it('All dates in this series: a new price and photo go to every other date; this one saves as Save does', async () => {
    const next = content({ prices: { all: { person: 3500 } }, imageUrl: 'https://img/new.jpg' })
    const r = await updateSeries({ id: 'cls_a', content: next, expectedUpdatedAt: 'u-cls_a' }, by, now)
    expect(h.updates.map((u) => u.id)).toEqual(['cls_a', 'cls_b', 'cls_c'])
    expect(h.updates[0]).toEqual({ id: 'cls_a', content: next, expectedUpdatedAt: 'u-cls_a' })
    expect(h.updates[1].content.prices).toEqual({ all: { person: 3500 } })
    expect(h.updates[1].expectedUpdatedAt).toBe('u-cls_b')
    expect(r.data.series).toEqual({ changed: ['Wed Mar 12', 'Wed Mar 19'], skipped: [] })
  })

  it('never changes the kinds of seat (or ways to book, extras, questions) on a date people booked; skips it and says why', async () => {
    const next = content({ ticketTypes: [{ id: 'person', label: 'Adult' }, { id: 'kid', label: 'Kid' }], prices: { all: { person: 3000, kid: 2000 } } })
    const r = await updateSeries({ id: 'cls_a', content: next, expectedUpdatedAt: 'u-cls_a' }, by, now)
    expect(h.updates.map((u) => u.id)).toEqual(['cls_a', 'cls_c'])
    expect(r.data.series.skipped).toEqual([{ id: 'cls_b', date: 'Wed Mar 12', reason: 'People are booked, so its kinds of seat weren’t changed. Change it on its own sheet.' }])
  })

  it('a date that refuses (seats below what is booked, someone else saved) is skipped with its reason; the rest go ahead', async () => {
    h.refuse.cls_b = 'Wed Mar 12 10 AM has 1 seats taken. Capacity can’t go below 1.'
    const r = await seriesCapacity({ id: 'cls_a', capacity: 6 }, by, now)
    expect(h.updates.map((u) => [u.id, u.sessions[0].capacity])).toEqual([['cls_a', 6], ['cls_c', 6]])
    expect(r.data.series.skipped[0]).toMatchObject({ id: 'cls_b', reason: expect.stringMatching(/Capacity/) })
    await expect(seriesCapacity({ id: 'cls_a', capacity: 0 }, by, now)).rejects.toMatchObject({ status: 400 })
  })

  it('cancel all: each date still to come is cancelled as Cancel does (never refunds), with who to contact per date', async () => {
    const r = await cancelSeries({ id: 'cls_b' }, by, now)
    expect(h.cancels.map((c) => c.id)).toEqual(['cls_a', 'cls_b', 'cls_c'])
    expect(r.data.series.cancelled.find((c: any) => c.id === 'cls_b')!.booked).toHaveLength(1)
  })

  it('M6: the early-bird ends the same days before each date; one that would already be over is left off', () => {
    const eb = { untilYmd: '2031-03-01', prices: { all: { person: 2500 } } }
    expect(shiftEarlyBird(eb, '2031-03-05T16:00:00.000Z', '2031-03-19T16:00:00.000Z', now)).toEqual({ ...eb, untilYmd: '2031-03-15' })
    expect(shiftEarlyBird(eb, '2031-03-05T16:00:00.000Z', '2031-02-26T16:00:00.000Z', now)).toBeNull()
  })
})
