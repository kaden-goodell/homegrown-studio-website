import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ square: null as any, findOrCreate: vi.fn(), classes: new Map<string, any>() }))
vi.mock('@config/providers', () => ({
  providers: {
    customer: { findOrCreate: (...a: any[]) => h.findOrCreate(...a) },
    get payment() { return h.square },
  },
}))
vi.mock('@lib/classes/class-store', () => ({ getClass: async (id: string) => h.classes.get(id) ?? null }))
const mail = vi.hoisted(() => ({ joined: vi.fn(), off: vi.fn(), missed: vi.fn(), confirm: vi.fn(), refund: vi.fn(), plain: vi.fn() }))
vi.mock('@lib/email', () => ({
  sendWaitlistJoinedEmail: (...a: any[]) => mail.joined(...a),
  sendWaitlistOffEmail: (...a: any[]) => mail.off(...a),
  sendWaitlistMissedEmail: (...a: any[]) => mail.missed(...a),
  sendWorkshopConfirmationEmail: (...a: any[]) => mail.confirm(...a),
  sendRefundEmail: (...a: any[]) => mail.refund(...a),
  sendEmail: (...a: any[]) => mail.plain(...a),
}))
const texts = vi.hoisted(() => vi.fn(async (_: { to: string; content: string }) => undefined))
vi.mock('@lib/quo', () => ({ sendQuoText: texts }))
const owners = vi.hoisted(() => vi.fn(async (_: string) => ({ attempted: 1, sent: 1 })))
vi.mock('@lib/owner-alert', () => ({ alertOwners: owners }))
const setupAlert = vi.hoisted(() => vi.fn(async () => true))
vi.mock('@lib/saved-card-alerts', () => ({ alertCardSetupOnce: setupAlert }))
vi.mock('@lib/audit', () => ({ recordAudit: vi.fn(async () => undefined) }))

import { MockPaymentProvider } from '@providers/mock/payment'
import { getLedger, hold, release } from '@lib/classes/seat-ledger'
import { quote } from '@lib/classes/pricing'
import { defaultRules } from '@lib/classes/validate'
import { getWaitlist } from '@lib/classes/waitlist-store'
import { closeWaitlist, joinWaitlist } from '@lib/classes/waitlist'
import { chargeSaved, runWaitlist, sweepWaitlists } from '@lib/classes/waitlist-runner'
import { waitlistGoesFirst } from '@lib/classes/waitlist-rules'
import { classRefundBook } from '@lib/classes/refunds'
import type { ScheduledClass } from '@lib/classes/types'

const NOW = new Date('2026-10-10T17:00:00.000Z')
let seq = 0
const attempt = () => `9a2b8a0e-5c1d-4e7a-9b3c-${(++seq).toString(16).padStart(12, '0')}`

function makeClass(over: { capacity?: number; startIso?: string } = {}): ScheduledClass {
  const id = `cls_run${Date.now().toString(36)}${++seq}`
  const start = over.startIso ?? '2026-10-24T15:00:00.000Z'
  const cls: ScheduledClass = {
    id, libraryId: null, libraryVersion: null,
    content: {
      name: 'Potholder Looms', description: 'Weave.', imageUrl: null, instructor: null, rules: defaultRules(),
      ticketTypes: [{ id: 'person', label: 'Person' }], passes: [{ id: 'all', label: 'All', covers: { kind: 'all' } }],
      prices: { all: { person: 2000 } }, questions: [], addOns: [], defaultCapacity: 1, defaultMinutes: 120,
    },
    sessions: [{ id: 'ses_1', startIso: start, endIso: new Date(Date.parse(start) + 7_200_000).toISOString(), capacity: over.capacity ?? 1 }],
    status: 'open', square: { itemId: 'ITEM', variations: { 'all:person': 'VAR' } },
    createdAt: '', updatedAt: '', by: { id: 'k', name: 'Kaden' }, history: [],
  }
  h.classes.set(id, cls)
  return cls
}

/** Someone else holds every seat; returns their booking id so the test can free it. */
async function fill(cls: ScheduledClass, seats = cls.sessions[0].capacity): Promise<string> {
  const q = quote(cls, { passId: 'all', tickets: { person: seats } }, NOW, 9)
  if (!q.ok) throw new Error(q.error)
  const bookingId = `bkg_fill${++seq}`
  await hold(cls, q.value, { bookingId, passId: 'all', source: 'online', customer: null, ttlMinutes: 60 * 24 * 30 }, NOW)
  return bookingId
}

const person = (given: string, phone = '(402) 980-2907') => ({ givenName: given, familyName: 'Doe', email: `${given.toLowerCase()}@example.com`, phone })
async function join(cls: ScheduledClass, given: string, token = 'cnon:card-nonce-ok', seats = 1) {
  return joinWaitlist({
    classId: cls.id, attemptId: attempt(), request: { passId: 'all', tickets: { person: seats } }, customer: person(given),
    cardToken: token, verificationToken: null, consent: true, ip: '1.2.3.4', origin: 'https://ourhometownstudio.com',
  }, NOW)
}
const entries = async (cls: ScheduledClass) => (await getWaitlist(cls.id)).entries

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  h.square = new MockPaymentProvider()
  h.square.prices = { VAR: 2000 }
  h.findOrCreate.mockImplementation(async (p: any) => ({ id: `cust-${p.givenName}`, email: p.email }))
  for (const m of Object.values(mail)) m.mockResolvedValue({ sent: true })
})
afterEach(() => vi.useRealTimers())

describe('runWaitlist', () => {
  it('a freed seat adds the first waiting person and charges their saved card, never above what they agreed to', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await join(cls, 'Sam')
    await release(cls.id, other)

    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r).toMatchObject({ ran: true, added: 1, declined: 0, stopped: null })
    const [jane, sam] = await entries(cls)
    expect(jane.state).toBe('added')
    expect(sam.state).toBe('waiting')

    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
    const c = h.square.chargeSavedCardCalls[0]
    expect(c).toMatchObject({ cardId: jane.square.cardId, customerId: 'cust-Jane', amount: 2180, idempotencyKey: `wl:${jane.id}:1:pay`, buyerEmailAddress: 'jane@example.com' })
    expect(c.amount).toBeLessThanOrEqual(jane.maxCents)
    expect(c.idempotencyKey.length).toBeLessThanOrEqual(45)
    expect(h.square.classOrderCalls[0]).toMatchObject({ idempotencyKey: `wl:${jane.id}:1:order`, customerId: 'cust-Jane', referenceId: jane.bookingId })

    const lines = (await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.bookingId)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ state: 'confirmed', source: 'online', waitlistEntryId: jane.id, square: { chargedCents: 2180 } })
    // The card comes off file once they're added (OWNER-S4-3).
    expect(h.square.disableCardCalls).toEqual([jane.square.cardId])
    expect(texts).toHaveBeenCalledWith({ to: '(402) 980-2907', content: 'Hometown Studio here. A spot opened in Potholder Looms on Sat, Oct 24 at 10 AM and you\'re in! We charged $21.80 to your card ending 4242. See you there.' })
    expect(mail.confirm).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', lead: 'A spot opened and you’re in! We charged $21.80 to your card ending 4242.', totalChargedCents: 2180 }))
    expect(owners).toHaveBeenCalledWith('Waitlist added Jane Doe to Potholder Looms ($21.80).')

    // Nothing more is free: running again charges nobody.
    await runWaitlist(cls.id, { reason: 'sweep' }, NOW)
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
  })

  it('two runners: the refund route, the webhook and the sweep at once → one payment', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await join(cls, 'Sam')
    await release(cls.id, other)
    const rs = await Promise.all([
      runWaitlist(cls.id, { reason: 'seat-freed' }, NOW),
      runWaitlist(cls.id, { reason: 'seat-freed' }, NOW),
      sweepWaitlists(NOW, { ids: [cls.id] }),
    ])
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
    expect((await entries(cls)).map((e) => e.state)).toEqual(['added', 'waiting'])
    expect(rs.filter((x: any) => x.stopped === 'busy').length).toBeGreaterThanOrEqual(1)
  })

  it('decline moves on: the first card declines, the second person is added, owners alerted once', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'DECLINE_LATER')
    await join(cls, 'Sam')
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r).toMatchObject({ added: 1, declined: 1 })
    const [jane, sam] = await entries(cls)
    expect(jane.state).toBe('declined')
    expect(jane.attempts[0]).toMatchObject({ outcome: 'declined', trouble: 'declined' })
    expect(sam.state).toBe('added')
    expect(h.square.disableCardCalls).toEqual([jane.square.cardId, sam.square.cardId])
    // Jane's hold was let go: only Sam holds the seat.
    expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.attempts[0].bookingId).every((l) => l.state === 'released')).toBe(true)
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', why: 'declined' }))
    expect(texts).toHaveBeenCalledWith({ to: '(402) 980-2907', content: 'Hometown Studio here. A spot opened in Potholder Looms but your card ending 4242 didn\'t go through, so it went to the next person. You can join the waitlist again on our site.' })
    expect(owners.mock.calls.filter(([t]) => /didn't go through/.test(t))).toHaveLength(1)
    expect(owners.mock.calls.find(([t]) => /didn't go through/.test(t))![0]).toContain('(the card was declined)')
  })

  it('a card disabled since joining → the declined path, never retried as unknown', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).enabled = false
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect((await entries(cls))[0].state).toBe('declined')
  })

  it('no answer stops: seat held a day, run stops, later Square says unpaid → the SAME charge is resent once', async () => {
    const cls = makeClass({ capacity: 2 })
    const other = await fill(cls, 2)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await join(cls, 'Sam')
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r).toMatchObject({ unknown: 1, stopped: 'unknown', added: 0 })
    let [jane, sam] = await entries(cls)
    expect(jane.state).toBe('charging')
    expect(jane.attempts[0]).toMatchObject({ outcome: 'unknown', amountCents: 2180, orderId: expect.any(String) })
    expect(sam.state).toBe('waiting') // the run stopped
    const held = (await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)!
    expect(Date.parse(held.holdExpiresAt!) - NOW.getTime()).toBe(24 * 3_600_000)
    expect(owners.mock.calls.filter(([t]) => /unclear/.test(t))).toHaveLength(1)

    // The bank answers next time.
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60_000))
    await sweepWaitlists(new Date(NOW.getTime() + 10 * 60_000), { ids: [cls.id] })
    ;[jane, sam] = await entries(cls)
    expect(jane.state).toBe('added')
    const janeCalls = h.square.chargeSavedCardCalls.filter((c: any) => c.cardId === jane.square.cardId)
    expect(janeCalls).toHaveLength(2)
    expect(janeCalls[1]).toEqual(janeCalls[0]) // identical details, same key: Square can't charge twice
    expect(sam.state).toBe('added') // a second seat was free
    expect(owners.mock.calls.filter(([t]) => /unclear/.test(t))).toHaveLength(1)
  })

  it('no answer, then Square shows it paid → added, never charged again', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    vi.spyOn(h.square, 'findOrderPayment').mockResolvedValue({ id: 'PAY-LATE', orderId: jane.attempts[0].orderId, amount: 2180, status: 'completed' })
    await runWaitlist(cls.id, { reason: 'sweep' }, new Date(NOW.getTime() + 60_000))
    expect((await entries(cls))[0]).toMatchObject({ state: 'added' })
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
    expect((await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)).toMatchObject({ state: 'confirmed', square: { paymentId: 'PAY-LATE' } })
  })

  it('a lost reply that did charge is found paid at once (LOST_REPLY_LATER)', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'LOST_REPLY_LATER')
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.added).toBe(1)
    expect((await entries(cls))[0].state).toBe('added')
  })

  it('setup: Square refuses the request → nobody touched, card kept, the run stops, owners alerted once', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'SETUP_LATER')
    await join(cls, 'Sam')
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.stopped).toBe('setup')
    const [jane, sam] = await entries(cls)
    expect(jane.state).toBe('waiting')
    expect(jane.attempts[0].outcome).toBe('setup')
    expect(sam.state).toBe('waiting')
    expect(h.square.disableCardCalls).toHaveLength(0)
    expect(texts).not.toHaveBeenCalled()
    expect(mail.missed).not.toHaveBeenCalled()
    expect(setupAlert).toHaveBeenCalledWith('charge', NOW)
    expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.attempts[0].bookingId).every((l) => l.state === 'released')).toBe(true)
  })

  it('fix3 review: a NOT_FOUND about OUR order is setup (nobody blamed); one about the card is declined', async () => {
    const nf = (detail: string, field: string) => Object.assign(new Error(detail), { statusCode: 404, errors: [{ code: 'NOT_FOUND', detail, field, category: 'INVALID_REQUEST_ERROR' }] })
    h.square.chargeSavedCard = vi.fn().mockRejectedValueOnce(nf('Order not found.', 'order_id')).mockRejectedValueOnce(nf('Card not found.', 'source_id'))
    const input = { orderId: 'O', cardId: 'C', customerId: 'U', amount: 100, idempotencyKey: 'k', email: 'e', note: 'n' }
    expect(await chargeSaved(input)).toMatchObject({ kind: 'setup' })
    expect(await chargeSaved(input)).toMatchObject({ kind: 'declined', trouble: 'card-gone' })
  })

  it('price rose since joining → skipped, never charged, owners told', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    cls.content.prices = { all: { person: 2500 } }
    h.square.prices = { VAR: 2500 }
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.skipped).toBe(1)
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    const jane = (await entries(cls))[0]
    expect(jane).toMatchObject({ state: 'skipped' })
    expect(jane.attempts[0].outcome).toBe('price-rose')
    expect(h.square.disableCardCalls).toEqual([jane.square.cardId])
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ why: 'price' }))
    expect(owners.mock.calls[0][0]).toContain('above the $21.80 they agreed to')
  })

  it('after the cutoff: nobody charged, entries closed (cards off), the seat stays open to the public', async () => {
    const cls = makeClass({ startIso: '2026-10-10T20:00:00.000Z' })
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    const late = new Date('2026-10-10T18:30:00.000Z') // 1.5 h before
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, late)
    expect(r).toMatchObject({ added: 0, closed: 1 })
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect((await entries(cls))[0].state).toBe('closed')
    expect(h.square.disableCardCalls).toHaveLength(1)
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ why: 'closed' }))
    expect((await getLedger(cls.id)).lines.filter((l) => l.state === 'held' || l.state === 'confirmed')).toHaveLength(0)
  })

  it('OWNER-S4-1: a group that doesn\'t fit keeps its place; a later smaller group takes the one seat', async () => {
    const cls = makeClass({ capacity: 2 })
    const other = await fill(cls, 2)
    await join(cls, 'Pair', 'cnon:card-nonce-ok', 2)
    await join(cls, 'Solo')
    // One seat frees: only Solo fits.
    await release(cls.id, other)
    await fill(cls, 1)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect((await entries(cls)).map((e) => [e.customer.givenName, e.state])).toEqual([['Pair', 'waiting'], ['Solo', 'added']])
  })

  it('goodwill never runs: a refund that keeps the seat doesn\'t start the waitlist; one that frees it does', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    const book = await classRefundBook(cls.id, 'bkg_any', { cls })
    await book.afterWrite!({ freeSeat: false } as any, [] as any)
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    await book.afterWrite!({ freeSeat: true } as any, [{ sessionIds: ['ses_1'] }] as any)
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
  })

  it('cancelling closes the list without charging; cards come off', async () => {
    const cls = makeClass()
    await fill(cls)
    await join(cls, 'Jane')
    cls.status = 'cancelled'
    await closeWaitlist(cls.id, NOW)
    expect((await entries(cls))[0].state).toBe('closed')
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect(h.square.disableCardCalls).toHaveLength(1)
    expect(mail.missed).not.toHaveBeenCalled()
  })
})

describe('waitlist first', () => {
  it('refuses a public hold that the next waiting entry needs, allows one that leaves them room', async () => {
    const cls = makeClass({ capacity: 3 })
    const other = await fill(cls, 3)
    await join(cls, 'Jane')
    await release(cls.id, other)
    await fill(cls, 2) // 1 free, Jane needs 1
    const ledger = await getLedger(cls.id)
    const list = await getWaitlist(cls.id)
    expect(waitlistGoesFirst(cls, ledger, list, ['ses_1'], 1, NOW)).toBe('ses_1')
    // Nobody fits (Jane wants 2, 1 free): the public can book it.
    const cls2 = makeClass({ capacity: 3 })
    const o2 = await fill(cls2, 3)
    await join(cls2, 'Pair', 'cnon:card-nonce-ok', 2)
    await release(cls2.id, o2)
    await fill(cls2, 2)
    expect(waitlistGoesFirst(cls2, await getLedger(cls2.id), await getWaitlist(cls2.id), ['ses_1'], 1, NOW)).toBeNull()
    // After the cutoff the waitlist no longer goes first.
    expect(waitlistGoesFirst(cls, ledger, list, ['ses_1'], 1, new Date('2026-10-24T13:30:00.000Z'))).toBeNull()
  })
})

describe('Catherine sees and acts (To decide, warnings, /admin run)', () => {
  it('an unclear charge is a To decide item; "Check Square again" adds them once Square answers', async () => {
    const { listToDecide, decide } = await import('@lib/classes/to-decide')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const { items } = await listToDecide(NOW)
    const item = items.find((i) => i.kind === 'waitlist-unknown' && i.classId === cls.id)!
    expect(item).toMatchObject({ title: 'Waitlist charge unclear', className: 'Potholder Looms' })
    expect(item.head).toContain('Square didn’t say whether it went through. Their seat is held')
    // Still no answer: refused in words, stays waiting.
    await expect(decide(item.id, 'check', {}, { id: 'owner-catherine', name: 'Catherine' }, new Date(NOW.getTime() + 60_000))).rejects.toThrow(/Square still hasn’t said/)
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    const r = await decide(item.id, 'check', {}, { id: 'owner-catherine', name: 'Catherine' }, new Date(NOW.getTime() + 120_000))
    expect(r.decided.what).toBe('Square showed it paid. They’re added')
    expect((await entries(cls))[0].state).toBe('added')
  })

  it('"I sorted it out in Square" lets the held seat go and takes them off, nobody told', async () => {
    const { listToDecide, decide } = await import('@lib/classes/to-decide')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'waitlist-unknown' && i.classId === cls.id)!
    texts.mockClear()
    await decide(item.id, 'sorted', {}, { id: 'owner-catherine', name: 'Catherine' }, NOW)
    const jane = (await entries(cls))[0]
    expect(jane.state).toBe('removed')
    expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.attempts[0].bookingId).every((l) => l.state === 'released')).toBe(true)
    expect(texts).not.toHaveBeenCalled()
  })

  it('a declined card shows in To decide and the warnings until "Got it"', async () => {
    const { listToDecide, decide } = await import('@lib/classes/to-decide')
    const { waitlistItems } = await import('@lib/classes/waitlist-items')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'DECLINE_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const w = await waitlistItems(cls, new Set(), NOW)
    expect(w.map((x) => [x.kind, x.warning])).toEqual([['waitlist-declined', 'Potholder Looms: Jane Doe’s card ending 4242 didn’t go through, so the seat went to the next person. Not charged.']])
    const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'waitlist-declined' && i.classId === cls.id)!
    expect(item.detail).toMatchObject({ phone: '(402) 980-2907', email: 'jane@example.com' })
    await decide(item.id, 'seen', {}, { id: 'owner-catherine', name: 'Catherine' }, NOW)
    const { decidedIds } = await import('@lib/classes/decided')
    expect(await waitlistItems(cls, await decidedIds(), NOW)).toEqual([])
  })

  it('/admin "Run the waitlist now" adds who fits and says what happened', async () => {
    vi.doMock('@lib/admin-auth', async (orig) => ({ ...(await orig<typeof import('@lib/admin-auth')>()), adminAuthorized: () => true }))
    vi.resetModules()
    const admin = await import('@pages/api/admin/classes/waitlist.json')
    const { joinWaitlist: join2 } = await import('@lib/classes/waitlist')
    const ledger = await import('@lib/classes/seat-ledger')
    const cls = makeClass()
    const q = quote(cls, { passId: 'all', tickets: { person: 1 } }, NOW, 9)
    if (!q.ok) throw new Error()
    await ledger.hold(cls, q.value, { bookingId: 'bkg_admfill', passId: 'all', source: 'online', customer: null, ttlMinutes: 600 }, NOW)
    await join2({ classId: cls.id, attemptId: attempt(), request: { passId: 'all', tickets: { person: 1 } }, customer: person('Jane'), cardToken: 'cnon:ok', verificationToken: null, consent: true, ip: '', origin: 'https://x' }, NOW)
    const get = async () => (await admin.GET({ request: new Request('https://x'), url: new URL(`https://x/?id=${cls.id}`) } as any)).json()
    expect((await get()).data.canRun).toBe(false)
    await ledger.release(cls.id, 'bkg_admfill')
    expect((await get()).data.canRun).toBe(true)
    const res = await admin.POST({ request: new Request('https://x', { method: 'POST', headers: { 'X-Admin-Who': 'Catherine' }, body: JSON.stringify({ action: 'run', classId: cls.id }) }) } as any)
    const out = await res.json()
    expect(out.data.run).toMatchObject({ added: 1 })
    expect(out.data.run.note).toBe('Added 1 person and charged their saved card.')
    expect(out.data.rows[0]).toMatchObject({ state: 'added', stateWords: 'Added · $21.80 charged' })
    vi.doUnmock('@lib/admin-auth')
  })
})
