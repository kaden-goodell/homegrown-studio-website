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
/** Audit A I2: classes & workshops open/paused online (More › Online booking). */
const gate = vi.hoisted(() => ({ open: true }))
vi.mock('@lib/bookings-gate', () => ({ waitlistChargesAllowedNow: async () => gate.open }))

import { MockPaymentProvider } from '@providers/mock/payment'
import { getLedger, hold, release } from '@lib/classes/seat-ledger'
import { quote } from '@lib/classes/pricing'
import { defaultRules } from '@lib/classes/validate'
import { getWaitlist } from '@lib/classes/waitlist-store'
import { closeWaitlist, consentFor, joinWaitlist } from '@lib/classes/waitlist'
import { askAboutEntry, chargeSaved, runWaitlist, sweepWaitlists } from '@lib/classes/waitlist-runner'
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
/** I2: the consent as the panel shows it. */
function shown(cls: ScheduledClass, seats = 1) {
  const q = quote(cls, { passId: 'all', tickets: { person: seats } }, NOW, 9)
  if (!q.ok) throw new Error(q.error)
  const c = consentFor(cls, q.value.sessionIds, q.value.totalCents)!
  return { maxCents: q.value.totalCents, closesIso: c.closesIso, text: c.text }
}
async function join(cls: ScheduledClass, given: string, token = 'cnon:card-nonce-ok', seats = 1) {
  return joinWaitlist({
    classId: cls.id, attemptId: attempt(), request: { passId: 'all', tickets: { person: seats } }, customer: person(given),
    cardToken: token, verificationToken: null, consent: true, consentShown: shown(cls, seats), ip: '1.2.3.4', origin: 'https://ourhometownstudio.com',
  }, NOW)
}
const entries = async (cls: ScheduledClass) => (await getWaitlist(cls.id)).entries

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.clearAllMocks()
  gate.open = true
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

  it('D6: the early-bird ended after they joined at $20 → charged the $20 they agreed to (+ tax), the difference off on the Square line', async () => {
    const cls = makeClass()
    cls.content.prices = { all: { person: 3000 } }
    cls.content.earlyBird = { untilYmd: '2026-10-11', prices: { all: { person: 2000 } } }
    cls.square.prices = { 'all:person': 2000 }
    h.square.prices = { VAR: 2000 }
    const other = await fill(cls)
    await join(cls, 'Jane')
    const joined = (await entries(cls))[0]
    expect(joined.maxCents).toBe(2180)
    expect(joined.agreedLines).toEqual([{ key: 'all:person', seat: 0, cents: 2000 }])

    // Days later: the early-bird is over and the register is back at $30.
    const LATER = new Date('2026-10-14T17:00:00.000Z')
    vi.setSystemTime(LATER)
    cls.square.prices = { 'all:person': 3000 }
    h.square.prices = { VAR: 3000 }
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, LATER)
    expect(r).toMatchObject({ added: 1, skipped: 0, stopped: null })
    expect(h.square.classOrderCalls[0].lineDiscounts).toEqual([{ line: 0, name: 'Waitlist price', cents: 1000 }])
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
    expect(h.square.chargeSavedCardCalls[0].amount).toBe(2180)
    const jane = (await entries(cls))[0]
    expect(jane.state).toBe('added')
    const line = (await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.bookingId)!
    expect(line).toMatchObject({ state: 'confirmed', square: { chargedCents: 2180 } })
    expect(mail.missed).not.toHaveBeenCalled()
  })

  it('D6: the price rose since joining → still charged the $20 they agreed to (+ tax)', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    cls.content.prices = { all: { person: 2500 } }
    cls.square.prices = { 'all:person': 2500 }
    h.square.prices = { VAR: 2500 }
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r).toMatchObject({ added: 1, skipped: 0 })
    expect(h.square.classOrderCalls[0].lineDiscounts).toEqual([{ line: 0, name: 'Waitlist price', cents: 500 }])
    expect(h.square.chargeSavedCardCalls[0].amount).toBe(2180)
    expect(owners).not.toHaveBeenCalledWith(expect.stringContaining('skipped'))
  })

  it('D6: an entry saved before D6 (no agreed lines) gets them from the class as priced when it joined (early-bird ended → $20)', async () => {
    const cls = makeClass()
    cls.content.prices = { all: { person: 3000 } }
    cls.content.earlyBird = { untilYmd: '2026-10-11', prices: { all: { person: 2000 } } }
    const other = await fill(cls)
    await join(cls, 'Jane')
    const { mutateWaitlist } = await import('@lib/classes/waitlist-store')
    await mutateWaitlist(cls.id, (cur) => ({ next: { ...cur, entries: cur.entries.map(({ agreedLines: _x, ...e }) => e) }, result: null }))
    expect((await entries(cls))[0].agreedLines).toBeUndefined()
    const LATER = new Date('2026-10-14T17:00:00.000Z')
    vi.setSystemTime(LATER)
    cls.square.prices = { 'all:person': 3000 }
    h.square.prices = { VAR: 3000 }
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, LATER)
    expect(r).toMatchObject({ added: 1, skipped: 0 })
    expect(h.square.chargeSavedCardCalls[0].amount).toBe(2180)
  })

  it('an older entry whose join price can’t be worked out, with today’s total above what they agreed to → skipped, never charged, owners told', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    const { mutateWaitlist } = await import('@lib/classes/waitlist-store')
    await mutateWaitlist(cls.id, (cur) => ({ next: { ...cur, entries: cur.entries.map(({ agreedLines: _x, ...e }) => e) }, result: null }))
    cls.content.prices = { all: { person: 2500 } }
    h.square.prices = { VAR: 2500 }
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.skipped).toBe(1)
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    const jane = (await entries(cls))[0]
    expect(jane).toMatchObject({ state: 'skipped' })
    expect(jane.attempts[0].outcome).toBe('price-rose')
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ why: 'price' }))
    expect(owners.mock.calls[0][0]).toContain('above the $21.80 they agreed to')
  })

  it('D6: today’s price is lower than what they agreed to → charged today’s price, no discount', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    cls.content.prices = { all: { person: 1500 } }
    cls.square.prices = { 'all:person': 1500 }
    h.square.prices = { VAR: 1500 }
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r).toMatchObject({ added: 1, skipped: 0 })
    expect(h.square.classOrderCalls[0].lineDiscounts).toBeUndefined()
    expect(h.square.chargeSavedCardCalls[0].amount).toBe(1635)
  })

  it('after the cutoff: nobody charged, entries closed (cards off), the seat stays open to the public', async () => {
    const cls = makeClass({ startIso: '2026-10-12T18:00:00.000Z' })
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    const late = new Date('2026-10-10T18:30:00.000Z') // past the close (48 h before the class, D7)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, late)
    expect(r).toMatchObject({ added: 0, closed: 1 })
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect((await entries(cls))[0].state).toBe('closed')
    expect(h.square.disableCardCalls).toHaveLength(1)
    // N6: a seat WAS free when it closed, so never "No spot opened": they're told it may still be open, with the class link.
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ why: 'closed-open', classUrl: expect.stringContaining(`/classes/${cls.id}`) }))
    expect((await getLedger(cls.id)).lines.filter((l) => l.state === 'held' || l.state === 'confirmed')).toHaveLength(0)
  })

  it('N6: closing with no free seat says "No spot opened" (why closed)', async () => {
    const cls = makeClass({ startIso: '2026-10-12T18:00:00.000Z' })
    await fill(cls)
    await join(cls, 'Jane')
    const late = new Date('2026-10-10T18:30:00.000Z')
    const r = await runWaitlist(cls.id, { reason: 'sweep' }, late)
    expect(r).toMatchObject({ added: 0, closed: 1 })
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ why: 'closed' }))
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

  it('audit A I2: classes paused online → a freed seat charges nobody; once reopened the next run adds them', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    gate.open = false
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r).toMatchObject({ ran: true, added: 0, stopped: 'paused' })
    expect(r.note).toMatch(/paused online, so nobody was charged/)
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect((await entries(cls))[0].state).toBe('waiting')

    gate.open = true
    const again = await runWaitlist(cls.id, { reason: 'sweep' }, NOW)
    expect(again).toMatchObject({ added: 1, stopped: null })
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
  })

  it('final review I12: a seat freed at night charges and texts nobody; the 8 AM run adds them', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    const night = new Date('2026-10-11T04:40:00.000Z') // 11:40 PM Chicago
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, night)
    expect(r).toMatchObject({ ran: true, added: 0, stopped: 'quiet' })
    expect(r.note).toBe('It’s outside 8 AM to 8 PM, so nobody on the waitlist is charged or texted now. It picks up again at 8 AM.')
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect((await entries(cls))[0].state).toBe('waiting')
    const morning = new Date('2026-10-11T13:00:00.000Z') // 8:00 AM Chicago
    const again = await runWaitlist(cls.id, { reason: 'sweep' }, morning)
    expect(again).toMatchObject({ added: 1, stopped: null })
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
  })

  it('audit A I2: an unanswered try is never resent while paused; the same try goes once reopened', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    expect(await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)).toMatchObject({ stopped: 'unknown' })
    let [jane] = await entries(cls)
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    gate.open = false
    const later = new Date(NOW.getTime() + 11 * 60_000)
    vi.setSystemTime(later)
    expect(await runWaitlist(cls.id, { reason: 'sweep' }, later)).toMatchObject({ stopped: 'paused', added: 0 })
    expect(h.square.chargeSavedCardCalls).toHaveLength(1)
    ;[jane] = await entries(cls)
    expect(jane.state).toBe('charging')
    expect((await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)?.state).toBe('held')

    gate.open = true
    expect(await runWaitlist(cls.id, { reason: 'sweep' }, later)).toMatchObject({ added: 1 })
    const calls = h.square.chargeSavedCardCalls
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(calls[0])
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
  it('I5: an unclear charge is a To decide item; the sheet asks Square and only offers what fits (paid → Add them)', async () => {
    const { listToDecide, decide } = await import('@lib/classes/to-decide')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const { items } = await listToDecide(NOW)
    const item = items.find((i) => i.kind === 'waitlist-unknown' && i.classId === cls.id)!
    expect(item).toMatchObject({ title: 'Waitlist charge unclear', className: 'Potholder Looms', hint: 'Ask Square what happened, then decide here' })
    expect(item.head).toContain('Square didn’t say whether it went through. Their seat is held')
    const jane = (await entries(cls))[0]
    const by = { id: 'owner-catherine', name: 'Catherine' }
    // No payment yet and the charge is fresh: only "Check Square again"; Add them / Keep / Take off are refused.
    const early = await askAboutEntry(cls.id, jane.id, new Date(NOW.getTime() + 60_000))
    expect(early).toMatchObject({ state: 'no-payment', choices: [] })
    expect(early.words).toMatch(/^Square shows no payment for this charge yet\. A payment can take a little while to show, so give it until /)
    await expect(decide(item.id, 'add', {}, by, new Date(NOW.getTime() + 60_000))).rejects.toThrow(/doesn’t match what Square shows now/)
    await expect(decide(item.id, 'off', {}, by, new Date(NOW.getTime() + 60_000))).rejects.toThrow(/doesn’t match what Square shows now/)
    // Square shows it paid (a late completion): Add them adds them, never charged again.
    vi.spyOn(h.square, 'orderPaymentStatus').mockResolvedValue({ state: 'paid', payment: { id: 'PAY-LATE', orderId: jane.attempts[0].orderId!, amount: 2180, status: 'completed', createdAt: '2026-10-10T17:05:00.000Z' } })
    const paid = await askAboutEntry(cls.id, jane.id, new Date(NOW.getTime() + 120_000))
    expect(paid).toMatchObject({ state: 'paid', words: 'Square shows it paid ($21.80, 12:05 PM).', choices: ['add'] })
    const calls = h.square.chargeSavedCardCalls.length
    const r = await decide(item.id, 'add', {}, by, new Date(NOW.getTime() + 120_000))
    expect(r.decided.what).toBe('Square showed it paid. They’re added')
    expect((await entries(cls))[0].state).toBe('added')
    expect(h.square.chargeSavedCardCalls).toHaveLength(calls)
    expect((await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)).toMatchObject({ state: 'confirmed', square: { paymentId: 'PAY-LATE' } })
  })

  it('I5: no payment after 30 minutes → Keep them waiting (seat let go, that charge never resent) or Take them off (card off, emailed)', async () => {
    const { listToDecide, decide } = await import('@lib/classes/to-decide')
    const by = { id: 'owner-catherine', name: 'Catherine' }
    for (const choice of ['keep', 'off'] as const) {
      const cls = makeClass()
      const other = await fill(cls)
      await join(cls, 'Jane', 'TIMEOUT_LATER')
      await release(cls.id, other)
      await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
      const item = (await listToDecide(NOW)).items.find((i) => i.kind === 'waitlist-unknown' && i.classId === cls.id)!
      const later = new Date(NOW.getTime() + 31 * 60_000)
      const jane = (await entries(cls))[0]
      expect(await askAboutEntry(cls.id, jane.id, later)).toMatchObject({ state: 'no-payment', words: 'Square shows no payment for this charge.', choices: ['keep', 'off'] })
      texts.mockClear()
      mail.off.mockClear()
      const calls = h.square.chargeSavedCardCalls.length
      const r = await decide(item.id, choice, {}, by, later)
      const after = (await entries(cls))[0]
      expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.attempts[0].bookingId).every((l) => l.state === 'released')).toBe(true)
      expect(h.square.chargeSavedCardCalls).toHaveLength(calls)
      if (choice === 'keep') {
        expect(r.decided.what).toBe('Square showed no payment. They’re back on the waitlist, and that charge is never sent again')
        expect(after).toMatchObject({ state: 'waiting' })
        expect(after.attempts[0].outcome).toBe('no-payment')
        expect(h.square.disableCardCalls).not.toContain(jane.square.cardId)
      } else {
        expect(r.decided.what).toBe('Square showed no payment. They’re off the waitlist and their card is coming off')
        expect(after.state).toBe('removed')
        expect(h.square.disableCardCalls).toContain(jane.square.cardId)
        expect(mail.off).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', byStudio: true, cardOff: true }))
      }
      expect(texts).not.toHaveBeenCalled()
    }
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
    await join2({ classId: cls.id, attemptId: attempt(), request: { passId: 'all', tickets: { person: 1 } }, customer: person('Jane'), cardToken: 'cnon:ok', verificationToken: null, consent: true, consentShown: shown(cls), ip: '', origin: 'https://x' }, NOW)
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

// ── Waitlist fix round: the money rules (C1, I1, I3, I4, I6, M1, M5) ─────────
describe('money rules: never charge after close or leave, reuse keys until a final no', () => {
  const at = (min: number) => new Date(NOW.getTime() + min * 60_000)
  const janeCalls = (cardId: string) => h.square.chargeSavedCardCalls.filter((c: any) => c.cardId === cardId)
  /** The leave token from Jane's joined email. */
  const leaveTokenOf = (email: string) => {
    const call = mail.joined.mock.calls.find(([m]: any[]) => m.to === email)![0]
    return decodeURIComponent(call.leaveUrl.split('/classes/waitlist/')[1])
  }

  it('C1 repro: an unclear try is never resent after the cutoff, even when Square never got it; Square shows no payment → closed, card off, seat let go', async () => {
    // Class at 20:00Z, waitlist closes 18:00Z. The try at 17:00Z gets no answer and Square never got it.
    const cls = makeClass({ startIso: '2026-10-12T18:00:00.000Z' })
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    let jane = (await entries(cls))[0]
    expect(jane.state).toBe('charging')
    // The bank would answer now, so a resend WOULD make a first charge.
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    // The sweep at start − 1 h (past the close, 48 h before the class): read only.
    await sweepWaitlists(new Date('2026-10-10T19:00:00.000Z'), { ids: [cls.id] })
    jane = (await entries(cls))[0]
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect(jane).toMatchObject({ state: 'closed' })
    expect(jane.attempts[0].outcome).toBe('no-payment')
    expect(jane.cardOffAt).toBeTruthy()
    expect(h.square.disableCardCalls).toContain(jane.square.cardId)
    expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.attempts[0].bookingId).every((l) => l.state === 'released')).toBe(true)
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', why: 'closed', cardOff: true }))
    expect(owners.mock.calls.some(([t]) => /settled Jane Doe's unclear charge .* the waitlist closed\. Nothing more was sent/.test(t))).toBe(true)
  })

  it('C1: past the cutoff but the charge is fresh (under 30 minutes) → nothing sent, seat stays held, asked again later', async () => {
    const cls = makeClass({ startIso: '2026-10-12T17:10:00.000Z' }) // closes 48 h before (D7): 2026-10-10 17:10Z
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    await sweepWaitlists(at(15), { ids: [cls.id] })
    expect((await entries(cls))[0].state).toBe('charging')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect((await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)!.state).toBe('held')
  })

  it('C1: an unclear try that turns out paid after the cutoff still adds them (and tells them)', async () => {
    const cls = makeClass({ startIso: '2026-10-12T18:00:00.000Z' })
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.orderStates.delete(jane.attempts[0].orderId!)
    vi.spyOn(h.square, 'orderPaymentStatus').mockResolvedValue({ state: 'paid', payment: { id: 'PAY-LATE', orderId: jane.attempts[0].orderId!, amount: 2180, status: 'completed' } })
    texts.mockClear()
    await sweepWaitlists(new Date('2026-10-10T19:00:00.000Z'), { ids: [cls.id] })
    expect((await entries(cls))[0].state).toBe('added')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect(texts).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('you\'re in!') }))
  })

  it('C1: leaving while a charge is unclear is written down; the charge is never resent; Square shows no payment → off the list, card off, emailed', async () => {
    const { leaveWaitlist } = await import('@lib/classes/waitlist')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    let jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok' // a resend would charge now
    const r = await leaveWaitlist(leaveTokenOf('jane@example.com'), at(1))
    expect(r).toEqual({ result: 'checking', className: 'Potholder Looms' })
    jane = (await entries(cls))[0]
    expect(jane.leaveAskedAt).toBe(at(1).toISOString())
    expect(jane.history.at(-1)!.change).toMatch(/Asked to leave .* That charge is never sent again/)
    // The waitlist is still open, but they asked to leave: the 10-minute sweep only asks Square.
    await sweepWaitlists(at(11), { ids: [cls.id] })
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect((await entries(cls))[0].state).toBe('charging')
    // 30 minutes after the charge, still no payment: off the list, card off, the "off" email.
    await sweepWaitlists(at(31), { ids: [cls.id] })
    jane = (await entries(cls))[0]
    expect(jane.state).toBe('left')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect(h.square.disableCardCalls).toContain(jane.square.cardId)
    expect(mail.off).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com', byStudio: false, cardOff: true }))
    // Asking again is harmless.
    expect((await leaveWaitlist(leaveTokenOf('jane@example.com'), at(32))).result).toBe('already-off')
  })

  it('C1: leaving while unclear, then Square shows it paid → they are in (and told), never charged again', async () => {
    const { leaveWaitlist } = await import('@lib/classes/waitlist')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    await leaveWaitlist(leaveTokenOf('jane@example.com'), at(1))
    vi.spyOn(h.square, 'orderPaymentStatus').mockResolvedValue({ state: 'paid', payment: { id: 'PAY-LATE', orderId: jane.attempts[0].orderId!, amount: 2180, status: 'completed' } })
    await sweepWaitlists(at(11), { ids: [cls.id] })
    expect((await entries(cls))[0].state).toBe('added')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect(mail.confirm).toHaveBeenCalledWith(expect.objectContaining({ to: 'jane@example.com' }))
    expect(owners.mock.calls.some(([t]) => /They had asked to leave, but Square shows the charge went through/.test(t))).toBe(true)
  })

  it('C1: a leave asked just before a resend stops it (the write before the charge refuses)', async () => {
    const { leaveWaitlist } = await import('@lib/classes/waitlist')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    // Square is asked (no payment), then they leave before the resend is written.
    const real = h.square.orderPaymentStatus.bind(h.square)
    vi.spyOn(h.square, 'orderPaymentStatus').mockImplementationOnce(async (input: any) => {
      const answer = await real(input)
      await leaveWaitlist(leaveTokenOf('jane@example.com'), at(10))
      return answer
    })
    await runWaitlist(cls.id, { reason: 'sweep' }, at(11))
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect((await entries(cls))[0]).toMatchObject({ state: 'charging', leaveAskedAt: at(10).toISOString() })
  })

  it('C1: an unclear hold never runs past the class start', async () => {
    const cls = makeClass({ startIso: '2026-10-12T18:00:00.000Z' })
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    const held = (await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)!
    expect(Date.parse(held.holdExpiresAt!)).toBeLessThanOrEqual(Date.parse('2026-10-12T18:00:00.000Z'))
  })

  it('I1 repro: after a possibly-sent :1:pay, a lost seat keeps the SAME try; a later seat resends :1:pay, never :2:pay', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    let jane = (await entries(cls))[0]
    // The hold lapses and someone else takes the seat.
    await release(cls.id, jane.attempts[0].bookingId)
    const taken = await fill(cls)
    await sweepWaitlists(at(10), { ids: [cls.id] })
    jane = (await entries(cls))[0]
    expect(jane.state).toBe('charging') // not back to waiting with a fresh try
    expect(jane.attempts).toHaveLength(1)
    expect(jane.attempts[0].outcome).toBe('unknown')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    // A seat frees later and Square still shows nothing: the very same charge, same key, same order, same amount.
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    await release(cls.id, taken)
    await sweepWaitlists(at(20), { ids: [cls.id] })
    jane = (await entries(cls))[0]
    expect(jane.state).toBe('added')
    const calls = janeCalls(jane.square.cardId)
    expect(calls.map((c: any) => c.idempotencyKey)).toEqual([`wl:${jane.id}:1:pay`, `wl:${jane.id}:1:pay`])
    expect(calls[1]).toEqual(calls[0])
    expect(h.square.chargeSavedCardCalls.some((c: any) => c.idempotencyKey === `wl:${jane.id}:2:pay`)).toBe(false)
    expect(h.square.classOrderCalls.filter((c: any) => c.idempotencyKey.startsWith(`wl:${jane.id}:`))).toHaveLength(1)
  })

  it('I1: APPROVED/PENDING is "still going through": never resent, seat kept', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    h.square.orderStates.set(jane.attempts[0].orderId!, 'going-through')
    const r = await runWaitlist(cls.id, { reason: 'sweep' }, at(40))
    expect(r.stopped).toBe('unknown')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect((await entries(cls))[0].state).toBe('charging')
    expect(await askAboutEntry(cls.id, jane.id, at(40))).toMatchObject({ state: 'going-through', choices: [] })
  })

  it('I1: a FAILED payment is a final no: declined, never resent', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.orderStates.set(jane.attempts[0].orderId!, 'failed')
    await runWaitlist(cls.id, { reason: 'sweep' }, at(11))
    expect((await entries(cls))[0].state).toBe('declined')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
  })

  it('I1: the seat is held 30 minutes before the charge (longer than the 10-minute stale guard)', async () => {
    const { WAITLIST_HOLD_MINUTES, STALE_CHARGE_MS } = await import('@lib/classes/waitlist-runner')
    expect(WAITLIST_HOLD_MINUTES * 60_000).toBeGreaterThan(STALE_CHARGE_MS)
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    let during: string | null = null
    const real = h.square.chargeSavedCard.bind(h.square)
    vi.spyOn(h.square, 'chargeSavedCard').mockImplementation(async (input: any) => {
      during = (await getLedger(cls.id)).lines.find((l) => l.waitlistEntryId)?.holdExpiresAt ?? null
      return real(input)
    })
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(during).toBe(at(30).toISOString())
  })

  it('I3: after a setup stop the public may book the seat, and the class sheet says why it stopped with a button', async () => {
    vi.doMock('@lib/admin-auth', async (orig) => ({ ...(await orig<typeof import('@lib/admin-auth')>()), adminAuthorized: () => true }))
    vi.resetModules()
    const admin = await import('@pages/api/admin/classes/waitlist.json')
    const rules = await import('@lib/classes/waitlist-rules')
    const store = await import('@lib/classes/waitlist-store')
    const ledger = await import('@lib/classes/seat-ledger')
    const runner = await import('@lib/classes/waitlist-runner')
    const wl = await import('@lib/classes/waitlist')
    const cls = makeClass()
    const q = quote(cls, { passId: 'all', tickets: { person: 1 } }, NOW, 9)
    if (!q.ok) throw new Error()
    await ledger.hold(cls, q.value, { bookingId: 'bkg_i3fill', passId: 'all', source: 'online', customer: null, ttlMinutes: 600 }, NOW)
    await wl.joinWaitlist({ classId: cls.id, attemptId: attempt(), request: { passId: 'all', tickets: { person: 1 } }, customer: person('Jane'), cardToken: 'SETUP_LATER', verificationToken: null, consent: true, consentShown: shown(cls), ip: '', origin: 'https://x' }, NOW)
    await ledger.release(cls.id, 'bkg_i3fill')
    // Before the run: the waitlist goes first.
    expect(rules.waitlistGoesFirst(cls, await ledger.getLedger(cls.id), await store.getWaitlist(cls.id), ['ses_1'], 1, NOW)).toBe('ses_1')
    const r = await runner.runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.stopped).toBe('setup')
    // After the setup stop: the public can book it.
    expect(rules.waitlistGoesFirst(cls, await ledger.getLedger(cls.id), await store.getWaitlist(cls.id), ['ses_1'], 1, NOW)).toBeNull()
    const view = (await (await admin.GET({ request: new Request('https://x'), url: new URL(`https://x/?id=${cls.id}`) } as any)).json()).data
    expect(view.stopped).toEqual({
      why: 'setup', action: 'run', button: 'Try the waitlist again',
      words: 'The waitlist has stopped because Square refused our request (a setup problem on our side, not the customer’s card). Nobody was charged, and people can book the free seat normally until it runs again.',
    })
    expect(view.rows[0].stateWords).toBe('Waiting · Square refused the last try, nobody was charged')
    vi.doUnmock('@lib/admin-auth')
  })

  it('I3: a register price mismatch also lets the public in, and the button is Update the register', async () => {
    vi.doMock('@lib/admin-auth', async (orig) => ({ ...(await orig<typeof import('@lib/admin-auth')>()), adminAuthorized: () => true }))
    vi.resetModules()
    const admin = await import('@pages/api/admin/classes/waitlist.json')
    const rules = await import('@lib/classes/waitlist-rules')
    const store = await import('@lib/classes/waitlist-store')
    const ledger = await import('@lib/classes/seat-ledger')
    const runner = await import('@lib/classes/waitlist-runner')
    const wl = await import('@lib/classes/waitlist')
    const cls = makeClass()
    const q = quote(cls, { passId: 'all', tickets: { person: 1 } }, NOW, 9)
    if (!q.ok) throw new Error()
    await ledger.hold(cls, q.value, { bookingId: 'bkg_i3reg', passId: 'all', source: 'online', customer: null, ttlMinutes: 600 }, NOW)
    await wl.joinWaitlist({ classId: cls.id, attemptId: attempt(), request: { passId: 'all', tickets: { person: 1 } }, customer: person('Jane'), cardToken: 'cnon:ok', verificationToken: null, consent: true, consentShown: shown(cls), ip: '', origin: 'https://x' }, NOW)
    await ledger.release(cls.id, 'bkg_i3reg')
    h.square.prices = { VAR: 2600 } // the register rings more than they agreed to
    const r = await runner.runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.stopped).toBe('register')
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    expect(rules.waitlistGoesFirst(cls, await ledger.getLedger(cls.id), await store.getWaitlist(cls.id), ['ses_1'], 1, NOW)).toBeNull()
    const view = (await (await admin.GET({ request: new Request('https://x'), url: new URL(`https://x/?id=${cls.id}`) } as any)).json()).data
    expect(view.stopped).toMatchObject({ why: 'register', action: 'update-register', button: 'Update the register' })
    vi.doUnmock('@lib/admin-auth')
  })

  it('I4: a class cancelled with an unclear charge that Square shows paid → kept (refund list), owners told to refund, no "you\'re in"', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    cls.status = 'cancelled'
    await closeWaitlist(cls.id, at(1))
    vi.spyOn(h.square, 'orderPaymentStatus').mockResolvedValue({ state: 'paid', payment: { id: 'PAY-LATE', orderId: jane.attempts[0].orderId!, amount: 2180, status: 'completed' } })
    expect(await askAboutEntry(cls.id, jane.id, at(2))).toMatchObject({ state: 'paid', choices: ['add'] }) // "Check Square again" works on a cancelled class
    texts.mockClear()
    mail.confirm.mockClear()
    await runWaitlist(cls.id, { reason: 'cancel' }, at(2))
    expect((await entries(cls))[0].state).toBe('added')
    expect((await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)).toMatchObject({ state: 'confirmed', square: { paymentId: 'PAY-LATE' } })
    expect(texts).not.toHaveBeenCalled()
    expect(mail.confirm).not.toHaveBeenCalled()
    expect(owners).toHaveBeenCalledWith('Jane Doe was charged $21.80 by the waitlist just before Potholder Looms was cancelled. They weren\'t told they\'re in. Open /admin › To decide › Waitlist charge on a cancelled class to refund them.')
  })

  it('R4: the class is cancelled while the run builds the order → the class is read again before charging; nothing is charged', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    const realOrder = h.square.createClassOrder.bind(h.square)
    // Catherine cancels the class (the store's copy) just as the order is made.
    h.square.createClassOrder = vi.fn(async (input: any) => {
      h.classes.set(cls.id, { ...cls, status: 'cancelled' })
      return realOrder(input)
    })
    texts.mockClear(); mail.confirm.mockClear()
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(h.square.chargeSavedCardCalls).toHaveLength(0)
    const jane = (await entries(cls))[0]
    expect(jane.state).toBe('closed')
    expect((await getLedger(cls.id)).lines.filter((l) => l.bookingId === jane.attempts[0].bookingId && l.state === 'held')).toHaveLength(0)
    expect(texts).not.toHaveBeenCalled()
    expect(mail.confirm).not.toHaveBeenCalled()
  })

  it('R4: cancelled while Square takes the charge → nobody tells them they’re in; owners get the To decide refund item (with a button)', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    await release(cls.id, other)
    const realCharge = h.square.chargeSavedCard.bind(h.square)
    h.square.chargeSavedCard = vi.fn(async (input: any) => {
      const out = await realCharge(input)
      h.classes.set(cls.id, { ...cls, status: 'cancelled' })
      return out
    })
    texts.mockClear(); mail.confirm.mockClear(); owners.mockClear()
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    expect(jane.state).toBe('added')
    expect(jane.attempts[0]).toMatchObject({ outcome: 'paid', cancelledPaid: true })
    expect(texts).not.toHaveBeenCalled()
    expect(mail.confirm).not.toHaveBeenCalled()
    expect(owners).toHaveBeenCalledWith('Jane Doe was charged $21.80 by the waitlist just before Potholder Looms was cancelled. They weren\'t told they\'re in. Open /admin › To decide › Waitlist charge on a cancelled class to refund them.')
    const { waitlistItems } = await import('@lib/classes/waitlist-items')
    const items = await waitlistItems({ ...cls, status: 'cancelled' }, new Set(), at(1))
    expect(items).toEqual([expect.objectContaining({ kind: 'waitlist-refund', head: expect.stringMatching(/They weren’t told they’re in\. Nothing was refunded\./) })])
  })

  it('M-c: a resumed try with a nearly-run-out hold gets a full 30 minutes again before the resend', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    const later = new Date(NOW.getTime() + 25 * 60_000)
    await runWaitlist(cls.id, { reason: 'sweep' }, later)
    const line = (await getLedger(cls.id)).lines.find((l) => l.bookingId === jane.attempts[0].bookingId)!
    expect(line.state).toBe('confirmed')
    expect(line.overCapacity ?? false).toBe(false)
  })

  it('I4: a class cancelled with an unclear charge that Square shows unpaid → never resent, closed and card off once 30 minutes pass (never stuck)', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'TIMEOUT_LATER')
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const jane = (await entries(cls))[0]
    h.square.savedCards.get(jane.square.cardId).behaviour = 'ok'
    cls.status = 'cancelled'
    mail.missed.mockClear()
    await runWaitlist(cls.id, { reason: 'cancel' }, at(5))
    expect((await entries(cls))[0].state).toBe('charging')
    await sweepWaitlists(at(31), { ids: [cls.id] })
    const after = (await entries(cls))[0]
    expect(after.state).toBe('closed')
    expect(janeCalls(jane.square.cardId)).toHaveLength(1)
    expect(after.cardOffAt).toBeTruthy()
    expect(mail.missed).not.toHaveBeenCalled() // the owners contact everyone about a cancel
  })

  it('I6: a card that fails to come off is retried by the sweep; until then nobody is told it is off', async () => {
    const { leaveWaitlist } = await import('@lib/classes/waitlist')
    const cls = makeClass()
    await fill(cls)
    await join(cls, 'Jane')
    const jane = (await entries(cls))[0]
    const real = h.square.disableCard.bind(h.square)
    vi.spyOn(h.square, 'disableCard').mockRejectedValueOnce(new Error('network blip')).mockImplementation(real)
    const r = await leaveWaitlist(leaveTokenOf('jane@example.com'), NOW)
    expect(r).toMatchObject({ result: 'left', cardOff: false })
    expect(mail.off).toHaveBeenCalledWith(expect.objectContaining({ cardOff: false }))
    expect((await entries(cls))[0].cardOffAt).toBeUndefined()
    await sweepWaitlists(at(10), { ids: [cls.id] })
    expect((await entries(cls))[0].cardOffAt).toBeTruthy()
    expect(h.square.disableCard).toHaveBeenCalledTimes(2)
    expect(h.square.savedCards.get(jane.square.cardId).enabled).toBe(false)
  })

  it('M1: what they picked isn\'t sold any more → the "isn\'t offered any more" email, never the price one', async () => {
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane')
    cls.content.prices = { all: {} } as any
    await release(cls.id, other)
    const r = await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    expect(r.skipped).toBe(1)
    expect(mail.missed).toHaveBeenCalledWith(expect.objectContaining({ why: 'gone' }))
    expect((await entries(cls))[0].attempts[0]).toMatchObject({ outcome: 'price-rose', skipWhy: 'gone' })
  })

  it('M5: To decide only claims the messages that actually went out', async () => {
    const { waitlistItems } = await import('@lib/classes/waitlist-items')
    const cls = makeClass()
    const other = await fill(cls)
    await join(cls, 'Jane', 'DECLINE_LATER')
    texts.mockRejectedValueOnce(new Error('Quo down')) // the text doesn't go out
    await release(cls.id, other)
    await runWaitlist(cls.id, { reason: 'seat-freed' }, NOW)
    const [item] = await waitlistItems(cls, new Set(), NOW)
    expect(item.head).toContain('They got an email (no text went out).')
    expect(item.head).not.toContain('They got a text and an email')
    expect((await entries(cls))[0].attempts[0].told).toEqual({ text: false, email: true })
  })
})

describe('I-6: the sweep is fair and stops reading finished waitlists', () => {
  it('a waitlist whose class is over with no work left goes on the finished list and is never read again', async () => {
    const { mutateWaitlist, inactiveWaitlists } = await import('@lib/classes/waitlist-store')
    const old = makeClass({ startIso: '2026-10-01T15:00:00.000Z' })
    await mutateWaitlist(old.id, (cur) => ({ next: { ...cur, entries: [] }, result: null }))
    const live = makeClass()
    await mutateWaitlist(live.id, (cur) => ({ next: { ...cur, entries: [] }, result: null }))
    await sweepWaitlists(NOW)
    const done = await inactiveWaitlists()
    expect(done.has(old.id)).toBe(true)
    expect(done.has(live.id)).toBe(false) // its dates haven't passed: people may still join
  })

  it('starts at a different class each run, so a slow run never starves the same tail', async () => {
    const { sweepOrder } = await import('@lib/classes/waitlist-runner')
    const ids = ['a', 'b', 'c']
    const firsts = new Set([0, 1, 2].map((n) => sweepOrder(ids, new Date(NOW.getTime() + n * 600_000))[0]))
    expect(firsts).toEqual(new Set(ids)) // over three runs each class goes first once
    expect(sweepOrder(ids, NOW).sort()).toEqual(ids) // nobody dropped
    expect(sweepOrder([], NOW)).toEqual([])
  })
})
