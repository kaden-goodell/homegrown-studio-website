import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ square: null as any, findOrCreate: vi.fn(), classes: new Map<string, any>() }))
vi.mock('@config/providers', () => ({
  providers: {
    customer: { findOrCreate: (...a: any[]) => h.findOrCreate(...a) },
    get payment() { return h.square },
  },
}))
vi.mock('@lib/classes/class-store', () => ({ getClass: async (id: string) => h.classes.get(id) ?? null }))
const mail = vi.hoisted(() => ({ joined: vi.fn(), off: vi.fn(), missed: vi.fn() }))
vi.mock('@lib/email', () => ({
  sendWaitlistJoinedEmail: (...a: any[]) => mail.joined(...a),
  sendWaitlistOffEmail: (...a: any[]) => mail.off(...a),
  sendWaitlistMissedEmail: (...a: any[]) => mail.missed(...a),
}))
const setupAlert = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@lib/saved-card-alerts', () => ({ alertCardSetupOnce: setupAlert }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))

import { MockPaymentProvider } from '@providers/mock/payment'
import { hold, getLedger } from '@lib/classes/seat-ledger'
import { quote } from '@lib/classes/pricing'
import { defaultRules } from '@lib/classes/validate'
import { getWaitlist } from '@lib/classes/waitlist-store'
import { consentFor, readLeaveToken } from '@lib/classes/waitlist'
import { consentText, WAITLIST_MESSAGES } from '@lib/classes/waitlist-words'
import { toPublicClass } from '@lib/classes/public-view'
import type { ScheduledClass } from '@lib/classes/types'

const NOW = new Date('2026-10-10T17:00:00.000Z')
let seq = 0
const attempt = () => `3f2b8a0e-5c1d-4e7a-9b3c-${(++seq).toString(16).padStart(12, '0')}`

function makeClass(over: { capacity?: number; startIso?: string; status?: ScheduledClass['status']; waitlistCutoffHours?: number } = {}): ScheduledClass {
  const id = `cls_wl${Date.now().toString(36)}${++seq}`
  const start = over.startIso ?? '2026-10-17T15:00:00.000Z'
  const cls: ScheduledClass = {
    id, libraryId: null, libraryVersion: null,
    content: {
      name: 'Potholder Looms', description: 'Weave.', imageUrl: null, instructor: null,
      rules: { ...defaultRules(), ...(over.waitlistCutoffHours !== undefined ? { waitlistCutoffHours: over.waitlistCutoffHours } : {}) },
      ticketTypes: [{ id: 'person', label: 'Person' }],
      passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 1, defaultMinutes: 120,
    },
    sessions: [{ id: 'ses_1', startIso: start, endIso: new Date(Date.parse(start) + 7_200_000).toISOString(), capacity: over.capacity ?? 1 }],
    status: over.status ?? 'open',
    square: { itemId: 'ITEM', variations: { 'all:person': 'VAR' } },
    createdAt: '', updatedAt: '', by: { id: 'k', name: 'Kaden' }, history: [],
  }
  h.classes.set(id, cls)
  return cls
}

/** Fills the class: someone else holds every seat (a live hold, ten minutes). */
async function fill(cls: ScheduledClass, seats = cls.sessions[0].capacity) {
  const q = quote(cls, { passId: 'all', tickets: { person: seats } }, NOW, 9)
  if (!q.ok) throw new Error(q.error)
  await hold(cls, q.value, { bookingId: `bkg_other${++seq}`, passId: 'all', source: 'online', customer: null, ttlMinutes: 60 * 24 }, NOW)
}

const customer = { givenName: 'Jane', familyName: 'Doe', email: 'jane@example.com', phone: '(402) 980-2907' }
/** I2: the consent as the panel shows it (today's price and close time, the same words). */
function shownFor(cls: ScheduledClass, tickets: Record<string, number> = { person: 1 }, sessionIds?: string[]) {
  const q = quote(cls, { passId: 'all', tickets, ...(sessionIds ? { sessionIds } : {}) }, NOW, 9)
  if (!q.ok) return null
  const c = consentFor(cls, q.value.sessionIds, q.value.totalCents)
  return c ? { maxCents: q.value.totalCents, closesIso: c.closesIso, text: c.text, firstStartIso: c.firstStartIso } : null
}
const joinBody = (cls: ScheduledClass, over: Record<string, any> = {}) => ({
  action: 'join', classId: cls.id, attemptId: attempt(), passId: 'all', tickets: { person: 1 }, customer,
  cardToken: 'cnon:card-nonce-ok', verificationToken: 'verf-1', consent: true,
  consentShown: shownFor(cls, over.tickets ?? { person: 1 }, over.sessionIds), ...over,
})
let ip = 0
const call = (payload: any) => POST({
  clientAddress: `203.0.113.${++ip % 250}`,
  request: new Request('https://ourhometownstudio.com/api/classes/waitlist.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
} as any)

let POST: any
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  h.square = new MockPaymentProvider()
  h.findOrCreate.mockResolvedValue({ id: 'cust-1', email: customer.email })
  mail.joined.mockResolvedValue({ sent: true })
  mail.off.mockResolvedValue({ sent: true })
  POST = (await import('@pages/api/classes/waitlist.json')).POST
})
afterEach(() => vi.useRealTimers())

describe('waitlist join', () => {
  it('joins a full class: card saved by Square, entry waiting, joined email with a leave link', async () => {
    const cls = makeClass()
    await fill(cls)
    const body = joinBody(cls)
    const res = await call(body)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ position: 1, waiting: 1, card: { brand: 'VISA', last4: '4242' }, emailSent: true })

    expect(h.square.saveCardCalls).toHaveLength(1)
    const save = h.square.saveCardCalls[0]
    expect(save).toMatchObject({ customerId: 'cust-1', sourceToken: 'cnon:card-nonce-ok', verificationToken: 'verf-1', idempotencyKey: `wl:${body.attemptId}:card` })
    expect(save.idempotencyKey.length).toBeLessThanOrEqual(45)

    const list = await getWaitlist(cls.id)
    expect(list.entries).toHaveLength(1)
    const e = list.entries[0]
    expect(e).toMatchObject({ state: 'waiting', seats: 1, sessionIds: ['ses_1'], maxCents: 2180 })
    expect(save.referenceId).toBe(e.id)
    expect(e.square).toEqual({ customerId: 'cust-1', cardId: expect.any(String), brand: 'VISA', last4: '4242', expMonth: 12, expYear: expect.any(Number) })
    // Only the card's face: no number, CVV or token is kept.
    expect(JSON.stringify(e)).not.toMatch(/cnon:|card_number|cvv/i)
    expect(e.consent.text).toBe(consentText({ className: 'Potholder Looms', startIso: '2026-10-17T15:00:00.000Z', closesIso: '2026-10-15T15:00:00.000Z', maxCents: 2180 }))
    expect(e.consent.text).toBe(body.consentShown!.text) // I2: stored exactly as shown
    expect(e.consent.text).toContain('If a spot opens in Potholder Looms (Sat, Oct 17 at 10 AM) before the waitlist closes on Thu, Oct 15 at 10 AM')
    expect(e.consent.text).toContain('never more than $21.80')

    const m = mail.joined.mock.calls[0][0]
    expect(m).toMatchObject({ to: 'jane@example.com', className: 'Potholder Looms', maxCents: 2180, last4: '4242' })
    const token = decodeURIComponent(m.leaveUrl.split('/classes/waitlist/')[1])
    expect(readLeaveToken(token)).toMatchObject({ classId: cls.id, entryId: e.id })
    expect(e.leaveHash).not.toContain(token.split('.')[2])
  })

  it('refuses when a seat is free (join only when full), before any card is saved', async () => {
    const cls = makeClass({ capacity: 2 })
    await fill(cls, 1)
    const res = await call(joinBody(cls))
    expect(res.status).toBe(409)
    expect((await res.json())).toMatchObject({ code: 'spot_open', detail: WAITLIST_MESSAGES.spotOpen })
    expect(h.square.saveCardCalls).toHaveLength(0)
  })

  it('a group bigger than the seats left can join (2 wanted, 1 left)', async () => {
    const cls = makeClass({ capacity: 2 })
    await fill(cls, 1)
    const res = await call(joinBody(cls, { tickets: { person: 2 } }))
    expect(res.status).toBe(200)
    expect((await getWaitlist(cls.id)).entries[0]).toMatchObject({ seats: 2, maxCents: 4360 })
  })

  it('refused after the cutoff: "The waitlist for this class has closed."', async () => {
    const cls = makeClass({ startIso: '2026-10-10T18:30:00.000Z' }) // starts in 90 min, cutoff 2 h
    await fill(cls)
    const res = await call(joinBody(cls))
    expect(res.status).toBe(409)
    expect((await res.json()).detail).toBe('The waitlist for this class has closed.')
    expect(h.square.saveCardCalls).toHaveLength(0)
  })

  it('the waitlist never stays open past the sign-up cutoff (a 24 h made-to-order class)', async () => {
    const cls = makeClass({ startIso: '2026-10-11T12:00:00.000Z' })
    cls.content.rules.madeToOrder = true
    await fill(cls)
    expect((await call(joinBody(cls))).status).toBe(409)
  })

  it('a duplicate join (same email, same dates) is refused kindly; the card is not saved twice', async () => {
    const cls = makeClass()
    await fill(cls)
    expect((await call(joinBody(cls))).status).toBe(200)
    const res = await call(joinBody(cls, { customer: { ...customer, email: 'JANE@example.com' } }))
    expect(res.status).toBe(409)
    expect((await res.json()).detail).toBe(WAITLIST_MESSAGES.duplicate)
    expect(h.square.saveCardCalls).toHaveLength(1)
  })

  it('a retry of the same join replays: one card, one entry', async () => {
    const cls = makeClass()
    await fill(cls)
    const body = joinBody(cls)
    await call(body)
    const again = await call(body)
    expect(again.status).toBe(200)
    expect((await again.json()).data).toMatchObject({ position: 1, replayed: true })
    expect((await getWaitlist(cls.id)).entries).toHaveLength(1)
    expect(h.square.saveCardCalls).toHaveLength(1)
  })

  it('the consent tick is required', async () => {
    const cls = makeClass()
    await fill(cls)
    const res = await call(joinBody(cls, { consent: false }))
    expect(res.status).toBe(400)
    expect((await res.json()).detail).toBe(WAITLIST_MESSAGES.consent)
    expect(h.square.saveCardCalls).toHaveLength(0)
  })

  it('a card Square won\'t save → nothing stored, "Nothing was charged."', async () => {
    const cls = makeClass()
    await fill(cls)
    const res = await call(joinBody(cls, { cardToken: 'FAIL' }))
    expect(res.status).toBe(402)
    expect((await res.json()).detail).toBe('Your bank didn’t accept that card. Nothing was charged. Try another card.')
    expect((await getWaitlist(cls.id)).entries).toHaveLength(0)
    expect(mail.joined).not.toHaveBeenCalled()
    expect(setupAlert).not.toHaveBeenCalled()
  })

  it('a setup refusal from Square: the customer reads "try again in a few minutes", owners alerted once', async () => {
    const cls = makeClass()
    await fill(cls)
    const res = await call(joinBody(cls, { cardToken: 'SETUP' }))
    expect(res.status).toBe(402)
    expect((await res.json()).detail).toBe('We couldn’t save your card just now. Nothing was charged. Try again in a few minutes.')
    expect(setupAlert).toHaveBeenCalledWith('save', expect.any(Date))
  })

  it('a seat opened while the card was saved → refused with "Book it now" and the card comes back off', async () => {
    const cls = makeClass()
    await fill(cls)
    const realSave = h.square.saveCard.bind(h.square)
    h.square.saveCard = async (input: any) => {
      const card = await realSave(input)
      // The other booking's hold is let go meanwhile.
      const { release } = await import('@lib/classes/seat-ledger')
      const other = (await getLedger(cls.id)).lines[0]
      await release(cls.id, other.bookingId)
      return card
    }
    const res = await call(joinBody(cls))
    expect(res.status).toBe(409)
    expect((await res.json()).detail).toBe('A spot just opened. Book it now.')
    expect(h.square.disableCardCalls).toHaveLength(1)
    expect((await getWaitlist(cls.id)).entries).toHaveLength(0)
  })

  it('no card data reaches the server: the body carries only Square\'s one-time token', async () => {
    const cls = makeClass()
    await fill(cls)
    const body = joinBody(cls)
    expect(Object.keys(body).sort()).toEqual(['action', 'attemptId', 'cardToken', 'classId', 'consent', 'consentShown', 'customer', 'passId', 'tickets', 'verificationToken'])
    expect(Object.keys(body.consentShown!).sort()).toEqual(['closesIso', 'firstStartIso', 'maxCents', 'text'])
  })

  it('I2: a stale price in the consent shown is refused with the new amount; nothing is saved', async () => {
    const cls = makeClass()
    await fill(cls)
    const shown = shownFor(cls)!
    // Catherine raises the price while the panel is open.
    cls.content.prices = { all: { person: 2300 } }
    const res = await call(joinBody(cls, { consentShown: shown }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'consent_changed', detail: 'The price changed to $25.07. Check it and tick the box again. Nothing was charged.', maxCents: 2507, closesIso: shown.closesIso })
    expect(h.square.saveCardCalls).toHaveLength(0)
    expect(h.findOrCreate).not.toHaveBeenCalled()
    expect((await getWaitlist(cls.id)).entries).toHaveLength(0)
    // Ticking again with the new terms joins, and the stored consent is exactly the new text.
    const fresh = shownFor(cls)!
    const ok = await call(joinBody(cls, { consentShown: fresh }))
    expect(ok.status).toBe(200)
    expect((await getWaitlist(cls.id)).entries[0].consent).toMatchObject({ text: fresh.text, textVersion: 'wl-consent-5' })
    expect(fresh.text).toContain('It’s never more than $25.07, even if the price goes up later, and they won’t ask again first.')
  })

  it('I2: a changed close time, changed words, or a page too old to send the consent are refused too', async () => {
    const cls = makeClass()
    await fill(cls)
    const shown = shownFor(cls)!
    const closes = await call(joinBody(cls, { consentShown: { ...shown, closesIso: '2026-10-17T12:00:00.000Z' } }))
    expect(await closes.json()).toMatchObject({ code: 'consent_changed', detail: 'The waitlist now closes Thu, Oct 15 at 10 AM. Check it and tick the box again. Nothing was charged.' })
    // Words that no longer carry the amount are refused, and the reply carries today's words.
    const words = await call(joinBody(cls, { consentShown: { ...shown, text: shown.text.replace(/\$[\d.]+/, 'whatever it costs') } }))
    expect(await words.json()).toMatchObject({ code: 'consent_changed', text: shown.text })
    const date = await call(joinBody(cls, { consentShown: { ...shown, firstStartIso: '2026-10-31T15:00:00.000Z' } }))
    expect((await date.json()).code).toBe('consent_changed')
    const old = await call(joinBody(cls, { consentShown: undefined }))
    expect(await old.json()).toMatchObject({ code: 'consent_changed', detail: 'The details changed. Check them and tick the box again. Nothing was charged.' })
    expect(h.square.saveCardCalls).toHaveLength(0)
  })

  it('M-a: a class renamed while the panel was open joins (stable ids decide); the words shown are stored as shown', async () => {
    const cls = makeClass()
    await fill(cls)
    const shown = shownFor(cls)!
    cls.content.name = 'Potholder Looms (new name)'
    const res = await call(joinBody(cls, { consentShown: shown }))
    expect(res.status).toBe(200)
    expect((await getWaitlist(cls.id)).entries[0].consent).toMatchObject({ text: shown.text, textVersion: 'as-shown' })
  })

  it('M-a: spacing differences (a narrow space before AM) are the same words', async () => {
    const cls = makeClass()
    await fill(cls)
    const shown = shownFor(cls)!
    const res = await call(joinBody(cls, { consentShown: { ...shown, text: shown.text.replace(/ AM/g, '\u202fAM') } }))
    expect(res.status).toBe(200)
    expect((await getWaitlist(cls.id)).entries[0].consent).toMatchObject({ text: shown.text, textVersion: 'wl-consent-5' })
  })

  it('wl-consent-3: an older page’s wl-consent-2 words (same amount and close time) still join, kept as shown', async () => {
    const cls = makeClass()
    await fill(cls)
    const shown = shownFor(cls)!
    const v2 = shown.text.replace(', even if the price goes up later,', '')
    const res = await call(joinBody(cls, { consentShown: { ...shown, text: v2 } }))
    expect(res.status).toBe(200)
    expect((await getWaitlist(cls.id)).entries[0].consent).toMatchObject({ text: v2, textVersion: 'as-shown' })
  })

  it('M-f: in production with no signing secret the join is refused before any card is saved (no dev fallback)', async () => {
    const cls = makeClass()
    await fill(cls)
    const before = { secret: process.env.LOOKUP_SIGNING_SECRET, prod: process.env.PROD }
    delete process.env.LOOKUP_SIGNING_SECRET
    process.env.PROD = 'true'
    try {
      const res = await call(joinBody(cls))
      expect(res.status).toBeGreaterThanOrEqual(500)
      expect(h.square.saveCardCalls).toHaveLength(0)
      expect((await getWaitlist(cls.id)).entries).toHaveLength(0)
    } finally {
      if (before.secret === undefined) delete process.env.LOOKUP_SIGNING_SECRET; else process.env.LOOKUP_SIGNING_SECRET = before.secret
      if (before.prod === undefined) delete process.env.PROD; else process.env.PROD = before.prod
    }
  })

  it('M4: the consent keeps only a keyed hash of the IP', async () => {
    const { createHash } = await import('node:crypto')
    const cls = makeClass()
    await fill(cls)
    await call(joinBody(cls))
    const e = (await getWaitlist(cls.id)).entries[0]
    expect(e.consent.ipHash).toMatch(/^[0-9a-f]{16}$/)
    expect(e.consent.ipHash).not.toBe(createHash('sha256').update(`ip:203.0.113.${ip % 250}`).digest('hex').slice(0, 16))
  })

  it('a draft or cancelled class takes no waitlist', async () => {
    const cls = makeClass({ status: 'cancelled' })
    expect((await call(joinBody(cls))).status).toBe(409)
  })
})

describe('waitlist leave', () => {
  async function joined() {
    const cls = makeClass()
    await fill(cls)
    await call(joinBody(cls))
    const token = decodeURIComponent(mail.joined.mock.calls.at(-1)![0].leaveUrl.split('/classes/waitlist/')[1])
    return { cls, token }
  }

  it('leave by token: off the list, card disabled, "You\'re off the waitlist" email', async () => {
    const { cls, token } = await joined()
    const res = await call({ action: 'leave', token })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ result: 'left', cardOff: true, className: 'Potholder Looms' })
    const e = (await getWaitlist(cls.id)).entries[0]
    expect(e.state).toBe('left')
    expect(e.cardOffAt).toBeTruthy()
    expect(h.square.disableCardCalls).toEqual([e.square.cardId])
    expect(mail.off).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', byStudio: false }))
    // Twice: already off, nothing more happens.
    const again = await call({ action: 'leave', token })
    expect((await again.json()).data.result).toBe('already-off')
    expect(h.square.disableCardCalls).toHaveLength(1)
  })

  it('C1: leaving while a charge is being made or checked → "checking", written down, nothing taken off yet', async () => {
    const { cls, token } = await joined()
    const { updateEntry } = await import('@lib/classes/waitlist-store')
    const e0 = (await getWaitlist(cls.id)).entries[0]
    await updateEntry(cls.id, e0.id, (e) => ({ ...e, state: 'charging', attempts: [{ n: 1, at: NOW.toISOString(), attemptId: `wl:${e.id}:1`, bookingId: 'bkg_x', orderId: 'ORD', amountCents: 2180, note: 'n', outcome: 'unknown', sentAt: NOW.toISOString() }] }), null)
    const res = await call({ action: 'leave', token })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ result: 'checking', className: 'Potholder Looms' })
    const e = (await getWaitlist(cls.id)).entries[0]
    expect(e).toMatchObject({ state: 'charging', leaveAskedAt: NOW.toISOString() })
    expect(h.square.disableCardCalls).toHaveLength(0)
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect(WAITLIST_MESSAGES.leaveAsked).toBe('We’re checking with Square whether your card was charged. If it wasn’t, nothing will be. You come off the waitlist and your card comes off. If it was, you’re in the class. We’ll email you either way.')
  })

  it('a wrong token gets the same 404 as a missing one', async () => {
    const { token } = await joined()
    const wrong = token.slice(0, -3) + (token.endsWith('aaa') ? 'bbb' : 'aaa')
    const a = await call({ action: 'leave', token: wrong })
    const b = await call({ action: 'leave', token: 'nonsense' })
    expect(a.status).toBe(404)
    expect(b.status).toBe(404)
    expect(await a.json()).toEqual(await b.json())
    expect(h.square.disableCardCalls).toHaveLength(0)
  })
})

describe('public view', () => {
  it('counts the people waiting per date and says whether the waitlist can be joined', async () => {
    const cls = makeClass()
    await fill(cls)
    await call(joinBody(cls))
    const w = toPublicClass(cls, await getLedger(cls.id), NOW, {}, await getWaitlist(cls.id))
    expect(w.own!.sessions[0].waitlist).toEqual({ open: true, closesIso: '2026-10-15T15:00:00.000Z', waiting: 1 })
    const after = toPublicClass(cls, await getLedger(cls.id), new Date('2026-10-15T15:00:00.000Z'), {}, await getWaitlist(cls.id))
    expect(after.own!.sessions[0].waitlist!.open).toBe(false)
    // At the door there's no waitlist.
    expect(toPublicClass(cls, await getLedger(cls.id), NOW, { door: true }).own!.sessions[0].waitlist).toBeUndefined()
  })
})

describe('/admin waitlist (owners)', () => {
  it('lists in order with what happened; Remove takes them off, card off file, email sent, audited', async () => {
    vi.doMock('@lib/admin-auth', async (orig) => ({ ...(await orig<typeof import('@lib/admin-auth')>()), adminAuthorized: () => true }))
    vi.resetModules()
    const admin = await import('@pages/api/admin/classes/waitlist.json')
    const { POST: join } = await import('@pages/api/classes/waitlist.json')
    const cls = makeClass()
    await fill(cls)
    const j = (body: any) => join({ clientAddress: '198.51.100.9', request: new Request('https://x/api/classes/waitlist.json', { method: 'POST', body: JSON.stringify(body) }) } as any)
    await j(joinBody(cls))
    await j(joinBody(cls, { customer: { ...customer, email: 'sam@example.com', givenName: 'Sam' } }))
    const list = await (await admin.GET({ request: new Request('https://x'), url: new URL(`https://x/?id=${cls.id}`) } as any)).json()
    expect(list.data.rows.map((r: any) => [r.position, r.name, r.state, r.stateWords, r.card])).toEqual([
      [1, 'Jane Doe', 'waiting', 'Waiting', 'Visa ending 4242'],
      [2, 'Sam Doe', 'waiting', 'Waiting', 'Visa ending 4242'],
    ])
    const first = list.data.rows[0]
    const res = await admin.POST({ request: new Request('https://x', { method: 'POST', headers: { 'X-Admin-Who': 'Catherine' }, body: JSON.stringify({ action: 'remove', classId: cls.id, entryId: first.id }) }) } as any)
    const out = await res.json()
    expect(res.status).toBe(200)
    expect(out.data.rows.map((r: any) => [r.position, r.name, r.state])).toEqual([[null, 'Jane Doe', 'removed'], [1, 'Sam Doe', 'waiting']])
    expect(out.data.rows[0].history.at(-1).change).toMatch(/^Taken off by /)
    expect(mail.off).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', byStudio: true }))
    // Twice: refused in words, nothing more disabled.
    const again = await admin.POST({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ action: 'remove', classId: cls.id, entryId: first.id }) }) } as any)
    expect(again.status).toBe(409)
    vi.doUnmock('@lib/admin-auth')
  })

  it('Task 12: Take the card off now — only for someone off the list; a failure says so and nothing is charged; audited', async () => {
    vi.doMock('@lib/admin-auth', async (orig) => ({ ...(await orig<typeof import('@lib/admin-auth')>()), adminAuthorized: () => true }))
    vi.resetModules()
    const admin = await import('@pages/api/admin/classes/waitlist.json')
    const { POST: join } = await import('@pages/api/classes/waitlist.json')
    const { updateEntry } = await import('@lib/classes/waitlist-store')
    const cls = makeClass()
    await fill(cls)
    await join({ clientAddress: '198.51.100.9', request: new Request('https://x/api/classes/waitlist.json', { method: 'POST', body: JSON.stringify(joinBody(cls)) }) } as any)
    const entry = (await getWaitlist(cls.id)).entries[0]
    const post = (body: any) => admin.POST({ request: new Request('https://x', { method: 'POST', headers: { 'X-Admin-Who': 'Catherine' }, body: JSON.stringify(body) }) } as any)
    // Still waiting: their card stays on file.
    const still = await post({ action: 'card-off', classId: cls.id, entryId: entry.id })
    expect(still.status).toBe(409)
    expect(h.square.disableCardCalls).toEqual([])
    // Off the list, card not confirmed off (the sweep's retries failed so far).
    await updateEntry(cls.id, entry.id, (e) => ({ ...e, state: 'declined' }), null)
    const listed = await (await admin.GET({ request: new Request('https://x'), url: new URL(`https://x/?id=${cls.id}`) } as any)).json()
    expect(listed.data.rows[0].cardOn).toBe(true)
    const realDisable = h.square.disableCard.bind(h.square)
    h.square.disableCard = vi.fn(async () => { throw new Error('Square down') })
    const failed = await post({ action: 'card-off', classId: cls.id, entryId: entry.id })
    expect(failed.status).toBe(502)
    expect((await failed.json()).error).toMatch(/^Square didn’t take the card off just now\. Nothing was charged\./)
    h.square.disableCard = realDisable
    const done = await post({ action: 'card-off', classId: cls.id, entryId: entry.id })
    expect(done.status).toBe(200)
    expect((await done.json()).data.rows[0].cardOn).toBe(false)
    expect(h.square.disableCardCalls).toEqual([entry.square.cardId])
    expect((await getWaitlist(cls.id)).entries[0].cardOffAt).toBeTruthy()
    const { recordAudit } = await import('@lib/audit')
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'waitlist-card-off', details: { entryId: entry.id, off: true } }))
    vi.doUnmock('@lib/admin-auth')
  })
})
