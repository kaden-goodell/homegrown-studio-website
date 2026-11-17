// @vitest-environment node
/**
 * The customer's quote page data (view.json) and the package pick (pick.json):
 * open quotes show only what the customer may see, closed ones all look the
 * same, paid ones read the receipt live from the party record.
 */
import { describe, it, expect } from 'vitest'
import { publicView, pickTier } from '@lib/quotes/public-view'
import { newToken, newQuoteId, partyIdForQuote, createQuote, getQuote, updateQuote } from '@lib/quotes/quote-store'
import { checkRequest, saveRequest } from '@lib/event-requests'
import { createPartyRecord, type PartyRecord } from '@lib/party-store'
import type { Quote, Tier } from '@lib/quotes/types'
import { goodBody } from '../../fixtures/event-request'

const ORIGIN = 'https://ourhometownstudio.com'
const NOW = new Date('2026-11-17T18:00:00.000Z')

const tier = (over: Partial<Tier>): Tier => ({
  id: 'tr_pick', key: 'pick', name: 'Our pick', photoUrl: '/p/pick.jpg', hidden: false, priceCents: 4000,
  lines: [
    { itemId: 'i1', label: 'Wood sign', photoUrl: '/p/sign.jpg', cents: 4000, per: 'person', costCents: 900 },
    { itemId: 'i2', label: 'Travel', photoUrl: null, cents: 10000, per: 'event', costCents: 2500 },
  ],
  ...over,
})

async function requestId(name = 'Dana Planner'): Promise<string> {
  const c = checkRequest(goodBody({ about: { ...goodBody().about, name } }), new Date('2026-10-17T17:00:00Z'))
  if (!c.ok) throw new Error('bad fixture')
  return (await saveRequest(c.value, [])).id
}

async function makeQuote(over: Partial<Quote> = {}): Promise<Quote> {
  const id = newQuoteId()
  return createQuote({
    id, requestId: await requestId(), partyId: partyIdForQuote(id), token: newToken(), version: 3, priceKey: 'k',
    status: 'sent', place: 'away', address: '100 Main St, Huntsville, AL',
    startIso: '2026-12-05T20:00:00.000Z', endIso: '2026-12-05T22:00:00.000Z', guests: 20, crafters: 'adults',
    targetCents: 4000, note: 'So glad you asked!', depositPct: 50, expiresAt: '2026-12-01T00:00:00.000Z',
    tiers: [
      tier({ id: 'tr_simple', key: 'simple', name: 'Simple', priceCents: 3200 }),
      tier({}),
      tier({ id: 'tr_all', key: 'all', name: 'All out', hidden: true, priceCents: 5200 }),
    ],
    held: true, sentAt: '2026-11-17T12:00:00.000Z', sentBy: 'Kaden', views: 0,
    history: [{ at: '2026-11-17T00:00:00.000Z', by: 'Kaden', what: 'drafted' }],
    ...over,
  })
}

describe('publicView: open', () => {
  it('shows visible packages with prices and nothing owners-only, and counts a view', async () => {
    const q = await makeQuote({ updatedAt: '2026-11-17T15:00:00.000Z' })
    const v = await publicView(q.token, { isOwner: false, origin: ORIGIN, now: NOW })
    expect(v.state).toBe('open')
    if (v.state !== 'open') return
    expect(v.firstName).toBe('Dana')
    expect(v.event).toEqual({ startIso: q.startIso, endIso: q.endIso, guests: 20, place: 'away', address: '100 Main St, Huntsville, AL' })
    expect(v.note).toBe('So glad you asked!')
    expect(v.expiresAt).toBe(q.expiresAt)
    expect(v.updatedAt).toBe('2026-11-17T15:00:00.000Z')
    expect(v.depositPct).toBe(50)
    expect(v.tiers.map((t) => t.id)).toEqual(['tr_simple', 'tr_pick'])
    const pick = v.tiers[1]
    // 4000/person + 10000/event over 20 guests = 4500 normal
    expect(pick).toMatchObject({
      key: 'pick', name: 'Our pick', photoUrl: '/p/pick.jpg', normalPerPersonCents: 4500, priceCents: 4000,
      totalCents: 80000, depositCents: 40000,
    })
    expect(pick.offPct).toBeCloseTo(1 - 4000 / 4500)
    expect(pick.lines[0]).toEqual({ label: 'Wood sign', photoUrl: '/p/sign.jpg', per: 'person', cents: 4000 })

    const json = JSON.stringify(v)
    for (const bad of ['costCents', 'cost', 'history', 'sentBy', 'targetCents', 'version', 'Kaden', 'priceKey', 'requestId', 'partyId', q.token]) {
      expect(json).not.toContain(bad)
    }

    const after = await getQuote(q.id)
    expect(after?.views).toBe(1)
    expect(after?.lastViewedAt).toBeTruthy()
    expect(after?.version).toBe(3)
  })

  it('leaves the address out at the studio and updatedAt out when not after send', async () => {
    const q = await makeQuote({ place: 'studio', address: 'should not show', updatedAt: '2026-11-17T11:00:00.000Z' })
    const v = await publicView(q.token, { isOwner: false, origin: ORIGIN, now: NOW })
    if (v.state !== 'open') throw new Error('not open')
    expect(v.event).not.toHaveProperty('address')
    expect(v).not.toHaveProperty('updatedAt')
    expect(JSON.stringify(v)).not.toContain('should not show')
  })

  it('does not count an owner looking', async () => {
    const q = await makeQuote({ status: 'picked', pickedTierId: 'tr_pick' })
    const v = await publicView(q.token, { isOwner: true, origin: ORIGIN, now: NOW })
    expect(v.state).toBe('open')
    expect((await getQuote(q.id))?.views).toBe(0)
  })
})

describe('publicView: closed, paying', () => {
  it('draft, withdrawn, expired and unknown all return the same closed body', async () => {
    const draft = await makeQuote({ status: 'draft' })
    const withdrawn = await makeQuote({ status: 'withdrawn' })
    const expired = await makeQuote({ expiresAt: '2026-11-17T17:00:00.000Z' })
    for (const t of [draft.token, withdrawn.token, expired.token, newToken(), 'not-a-token']) {
      expect(await publicView(t, { isOwner: false, origin: ORIGIN, now: NOW })).toStrictEqual({ state: 'closed' })
    }
    expect((await getQuote(draft.id))?.views).toBe(0)
  })

  it('paying says paying', async () => {
    const q = await makeQuote({ status: 'paying', paying: { attemptId: 'a1', at: NOW.toISOString() } })
    expect(await publicView(q.token, { isOwner: false, origin: ORIGIN, now: NOW })).toStrictEqual({ state: 'paying' })
  })
})

describe('publicView: paid', () => {
  const party = (q: Quote, over: Partial<PartyRecord> = {}): PartyRecord => ({
    bookingId: q.partyId, hostToken: 'host-key-aaaa', craftName: 'Private event', startIso: q.startIso!,
    durationMinutes: 120, hostName: 'Dana Planner', hostEmail: 'dana@example.com', guestCount: 20, title: null,
    dropOff: false, createdAt: NOW.toISOString(), source: 'ours', status: 'booked', payToken: 'pay-key-bbbb',
    items: [
      { id: 'itm_1', kind: 'package', refId: 'tr_pick', label: 'Our pick', qty: 1, unitCents: 40000, cents: 40000, extraMinutes: 0, chargeId: 'ch_1', addedAt: NOW.toISOString(), by: null },
      { id: 'itm_2', kind: 'package', refId: 'tr_pick', label: 'Our pick (rest)', qty: 1, unitCents: 40000, cents: 40000, extraMinutes: 0, chargeId: null, addedAt: NOW.toISOString(), by: null },
    ] as any,
    charges: [{ id: 'ch_1', via: 'online', orderId: 'o1', paymentId: 'p1', cents: 40000, quotedCents: 40000, itemIds: ['itm_1'], receiptUrl: null, at: NOW.toISOString(), by: null }] as any,
    refunds: [],
    ...over,
  })

  it('reads the receipt live from the party record', async () => {
    const q = await makeQuote({ status: 'paid', pickedTierId: 'tr_pick', paidAt: NOW.toISOString() })
    await createPartyRecord(party(q))
    const v = await publicView(q.token, { isOwner: false, origin: ORIGIN, now: NOW })
    expect(v).toEqual({
      state: 'paid',
      date: q.startIso,
      tierName: 'Our pick',
      paidCents: 40000,
      dueCents: 40000,
      payUrl: `${ORIGIN}/party/pay/${q.partyId}?k=pay-key-bbbb`,
      hostUrl: `${ORIGIN}/party/${q.partyId}?key=host-key-aaaa`,
    })
  })

  it('no pay link when nothing is due; cancelled party says cancelled', async () => {
    const q = await makeQuote({ status: 'paid', pickedTierId: 'tr_pick' })
    const rec = party(q)
    rec.items = rec.items!.slice(0, 1)
    await createPartyRecord(rec)
    const v = await publicView(q.token, { isOwner: false, origin: ORIGIN, now: NOW })
    expect(v).toMatchObject({ state: 'paid', dueCents: 0 })
    expect(v).not.toHaveProperty('payUrl')

    const c = await makeQuote({ status: 'paid', pickedTierId: 'tr_pick' })
    await createPartyRecord(party(c, { status: 'cancelled' }))
    expect(await publicView(c.token, { isOwner: false, origin: ORIGIN, now: NOW })).toStrictEqual({ state: 'cancelled' })
  })
})

describe('pickTier', () => {
  it('sets picked without a version bump and can change the pick', async () => {
    const q = await makeQuote()
    expect(await pickTier(q.token, 'tr_simple', NOW)).toEqual({ ok: true })
    let after = await getQuote(q.id)
    expect(after).toMatchObject({ status: 'picked', pickedTierId: 'tr_simple', version: 3 })
    expect(await pickTier(q.token, 'tr_pick', NOW)).toEqual({ ok: true })
    after = await getQuote(q.id)
    expect(after).toMatchObject({ status: 'picked', pickedTierId: 'tr_pick', version: 3 })
  })

  it('refuses a hidden or missing package', async () => {
    const q = await makeQuote()
    expect(await pickTier(q.token, 'tr_all', NOW)).toEqual({ ok: false, why: 'tier_unavailable' })
    expect(await pickTier(q.token, 'nope', NOW)).toEqual({ ok: false, why: 'tier_unavailable' })
    expect((await getQuote(q.id))?.status).toBe('sent')
  })

  it('refuses when closed: draft, paying, paid, withdrawn, expired, unknown', async () => {
    for (const over of [
      { status: 'draft' }, { status: 'paying' }, { status: 'paid' }, { status: 'withdrawn' },
      { expiresAt: '2026-11-17T17:00:00.000Z' },
    ] as Partial<Quote>[]) {
      const q = await makeQuote(over)
      expect(await pickTier(q.token, 'tr_pick', NOW)).toEqual({ ok: false, why: 'closed' })
      expect((await getQuote(q.id))?.pickedTierId).toBeUndefined()
    }
    expect(await pickTier(newToken(), 'tr_pick', NOW)).toEqual({ ok: false, why: 'closed' })
  })

  it('a quote that expired after it was picked is closed', async () => {
    const q = await makeQuote()
    await updateQuote(q.id, (cur) => ({ ...cur, status: 'picked', pickedTierId: 'tr_pick', expiresAt: '2026-11-17T17:00:00.000Z' }))
    expect(await pickTier(q.token, 'tr_simple', NOW)).toEqual({ ok: false, why: 'closed' })
  })
})

describe('owner preview of a draft', () => {
  it('shows a draft to an owner, not to a customer', async () => {
    const { createQuote, newQuoteId, newToken, partyIdForQuote } = await import('@lib/quotes/quote-store')
    const { publicView } = await import('@lib/quotes/public-view')
    const id = newQuoteId()
    const token = newToken()
    await createQuote({
      id, requestId: `req-${id}`, partyId: partyIdForQuote(id), token, version: 1, priceKey: 'k', status: 'draft',
      place: 'studio', address: '', startIso: null, endIso: null, guests: 10, crafters: 'both', targetCents: 5000, note: '',
      depositPct: 50, expiresAt: '2099-01-01T00:00:00.000Z', tiers: [], held: false, views: 0, history: [],
    })
    expect((await publicView(token, { isOwner: false, origin: 'https://x' })).state).toBe('closed')
    expect((await publicView(token, { isOwner: true, origin: 'https://x' })).state).toBe('open')
  })
})
