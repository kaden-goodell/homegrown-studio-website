// @vitest-environment node
/**
 * The owners' side of a quote: draft from a request, save edits, send the
 * link (holding the date), resend, withdraw and reopen. Spec §3 (Admin),
 * the guard table, §5 Draft / Hold / Other rules.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// No Square in tests: no legacy classes, no Square parties.
const mocks = vi.hoisted(() => ({
  listBookings: vi.fn(async () => []),
  listAllWorkshops: vi.fn(async () => []),
  sendQuoText: vi.fn(async (_: { to: string; content: string }) => {}),
  sendEmail: vi.fn(async (_: { to: string; subject: string; html: string; text: string }) => ({ sent: true })),
}))
vi.mock('@config/providers', () => ({
  providers: {
    booking: { listBookings: mocks.listBookings },
    workshop: { listAllWorkshops: mocks.listAllWorkshops, listWorkshops: vi.fn(async () => []) },
  },
}))
vi.mock('@config/site.config', async (orig) => {
  const real: any = await orig()
  return { ...real, siteConfig: { ...real.siteConfig, providers: { booking: { config: { locationId: 'test-location' } } } } }
})
vi.mock('@providers/square/client', () => ({
  createSquareClient: () => ({ catalog: { object: { get: async () => ({ object: { itemData: { variations: [{ id: 'var-party' }] } } }) } } }),
}))
vi.mock('@lib/quo', async (orig) => ({ ...(await orig<any>()), sendQuoText: mocks.sendQuoText }))
vi.mock('@lib/email', async (orig) => ({ ...(await orig<any>()), sendEmail: mocks.sendEmail }))

import { draftQuote, saveQuote, sendQuote, quoteAction, QuoteError } from '@lib/quotes/admin-quotes'
import { saveMenuItems } from '@lib/quotes/menu-store'
import { getQuote, getQuoteForRequest, partyIdForQuote, updateQuote } from '@lib/quotes/quote-store'
import { priceKey } from '@lib/quotes/price-key'
import type { MenuItem, Quote } from '@lib/quotes/types'
import { checkRequest, saveRequest, getRequest, setRequestStatus } from '@lib/event-requests'
import { holdsBetween, holdTime } from '@lib/parties/party-book'
import { localToUtcISO } from '@lib/parties/party-times'
import { goodBody } from '../../fixtures/event-request'

const NOW = new Date('2026-11-17T18:00:00.000Z')
const ORIGIN = 'https://ourhometownstudio.com'
const BY = 'kaden'
const at = (ymd: string, hhmm: string) => localToUtcISO(ymd, hhmm)
const dayOf = (ymd: string) => [at(ymd, '00:00'), at(ymd, '23:59')] as const

const item = (id: string, cents: number, tags: string[] = []): MenuItem =>
  ({ id, source: 'own', name: id, photoUrl: null, cents, per: 'person', costCents: null, tags, hidden: false, updatedAt: '' })

let dayN = 0
/** A fresh far-future day per test (the party book is shared in this file); February has no closed holidays. */
const nextDay = () => {
  dayN += 1
  return `2027-02-${String(dayN).padStart(2, '0')}`
}

async function request(over: { date?: string; startTime?: string; place?: 'studio' | 'yours'; guests?: string; length?: string; budget?: string } = {}) {
  const base = goodBody()
  const body = goodBody({
    event: { ...base.event, date: over.date ?? '2026-12-11', startTime: over.startTime ?? '18:00', guests: over.guests ?? '25', length: over.length ?? '2 hours', crafters: 'adults' },
    where: { ...base.where, place: over.place ?? 'studio', address: over.place === 'yours' ? '100 Main St, Huntsville, AL' : '' },
    budget: over.budget ?? '1000-2500',
  })
  const c = checkRequest(body, NOW)
  if (!c.ok) throw new Error(`fixture refused: ${c.error}`)
  return saveRequest(c.value, c.photos, NOW)
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(QuoteError)
    return e as QuoteError
  }
  throw new Error('expected a refusal')
}

const mineIn = async (q: Quote, ymd: string) => (await holdsBetween(...dayOf(ymd), NOW)).filter((h) => h.partyId === q.partyId)

beforeEach(async () => {
  mocks.listBookings.mockReset().mockResolvedValue([])
  mocks.listAllWorkshops.mockReset().mockResolvedValue([])
  mocks.sendQuoText.mockClear()
  mocks.sendEmail.mockClear()
  await saveMenuItems(() => [item('terr', 4500, ['adults']), item('ear', 3000, ['adults']), item('felt', 800), item('big', 20000)])
})

async function sentQuote(over: Parameters<typeof request>[0] = {}) {
  const ymd = over.date ?? nextDay()
  const r = await request({ ...over, date: ymd })
  const q = await draftQuote(r.id, { by: BY, now: NOW })
  const { quote } = await sendQuote(q.id, { text: true, email: true, by: BY, origin: ORIGIN, now: NOW })
  return { r, q: quote, ymd }
}

describe('draftQuote', () => {
  it('drafts from the request: target, tiers, party id, expiry, place, and repeats return the same quote', async () => {
    const r = await request()
    const q = await draftQuote(r.id, { by: BY, now: NOW })
    expect(q).toMatchObject({ status: 'draft', targetCents: 7000, place: 'studio', guests: 25, crafters: 'adults', held: false, version: 1 })
    expect(q.tiers.map((t) => t.priceCents)).toEqual([5600, 7000, 9100])
    expect(q.partyId).toBe(partyIdForQuote(q.id))
    expect(q.expiresAt).toBe(new Date(NOW.getTime() + 14 * 86_400_000).toISOString())
    expect(q.startIso).toBe(at('2026-12-11', '18:00'))
    expect(q.endIso).toBe(at('2026-12-11', '20:00'))
    expect(q.priceKey).toBe(priceKey(q))
    expect(q.token).toMatch(/^[0-9a-f]{32}$/)
    expect((await draftQuote(r.id, { by: BY, now: NOW })).id).toBe(q.id)
  })

  it('maps "at your place" to away, empty start to no time, and reads the length in hours', async () => {
    const away = await draftQuote((await request({ place: 'yours' })).id, { by: BY, now: NOW })
    expect(away.place).toBe('away')
    expect(away.address).toBe('100 Main St, Huntsville, AL')
    const noTime = await draftQuote((await request({ startTime: '' })).id, { by: BY, now: NOW })
    expect(noTime.startIso).toBeNull()
    expect(noTime.endIso).toBeNull()
    const long = await draftQuote((await request({ length: 'About 3.5 hrs' })).id, { by: BY, now: NOW })
    expect(Date.parse(long.endIso!) - Date.parse(long.startIso!)).toBe(3.5 * 3_600_000)
  })

  it('an owner target overrides the budget', async () => {
    const q = await draftQuote((await request()).id, { by: BY, now: NOW, targetCents: 5000 })
    expect(q.targetCents).toBe(5000)
    expect(q.tiers.map((t) => t.priceCents)).toEqual([4000, 5000, 6500])
  })

  it('refuses a booked request unless forced', async () => {
    const r = await request()
    await setRequestStatus(r.id, 'booked', NOW)
    expect((await refusal(draftQuote(r.id, { by: BY, now: NOW }))).why).toBe('booked')
    expect((await draftQuote(r.id, { by: BY, now: NOW, force: true })).status).toBe('draft')
  })

  it('two quick taps make one quote', async () => {
    const r = await request()
    const [a, b] = await Promise.all([draftQuote(r.id, { by: BY, now: NOW }), draftQuote(r.id, { by: BY, now: NOW })])
    expect(a.id).toBe(b.id)
  })

  it('after a withdraw, makes a new quote and the request points to it', async () => {
    const r = await request()
    const q1 = await draftQuote(r.id, { by: BY, now: NOW })
    await quoteAction(q1.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW })
    const q2 = await draftQuote(r.id, { by: BY, now: NOW })
    expect(q2.id).not.toBe(q1.id)
    expect((await getQuoteForRequest(r.id))?.id).toBe(q2.id)
    expect((await getQuote(q1.id))?.status).toBe('withdrawn')
  })
})

describe('saveQuote', () => {
  it('refuses a stale version', async () => {
    const q = await draftQuote((await request()).id, { by: BY, now: NOW })
    await saveQuote({ ...q, note: 'one' }, q.version, { by: BY, now: NOW })
    expect((await refusal(saveQuote({ ...q, note: 'two' }, q.version, { by: BY, now: NOW }))).why).toBe('stale')
  })

  it('refuses a paid or paying quote', async () => {
    const q = await draftQuote((await request()).id, { by: BY, now: NOW })
    await updateQuote(q.id, (c) => ({ ...c, status: 'paid' }))
    expect((await refusal(saveQuote(q, q.version, { by: BY, now: NOW }))).why).toBe('paid')
  })

  it('an owner edit bumps the version and the price key', async () => {
    const q = await draftQuote((await request()).id, { by: BY, now: NOW })
    const tiers = q.tiers.map((t, i) => (i === 1 ? { ...t, priceCents: 7200 } : t))
    const saved = await saveQuote({ ...q, tiers }, q.version, { by: BY, now: NOW })
    expect(saved.version).toBe(q.version + 1)
    expect(saved.priceKey).not.toBe(q.priceKey)
    expect(saved.priceKey).toBe(priceKey(saved))
  })

  it('a sent quote past the cap needs overCapOk', async () => {
    const { q } = await sentQuote()
    const tiers = q.tiers.map((t, i) => (i === 0 ? { ...t, priceCents: 1000 } : t))
    expect((await refusal(saveQuote({ ...q, tiers }, q.version, { by: BY, now: NOW }))).why).toBe('over_cap')
    const ok = await saveQuote({ ...q, tiers }, q.version, { by: BY, now: NOW, overCapOk: true })
    expect(ok.tiers[0].priceCents).toBe(1000)
  })

  it('saving a sent quote marks it updated for the customer', async () => {
    const { q } = await sentQuote()
    const later = new Date(NOW.getTime() + 60_000)
    const saved = await saveQuote({ ...q, note: 'See you soon' }, q.version, { by: BY, now: later })
    expect(saved.updatedAt).toBe(later.toISOString())
    expect(Date.parse(saved.updatedAt!)).toBeGreaterThan(Date.parse(saved.sentAt!))
  })

  it('hiding the picked tier sets it back to sent and clears the pick', async () => {
    const { q } = await sentQuote()
    const picked = await updateQuote(q.id, (c) => ({ ...c, status: 'picked', pickedTierId: c.tiers[1].id }))
    const tiers = picked.tiers.map((t, i) => (i === 1 ? { ...t, hidden: true } : t))
    const saved = await saveQuote({ ...picked, tiers }, picked.version, { by: BY, now: NOW })
    expect(saved.status).toBe('sent')
    expect(saved.pickedTierId).toBeUndefined()
  })

  it('a later expiry clears the expiry notice and moves the hold', async () => {
    const { q, ymd } = await sentQuote()
    await updateQuote(q.id, (c) => ({ ...c, expiryTold: true }))
    const cur = (await getQuote(q.id))!
    const expiresAt = new Date(Date.parse(cur.expiresAt) + 3 * 86_400_000).toISOString()
    const saved = await saveQuote({ ...cur, expiresAt }, cur.version, { by: BY, now: NOW })
    expect(saved.expiryTold).toBeUndefined()
    expect(saved.held).toBe(true)
    const [h] = await mineIn(saved, ymd)
    expect(Date.parse(h.holdExpiresAt!)).toBeGreaterThanOrEqual(Date.parse(expiresAt))
  })

  it('a moved time that clashes is refused and the old hold kept', async () => {
    const { q, ymd } = await sentQuote()
    await holdTime({ partyId: 'pty_blocker', startIso: at(ymd, '12:00'), endIso: at(ymd, '14:00'), ttlMinutes: 60 * 24 * 60 }, [], NOW)
    const e = await refusal(saveQuote({ ...q, startIso: at(ymd, '12:00'), endIso: at(ymd, '14:00') }, q.version, { by: BY, now: NOW }))
    expect(e.why).toBe('time_taken')
    expect(e.clash?.startIso).toBe(at(ymd, '12:00'))
    const h = await mineIn(q, ymd)
    expect(h).toHaveLength(1)
    expect(h[0].startIso).toBe(at(ymd, '18:00'))
    expect((await getQuote(q.id))!.startIso).toBe(at(ymd, '18:00'))
  })
})

describe('sendQuote', () => {
  it('refuses with no visible packages', async () => {
    const q = await draftQuote((await request({ date: nextDay() })).id, { by: BY, now: NOW })
    const saved = await saveQuote({ ...q, tiers: q.tiers.map((t) => ({ ...t, hidden: true })) }, q.version, { by: BY, now: NOW })
    expect((await refusal(sendQuote(saved.id, { text: true, email: true, by: BY, origin: ORIGIN, now: NOW }))).why).toBe('no_tiers')
  })

  it('refuses without a start time', async () => {
    const q = await draftQuote((await request({ startTime: '', date: nextDay() })).id, { by: BY, now: NOW })
    const e = await refusal(sendQuote(q.id, { text: true, email: true, by: BY, origin: ORIGIN, now: NOW }))
    expect(e.why).toBe('incomplete')
    expect(e.status).toBe(400)
  })

  it('refuses a studio start outside 8 AM to 8 PM', async () => {
    const q = await draftQuote((await request({ startTime: '21:30', date: nextDay() })).id, { by: BY, now: NOW })
    expect((await refusal(sendQuote(q.id, { text: true, email: true, by: BY, origin: ORIGIN, now: NOW }))).why).toBe('closed')
  })

  it('refuses a red package unless overCapOk', async () => {
    const q = await draftQuote((await request({ date: nextDay() })).id, { by: BY, now: NOW })
    const saved = await saveQuote({ ...q, tiers: q.tiers.map((t, i) => (i === 0 ? { ...t, priceCents: 1000 } : t)) }, q.version, { by: BY, now: NOW })
    expect((await refusal(sendQuote(saved.id, { text: false, email: false, by: BY, origin: ORIGIN, now: NOW }))).why).toBe('over_cap')
    const { quote } = await sendQuote(saved.id, { text: false, email: false, overCapOk: true, by: BY, origin: ORIGIN, now: NOW })
    expect(quote.status).toBe('sent')
  })

  it('a clash names it and sends nothing', async () => {
    const ymd = nextDay()
    await holdTime({ partyId: 'pty_other', startIso: at(ymd, '18:30'), endIso: at(ymd, '20:00'), ttlMinutes: 60 * 24 * 60 }, [], NOW)
    const q = await draftQuote((await request({ date: ymd })).id, { by: BY, now: NOW })
    const e = await refusal(sendQuote(q.id, { text: true, email: true, by: BY, origin: ORIGIN, now: NOW }))
    expect(e.why).toBe('time_taken')
    expect(e.status).toBe(409)
    expect(e.clash).toEqual({ label: expect.any(String), startIso: at(ymd, '18:30') })
    expect(mocks.sendQuoText).not.toHaveBeenCalled()
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    expect((await getQuote(q.id))!.status).toBe('draft')
    // Send without holding goes out with no hold.
    const { quote } = await sendQuote(q.id, { text: false, email: false, noHold: true, by: BY, origin: ORIGIN, now: NOW })
    expect(quote).toMatchObject({ status: 'sent', held: false })
    expect(await mineIn(quote, ymd)).toHaveLength(0)
  })

  it('holds, texts and emails the link, and marks the request quoted', async () => {
    const { r, q, ymd } = await sentQuote()
    expect(q).toMatchObject({ status: 'sent', held: true, sentBy: BY, sentAt: NOW.toISOString() })
    const h = await mineIn(q, ymd)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ state: 'held', startIso: q.startIso, endIso: q.endIso })
    expect((await getRequest(r.id))!.status).toBe('quoted')
    const url = `${ORIGIN}/quote/${q.token}`
    expect(mocks.sendQuoText).toHaveBeenCalledTimes(1)
    expect(mocks.sendQuoText.mock.calls[0][0]).toEqual({ to: '(256) 555-0142', content: `Hi Dana! Your Hometown Studio event ideas are ready: ${url}` })
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const mail = mocks.sendEmail.mock.calls[0][0]
    expect(mail.to).toBe('dana@example.com')
    expect(mail.html).toContain(url)
    expect(mail.html).toContain('#7a4a2e')
    expect(mail.text).toContain(url)
  })

  it('an away quote holds nothing', async () => {
    const ymd = nextDay()
    const q = await draftQuote((await request({ date: ymd, place: 'yours' })).id, { by: BY, now: NOW })
    const { quote } = await sendQuote(q.id, { text: false, email: false, by: BY, origin: ORIGIN, now: NOW })
    expect(quote).toMatchObject({ status: 'sent', held: false })
    expect(await mineIn(quote, ymd)).toHaveLength(0)
  })

  it('never moves a booked request back to quoted', async () => {
    const ymd = nextDay()
    const r = await request({ date: ymd })
    await setRequestStatus(r.id, 'booked', NOW)
    const q = await draftQuote(r.id, { by: BY, now: NOW, force: true })
    await sendQuote(q.id, { text: false, email: false, by: BY, origin: ORIGIN, now: NOW })
    expect((await getRequest(r.id))!.status).toBe('booked')
    await quoteAction(q.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW })
    expect((await getRequest(r.id))!.status).toBe('booked')
  })
})

describe('quoteAction', () => {
  it('resend sends the link again; a draft refuses', async () => {
    const { q } = await sentQuote()
    mocks.sendQuoText.mockClear()
    mocks.sendEmail.mockClear()
    await quoteAction(q.id, 'resend', { by: BY, origin: ORIGIN, now: NOW })
    expect(mocks.sendQuoText).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    const d = await draftQuote((await request({ date: nextDay() })).id, { by: BY, now: NOW })
    expect((await refusal(quoteAction(d.id, 'resend', { by: BY, origin: ORIGIN, now: NOW }))).why).toBe('draft')
  })

  it('withdraw lets the time go and sets the request back to new', async () => {
    const { r, q, ymd } = await sentQuote()
    const w = await quoteAction(q.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW })
    expect(w).toMatchObject({ status: 'withdrawn', held: false })
    expect(await mineIn(q, ymd)).toHaveLength(0)
    expect((await getRequest(r.id))!.status).toBe('new')
  })

  it('withdraw leaves a request that was not quoted alone', async () => {
    const r = await request({ date: nextDay() })
    await setRequestStatus(r.id, 'not-now', NOW)
    const q = await draftQuote(r.id, { by: BY, now: NOW })
    await quoteAction(q.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW })
    expect((await getRequest(r.id))!.status).toBe('not-now')
  })

  it('withdraw refuses a paid quote', async () => {
    const { q } = await sentQuote()
    await updateQuote(q.id, (c) => ({ ...c, status: 'paid' }))
    expect((await refusal(quoteAction(q.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW }))).why).toBe('paid')
  })

  it('reopen a withdrawn quote: sent, new expiry, held again, expiry notice cleared', async () => {
    const { r, q, ymd } = await sentQuote()
    await quoteAction(q.id, 'withdraw', { by: BY, origin: ORIGIN, now: NOW })
    await updateQuote(q.id, (c) => ({ ...c, expiryTold: true }))
    const later = new Date(NOW.getTime() + 86_400_000)
    const o = await quoteAction(q.id, 'reopen', { by: BY, origin: ORIGIN, now: later })
    expect(o).toMatchObject({ status: 'sent', held: true })
    expect(o.expiryTold).toBeUndefined()
    expect(o.expiresAt).toBe(new Date(later.getTime() + 14 * 86_400_000).toISOString())
    expect(await mineIn(o, ymd)).toHaveLength(1)
    expect((await getRequest(r.id))!.status).toBe('quoted')
  })

  it('reopen an expired quote with an owner expiry; reopen refuses an open one', async () => {
    const { q, ymd } = await sentQuote()
    expect((await refusal(quoteAction(q.id, 'reopen', { by: BY, origin: ORIGIN, now: NOW }))).why).toBe('sent')
    const after = new Date(Date.parse(q.expiresAt) + 60_000)
    const expiresAt = new Date(after.getTime() + 5 * 86_400_000).toISOString()
    const o = await quoteAction(q.id, 'reopen', { by: BY, origin: ORIGIN, now: after, expiresAt })
    expect(o).toMatchObject({ status: 'sent', held: true, expiresAt })
    expect((await holdsBetween(...dayOf(ymd), after)).filter((h) => h.partyId === q.partyId)).toHaveLength(1)
  })
})
