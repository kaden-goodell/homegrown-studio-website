/**
 * Stage 4 sandbox end-to-end scenarios (49+): promo codes and the half-cent
 * proof, early-bird, free bookings, repeating dates, the waitlist with saved
 * sandbox cards, Square saved-card proofs, Register setup, the early-bird POS
 * price flip, "Charge on the reader" (simulated: the POS API has no sandbox)
 * and the customer's own cancel (D2). scripts/sandbox-e2e.ts runs them after
 * stage 1's (1–23; stages 2 and 3 own 24–48 on their own branches).
 *
 * The same rules as stage 1: preview only (the host guards in core.ts),
 * sandbox cards only, every class "E2E …" and link-only, cancelled at the
 * end. Each scenario also turns off the "E2E…" codes it made and takes its
 * waitlist entries off (their sandbox cards come off file). Texts and emails
 * go to Kaden only (ctx.person). The only refunds are of sandbox money on the
 * scenario's own bookings.
 */
import { randomUUID } from 'node:crypto'
import {
  addDays, check, checkEqual, checkStatus, chicagoDate, chicagoToUtcIso, sayReply, SkipScenario, SlotAllocator, SquareError,
  type Reply, type Scenario, type Scope,
} from './core'
import {
  blockedDay, bookingIdOf, bookingsOf, CARD_DECLINED, CARD_OK, checkNotCharged, checkRefundInSquare, cleanUpClass, makeClass, nameOf, noSquare,
  ordersFor, refund, siteLocation, sinceNow, testContent, toDecide, updateClass, type Ctx,
} from './scenarios'

/** Test bookings text the owners; this is Kaden's number (test texts only ever go to him). */
const KADEN_PHONE = '(402) 980-2907'

// ── Building blocks ────────────────────────────────────────────────────────

/**
 * Run 3: the waitlist charges and texts only 8 AM–8 PM Chicago (waitlist-quiet.ts, by design). A waitlist
 * scenario started outside that (or within 10 minutes of 8 PM, so it can't run past it) is SKIPPED with a
 * note, never failed. Returns the skip note, or null when it may run.
 */
export function waitlistHoursSkip(now: Date = new Date()): string | null {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  const mins = hour * 60 + minute
  if (mins >= 8 * 60 && mins < 20 * 60 - 10) return null
  return 'the waitlist only charges and texts between 8 AM and 8 PM Chicago: run between 8 AM and 8 PM Chicago (by 7:50 PM)'
}
function needWaitlistHours(): void {
  const skip = waitlistHoursSkip()
  if (skip) throw new SkipScenario(skip)
}

/** A promo code for this run: "E2E" + run digits + a letter (A–Z 0–9, 3–20 long). */
export function e2eCode(runTag: string, letter: string): string {
  return `E2E${runTag.replace(/\D/g, '').slice(-8)}${letter}`.toUpperCase()
}

const today = () => chicagoDate(Date.now())

/** Makes a code in /admin › Promotions; cleanup turns it off (codes are never deleted). */
async function makeCode(ctx: Ctx, scope: Scope, fields: Record<string, unknown>): Promise<any> {
  const r = await ctx.admin.post('/api/admin/promos.json', { action: 'save', expectedUpdatedAt: null, fields: { label: 'E2E sandbox test', ...fields } })
  checkStatus(r, 200, `Make code ${fields.code}`)
  const code = r.body.data.code
  scope.cleanup.add(`turn off code ${code.code}`, () => turnOffCode(ctx, code.code))
  return code
}

async function codeView(ctx: Pick<Ctx, 'admin'>, code: string): Promise<any> {
  const r = await ctx.admin.get(`/api/admin/promos.json?code=${encodeURIComponent(code)}`)
  checkStatus(r, 200, `Read code ${code}`)
  return r.body.data
}

async function turnOffCode(ctx: Pick<Ctx, 'admin'>, code: string): Promise<void> {
  const { code: cur } = await codeView(ctx, code)
  if (!cur.active) return
  checkStatus(await ctx.admin.post('/api/admin/promos.json', { action: 'active', code, active: false, expectedUpdatedAt: cur.updatedAt }), 200, `Turn off ${code}`)
}

/** The server's quote with a code (POST /api/classes/promo.json): nothing is held or charged. */
async function quoteWith(ctx: Ctx, classId: string, code: string, request: Record<string, unknown>): Promise<Reply> {
  return ctx.pub.post('/api/classes/promo.json', { classId, code, request })
}

interface Paid { reply: Reply; bookingId: string; attemptId: string }

/** Book as a customer with a code (and seats/add-ons), through the shared gate. `token: null` = no card (a free booking). */
async function bookWith(
  ctx: Ctx, classId: string,
  req: { passId?: string; tickets: Record<string, number>; seats?: unknown[]; sessionIds?: string[] },
  /** `confirmRepeat` (default on): the panel's "Book this one too", since the run books with one email again and again. */
  opts: { token?: string | null; code?: string; expected?: number; customer?: Record<string, string>; confirmRepeat?: boolean } = {},
): Promise<Paid> {
  const attemptId = randomUUID()
  const token = opts.token === undefined ? CARD_OK : opts.token
  const reply = await ctx.pub.post('/api/classes/book.json', {
    classId, passId: req.passId ?? 'single', tickets: req.tickets, ...(req.seats ? { seats: req.seats } : {}), ...(req.sessionIds ? { sessionIds: req.sessionIds } : {}),
    ...(token ? { paymentToken: token, sourceKind: 'card' } : {}),
    ...(opts.code ? { promoCode: opts.code } : {}),
    ...(typeof opts.expected === 'number' ? { expectedTotalCents: opts.expected } : {}),
    attemptId, customer: opts.customer ?? ctx.person, ...(opts.confirmRepeat === false ? {} : { confirmRepeat: true }),
  }, { gated: true })
  if (reply.status === 403) throw new Error(`Bookings are closed on the preview (${sayReply(reply)}). Set BOOKINGS_OPEN to include workshops for the branch.`)
  return { reply, bookingId: bookingIdOf(attemptId), attemptId }
}

/** The booking on the ledger (bookings.json). */
async function ledgerBooking(ctx: Ctx, classId: string, bookingId: string): Promise<any> {
  const { bookings } = await bookingsOf(ctx, classId)
  const mine = bookings.find((x: any) => x.bookingId === bookingId)
  check(mine, `Ledger has no booking ${bookingId}`)
  return mine
}

/**
 * Square's order lines against our quote: each single-quantity line's net
 * (total − tax) and tax must be one of the quote's lines, and the totals and
 * tax must add up. Discounts are LINE_ITEM only, never ORDER.
 */
async function checkOrderMatchesQuote(ctx: Ctx, orderId: string, quote: any): Promise<any> {
  const order = (await ctx.square!.get(`/orders/${encodeURIComponent(orderId)}`)).order
  checkEqual(Number(order.total_money?.amount), quote.totalCents, 'Square order total = our quote')
  checkEqual(Number(order.total_tax_money?.amount), quote.taxCents, 'Square order tax = our quote')
  for (const d of order.discounts ?? []) check(d.scope === 'LINE_ITEM', `Square order has a ${d.scope} discount "${d.name}" (only LINE_ITEM ones are allowed)`)
  const want = (quote.lines as any[]).map((l) => `${l.cents}/${l.taxCents}`)
  for (const li of order.line_items ?? []) {
    const qty = Number(li.quantity)
    const tax = Number(li.total_tax_money?.amount), net = Number(li.total_money?.amount) - tax
    if (qty !== 1) continue
    const i = want.indexOf(`${net}/${tax}`)
    check(i >= 0, `Square line "${li.name} ${li.variation_name ?? ''}" is ${net} + ${tax} tax; our quote has ${want.join(', ')}`)
    want.splice(i, 1)
  }
  return order
}

// ── Waitlist helpers ───────────────────────────────────────────────────────

/** A person for the n-th waitlist entry: Kaden's inbox (plus-address), Kaden's phone. */
function waiter(ctx: Ctx, n: number): Record<string, string> {
  const [user, domain] = ctx.person.email.split('@')
  return { givenName: 'E2E', familyName: `Waiting ${n}`, email: `${user}+wl${n}${ctx.runTag.replace(/\D/g, '').slice(-4)}@${domain}`, phone: KADEN_PHONE }
}

/**
 * Joins the waitlist with a sandbox card. The first call carries no consent
 * shown, so the site answers 409 consent_changed with the amount and close
 * time it would show; the second sends exactly those back (I2). Cleanup takes
 * the entry off (card off file) if it is still waiting, and checks the card.
 */
async function joinWaitlist(ctx: Ctx, scope: Scope, cls: any, person: Record<string, string>, seats = 1): Promise<{ entryId: string; position: number }> {
  const base = { action: 'join', classId: cls.id, passId: 'single', tickets: { person: seats }, customer: person, cardToken: CARD_OK, consent: true }
  await ctx.gate.take(1)
  const ask = await ctx.pub.post('/api/classes/waitlist.json', { ...base, attemptId: randomUUID() })
  checkStatus(ask, 409, 'Waitlist join without the consent shown')
  checkEqual(ask.body?.code, 'consent_changed', 'Waitlist answer code')
  check(Number.isInteger(ask.body?.maxCents) && typeof ask.body?.closesIso === 'string', `No amount or close time came back: ${ask.text.slice(0, 200)}`)
  await ctx.gate.take(1)
  const r = await ctx.pub.post('/api/classes/waitlist.json', { ...base, attemptId: randomUUID(), consentShown: { maxCents: ask.body.maxCents, closesIso: ask.body.closesIso } })
  checkStatus(r, 200, 'Join the waitlist')
  const entryId = r.body.data.entryId
  check(typeof entryId === 'string' && entryId.startsWith('wle_'), `Join gave no entry id: ${r.text.slice(0, 200)}`)
  scope.cleanup.add(`take ${entryId} off the waitlist`, async () => {
    const row = (await waitlistRows(ctx, cls.id)).find((x) => x.id === entryId)
    if (row && (row.state === 'waiting')) checkStatus(await ctx.admin.post('/api/admin/classes/waitlist.json', { action: 'remove', classId: cls.id, entryId }), 200, 'Remove from the waitlist')
    if (ctx.square) {
      const card = await sandboxCardOf(ctx, entryId)
      if (card?.enabled) {
        await ctx.square.post(`/cards/${encodeURIComponent(card.id)}/disable`, {})
        throw new Error(`card for ${entryId} was still on file; disabled it in the sandbox`)
      }
    }
  })
  return { entryId, position: r.body.data.position }
}

async function waitlistView(ctx: Ctx, classId: string): Promise<any> {
  const r = await ctx.admin.get(`/api/admin/classes/waitlist.json?id=${encodeURIComponent(classId)}`)
  checkStatus(r, 200, 'Read the waitlist')
  return r.body.data
}
async function waitlistRows(ctx: Ctx, classId: string): Promise<any[]> {
  return (await waitlistView(ctx, classId)).rows ?? []
}

/** The sandbox card saved for an entry (reference_id = entry id), disabled ones too. */
async function sandboxCardOf(ctx: Ctx, entryId: string): Promise<any | null> {
  if (!ctx.square) return null
  const r = await ctx.square.get(`/cards?reference_id=${encodeURIComponent(entryId)}&include_disabled=true`)
  return (r.cards ?? [])[0] ?? null
}

/** Waits (up to ~30 s) for the inline run started by a freed seat; then runs it from /admin if nothing settled. */
async function settleWaitlist(ctx: Ctx, classId: string, done: (rows: any[]) => boolean): Promise<any[]> {
  for (let i = 0; i < 6; i++) {
    const rows = await waitlistRows(ctx, classId)
    if (done(rows)) return rows
    await ctx.sleep(5_000)
  }
  const run = await ctx.admin.post('/api/admin/classes/waitlist.json', { action: 'run', classId })
  checkStatus(run, 200, 'Run the waitlist now')
  return run.body.data.rows ?? []
}

/** A capacity-1 class with its one seat sold online. */
async function fullClass(ctx: Ctx, scope: Scope, what: string, capacity = 1, sessions = ctx.slots.sessions(1, { capacity })): Promise<{ cls: any; seat: Paid }> {
  const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, what) }), sessions })
  const seat = await bookWith(ctx, cls.id, { tickets: { person: capacity } })
  checkStatus(seat.reply, 200, 'Book the class full')
  return { cls, seat }
}

/**
 * Days for a class whose waitlist cutoff a scenario moves past: 5 to ~25 days
 * out, 6 AM (the staffing scenarios' soon classes are at 5 AM from day 2).
 * Far enough that the default cutoff (48 hours, D7) hasn't passed, so the
 * waitlist can still be joined; near enough that "start + a day" stays inside
 * the 0–720 hour cutoff the class form allows.
 */
let cutoffSlots: SlotAllocator | null = null
const cutoffSession = (ctx: Ctx, capacity: number) =>
  (cutoffSlots ??= new SlotAllocator(addDays(today(), 5), blockedDay(ctx.settings))).sessions(1, { capacity, time: '06:00' })

const freeTheSeat = (ctx: Ctx, classId: string, bookingId: string) => refund(ctx, { classId, bookingId, kind: 'booking', attempt: `e2e-${randomUUID()}` })

const errorOf = async (fn: () => Promise<unknown>): Promise<SquareError | null> => {
  try { await fn(); return null } catch (e) { if (e instanceof SquareError) return e; throw e }
}

// ── D2 helpers ─────────────────────────────────────────────────────────────

async function cancelToken(ctx: Ctx, classId: string, bookingId: string): Promise<string> {
  const mine = await ledgerBooking(ctx, classId, bookingId)
  check(typeof mine.cancelPath === 'string' && mine.cancelPath.startsWith('/classes/cancel/'), `Booking ${bookingId} has no cancelPath (got ${JSON.stringify(mine.cancelPath)})`)
  return decodeURIComponent(mine.cancelPath.split('/').pop())
}
async function cancelView(ctx: Ctx, t: string): Promise<any> {
  const r = await ctx.pub.get(`/api/classes/cancel.json?t=${encodeURIComponent(t)}`)
  checkStatus(r, 200, 'Open the "Can’t make it?" page')
  return r.body.data
}
const cancelPost = (ctx: Ctx, body: Record<string, unknown>) => ctx.pub.post('/api/classes/cancel.json', body)

/**
 * Refunds on a sandbox payment, read from the payment's own refund_ids and
 * each refund by id. Not ListPaymentRefunds: that list is eventually
 * consistent, so a refund made a second or two earlier can be missing from it
 * (run 2, scenario 65: Square had both refunds, the list showed one).
 */
async function refundsOn(ctx: Ctx, paymentId: string): Promise<any[]> {
  const payment = (await ctx.square!.get(`/payments/${encodeURIComponent(paymentId)}`)).payment
  const ids: string[] = payment?.refund_ids ?? []
  return Promise.all(ids.map(async (id) => (await ctx.square!.get(`/refunds/${encodeURIComponent(id)}`)).refund))
}

// ── The scenarios ──────────────────────────────────────────────────────────

const PRICE15 = { single: { person: 1500 } }

export const extrasScenarios: Scenario<Ctx>[] = [
  {
    id: 49,
    title: 'HARD GATE · S4-1 Half cent: 30% off $15, Square rounds like us',
    plan: [
      'code E2E…A, 30% off, this class only; quote: line net $10.50, tax 94 cents (94.5 rounded half to even, once on the order, like Square\'s CalculateOrder: DV20), total $11.44',
      'book 1 seat with it; our quote total = Square\'s order total = what was charged, and every Square line equals the quote',
      'if any of the three differ: FAIL (percent codes must not ship)',
      'HARD GATE: needs SQUARE_SANDBOX_ACCESS_TOKEN; without it the whole scenario is SKIPPED (never counted as a pass)',
    ],
    async run(ctx, scope) {
      // T2: a gate proven by half its checks isn't proven: SKIP before anything is booked.
      if (!ctx.square) throw new SkipScenario('HARD GATE needs SQUARE_SANDBOX_ACCESS_TOKEN')
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Half cent'), prices: PRICE15 }), sessions: ctx.slots.sessions(1) })
      const code = e2eCode(ctx.runTag, 'A')
      await makeCode(ctx, scope, { code, off: { kind: 'percent', percent: 30 }, appliesTo: { kind: 'classes', libraryIds: [], classIds: [cls.id] } })
      const q = await quoteWith(ctx, cls.id, code, { passId: 'single', tickets: { person: 1 } })
      checkStatus(q, 200, 'Check the code')
      const line = q.body.data.quote.lines[0]
      // DV20: Square rounds tax half to even, once per order on the line sum (CalculateOrder probe): 94.5 → 94.
      checkEqual([line.listCents, line.cents, line.taxCents], [1500, 1050, 94], 'Our quote (list, net, tax)')
      const quoted = q.body.data.quote.totalCents
      checkEqual(quoted, 1144, 'Our quote total')
      const b = await bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code, expected: quoted })
      checkStatus(b.reply, 200, 'Book with the code')
      const charged = b.reply.body.data.totalChargedCents
      const mine = await ledgerBooking(ctx, cls.id, b.bookingId)
      checkEqual(mine.paidCents, charged, 'Ledger paid')
      const order = (await ctx.square.get(`/orders/${encodeURIComponent(b.reply.body.data.orderId)}`)).order
      const squareTotal = Number(order.total_money?.amount)
      check(quoted === squareTotal && squareTotal === charged,
        `HARD GATE: our quote ${quoted}, Square's order total ${squareTotal}, charged ${charged} must all be equal. Percent codes and percent early-birds must NOT ship until they are.`)
      await checkOrderMatchesQuote(ctx, order.id, q.body.data.quote)
    },
  },
  {
    id: 50,
    title: 'S4-2 $5 per booking over 3 seats + an extra; refund seat 2',
    plan: [
      '$15 seats, $4 extra on seat 1; code E2E…B $5 off the whole booking (extras not included)',
      'quote: discounts 167/167/166 on the seats, extra untouched; Square has LINE_ITEM discounts only and the same lines and total',
      'refund seat 2 (person) → the refund is that seat\'s recorded Square net + tax ($13.33 + $1.20 = $14.53), checked in Square',
    ],
    async run(ctx, scope) {
      const content = { ...testContent({ name: nameOf(ctx, 'Split pennies'), prices: PRICE15 }), addOns: [{ id: 'extra', label: 'Extra', priceCents: 400, maxPerSeat: 1 }] }
      const cls = await makeClass(ctx, scope, { content, sessions: ctx.slots.sessions(1) })
      const code = e2eCode(ctx.runTag, 'B')
      await makeCode(ctx, scope, { code, off: { kind: 'amount', cents: 500 }, per: 'booking', appliesTo: { kind: 'classes', libraryIds: [], classIds: [cls.id] } })
      const req = { passId: 'single', tickets: { person: 3 }, seats: [{ addOns: { extra: 1 } }, {}, {}] }
      const q = await quoteWith(ctx, cls.id, code, req)
      checkStatus(q, 200, 'Check the code')
      const quote = q.body.data.quote
      const seatLines = (quote.lines as any[]).filter((l) => l.kind === 'seat')
      checkEqual(seatLines.map((l) => l.discounts.reduce((s: number, d: any) => s + d.cents, 0)), [167, 167, 166], 'Seat discounts')
      const extra = (quote.lines as any[]).find((l) => l.kind === 'addon')
      checkEqual([extra?.cents, extra?.discounts?.length ?? 0], [400, 0], 'Extra untouched')
      const b = await bookWith(ctx, cls.id, req, { code, expected: quote.totalCents })
      checkStatus(b.reply, 200, 'Book 3 with the code')
      checkEqual(b.reply.body.data.totalChargedCents, quote.totalCents, 'Charged = quote')
      if (ctx.square) await checkOrderMatchesQuote(ctx, b.reply.body.data.orderId, quote)
      else noSquare(scope)
      const mine = await ledgerBooking(ctx, cls.id, b.bookingId)
      const seat2 = (mine.refundable as any[]).find((s) => s.seat === 2)
      check(seat2, 'No seat 2 on the booking')
      const r = await refund(ctx, { classId: cls.id, bookingId: b.bookingId, kind: 'person', lineIds: [seat2.id], attempt: `e2e-${randomUUID()}` })
      checkStatus(r, 200, 'Refund seat 2')
      checkEqual(r.body.data.cents, seat2.remainingCents, 'Refund = seat 2\'s recorded net + tax')
      checkEqual(seat2.remainingCents, seatLines[1].cents + seatLines[1].taxCents, 'Seat 2 recorded = its quote line')
      await checkRefundInSquare(ctx, scope, r.body.data.refundId, seat2.remainingCents)
    },
  },
  {
    id: 51,
    title: 'S4-3 Early-bird $12 + 10% code; the code\'s use is counted',
    plan: [
      'class $15 with an early-bird $12 running; code E2E…C 10% off',
      'quote $12 − $1.20 = $10.80 + 97 tax; booked and charged that; the Square line is the "(early-bird)" variation and the code is a LINE_ITEM discount named after the code',
      'Promotions shows the code used once',
    ],
    async run(ctx, scope) {
      const content = { ...testContent({ name: nameOf(ctx, 'Early bird'), prices: PRICE15 }), earlyBird: { untilYmd: addDays(today(), 30), prices: { single: { person: 1200 } } } }
      const cls = await makeClass(ctx, scope, { content, sessions: ctx.slots.sessions(1) })
      const code = e2eCode(ctx.runTag, 'C')
      await makeCode(ctx, scope, { code, off: { kind: 'percent', percent: 10 }, appliesTo: { kind: 'classes', libraryIds: [], classIds: [cls.id] } })
      const q = await quoteWith(ctx, cls.id, code, { passId: 'single', tickets: { person: 1 } })
      checkStatus(q, 200, 'Check the code')
      const line = q.body.data.quote.lines[0]
      checkEqual([line.cents, line.taxCents], [1080, 97], 'Early-bird + 10% (net, tax)')
      const b = await bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code, expected: q.body.data.quote.totalCents })
      checkStatus(b.reply, 200, 'Book with the code')
      checkEqual(b.reply.body.data.totalChargedCents, 1177, 'Charged')
      const mine = await ledgerBooking(ctx, cls.id, b.bookingId)
      check((mine.discounts as string[]).some((d) => d.includes(code)), `Booking tags: ${JSON.stringify(mine.discounts)}`)
      if (ctx.square) {
        const order = await checkOrderMatchesQuote(ctx, b.reply.body.data.orderId, q.body.data.quote)
        const li = order.line_items[0]
        check(/early-bird/i.test(`${li.variation_name ?? ''} ${li.name ?? ''}`), `Square line is "${li.name} / ${li.variation_name}", not the early-bird variation`)
        check((order.discounts ?? []).some((d: any) => String(d.name).includes(code)), `No discount named after ${code}: ${JSON.stringify((order.discounts ?? []).map((d: any) => d.name))}`)
      } else noSquare(scope)
      let used = 0
      for (let i = 0; i < 4 && used < 1; i++) {
        used = (await codeView(ctx, code)).code.usedCount
        if (used < 1) await ctx.sleep(3_000)
      }
      checkEqual(used, 1, 'Code uses counted')
    },
  },
  {
    id: 52,
    title: 'S4-4 One-use code: two at once, one wins; a decline gives it back',
    plan: [
      'code E2E…D, 1 use: two bookings at the same moment → one 200 discounted, one 409 "used up", nothing charged for it',
      'code E2E…E, 1 use: a declined card → the use comes back (0 used, 0 paying); then it books',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Last use'), prices: PRICE15 }), sessions: ctx.slots.sessions(1) })
      const one = e2eCode(ctx.runTag, 'D')
      await makeCode(ctx, scope, { code: one, off: { kind: 'amount', cents: 500 }, maxUses: 1 })
      const both = await Promise.all([0, 1].map(() => bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code: one })))
      const won = both.filter((b) => b.reply.status === 200)
      const lost = both.filter((b) => b.reply.status !== 200)
      checkEqual([won.length, lost.length], [1, 1], 'One booked, one refused')
      checkEqual(lost[0].reply.status, 409, `The loser's answer (${sayReply(lost[0].reply)})`)
      checkEqual(lost[0].reply.body?.code, 'promo', 'The loser was refused for the code')
      checkEqual(won[0].reply.body.data.totalChargedCents, 1000 + 90, 'Winner charged $10 + tax')
      await checkNotCharged(ctx, scope, [lost[0].bookingId], sinceNow())

      const two = e2eCode(ctx.runTag, 'E')
      await makeCode(ctx, scope, { code: two, off: { kind: 'amount', cents: 500 }, maxUses: 1 })
      const declined = await bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code: two, token: CARD_DECLINED })
      check(declined.reply.status >= 400, `A declined card booked (${sayReply(declined.reply)})`)
      const v = (await codeView(ctx, two)).code
      checkEqual([v.usedCount, v.payingNow], [0, 0], 'Code after a decline (used, paying now)')
      const ok = await bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code: two })
      checkStatus(ok.reply, 200, 'The code still works after the decline')
    },
  },
  {
    id: 53,
    title: 'S4-5 Code for another class, turned off, or ended: refused',
    plan: [
      'code E2E…F for class A only: refused on class B ("isn\'t for this class"), fine on A',
      'code E2E…G made turned off: refused as not valid',
      'a code with a last day in the past can\'t be made (400 on the last day)',
      'nothing is booked or charged',
    ],
    async run(ctx, scope) {
      const a = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Code A') }), sessions: ctx.slots.sessions(1) })
      const b = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Code B') }), sessions: ctx.slots.sessions(1) })
      const forA = e2eCode(ctx.runTag, 'F')
      await makeCode(ctx, scope, { code: forA, off: { kind: 'percent', percent: 10 }, appliesTo: { kind: 'classes', libraryIds: [], classIds: [a.id] } })
      const req = { passId: 'single', tickets: { person: 1 } }
      const onB = await quoteWith(ctx, b.id, forA, req)
      checkStatus(onB, 409, 'Code A on class B')
      check(/isn.t for this class/.test(onB.text), `Refusal: ${onB.text.slice(0, 160)}`)
      checkStatus(await quoteWith(ctx, a.id, forA, req), 200, 'Code A on class A')
      const off = e2eCode(ctx.runTag, 'G')
      await makeCode(ctx, scope, { code: off, off: { kind: 'percent', percent: 10 }, active: false })
      const offQ = await quoteWith(ctx, a.id, off, req)
      checkStatus(offQ, 409, 'A turned-off code')
      check(/isn.t valid/.test(offQ.text), `Refusal: ${offQ.text.slice(0, 160)}`)
      const ended = await ctx.admin.post('/api/admin/promos.json', {
        action: 'save', expectedUpdatedAt: null,
        fields: { code: e2eCode(ctx.runTag, 'H'), label: 'E2E ended', off: { kind: 'percent', percent: 10 }, endsYmd: addDays(today(), -1) },
      })
      checkStatus(ended, 400, 'A code that already ended')
      checkEqual(ended.body?.field, 'endsYmd', 'Refused on the last day')
      scope.note('an ended code is refused at checkout by the unit tests ("ends at Chicago midnight"); the preview can\'t make one that has ended')
    },
  },
  {
    id: 54,
    title: 'D3 Free booking: a 100% code books with no Square order',
    plan: [
      'code E2E…I 100% off, 1 use; book with no card → 200, $0, the booking on the ledger as free',
      'no Square order or payment; /admin refund refused ("free"); Free the seat works',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Free') }), sessions: ctx.slots.sessions(1) })
      const code = e2eCode(ctx.runTag, 'I')
      await makeCode(ctx, scope, { code, off: { kind: 'percent', percent: 100 }, maxUses: 1 })
      const b = await bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code, token: null, expected: 0 })
      checkStatus(b.reply, 200, 'Free booking')
      checkEqual(b.reply.body.data.totalChargedCents, 0, 'Charged')
      const mine = await ledgerBooking(ctx, cls.id, b.bookingId)
      checkEqual([mine.free, mine.paidCents, mine.paidHere], [true, 0, false], 'Ledger (free, paid, paid here)')
      await checkNotCharged(ctx, scope, [b.bookingId], sinceNow())
      if (ctx.square) checkEqual((await ordersFor(ctx.square, [b.bookingId], sinceNow())).length, 0, 'Square orders for the free booking')
      const r = await refund(ctx, { classId: cls.id, bookingId: b.bookingId, kind: 'booking', attempt: `e2e-${randomUUID()}` })
      checkStatus(r, 409, 'Refund a free booking')
      check(/free/i.test(r.body?.error ?? ''), `Refusal: ${r.body?.error}`)
      checkStatus(await refund(ctx, { action: 'free-seat', classId: cls.id, bookingId: b.bookingId }), 200, 'Free the seat')
      checkEqual((await ledgerBooking(ctx, cls.id, b.bookingId)).seatsComing, 0, 'Seats after freeing')
    },
  },
  {
    id: 55,
    title: 'S4-6 Repeat every week ×4, one date clashes; a replay makes nothing new',
    plan: [
      'block 6:30–8 AM on the third week; repeat a 6:45 AM class every week for 4 weeks',
      'preview lists the third date skipped with the clash sentence; repeat → 3 classes, 1 skipped "Clashes with … E2E block"',
      'the same repeat again (same create key) → the same 3 class ids; each its own POS item (3, not 6)',
    ],
    async run(ctx, scope) {
      const [d0] = ctx.slots.days(1)
      const dates = [0, 7, 14, 21].map((n) => addDays(d0, n))
      const reason = `E2E block ${ctx.runTag} repeat`
      const blk = await ctx.admin.post('/api/admin/classes/blocked.json', { action: 'add', startIso: chicagoToUtcIso(dates[2], '06:30'), endIso: chicagoToUtcIso(dates[2], '08:00'), reason })
      checkStatus(blk, 200, 'Block time')
      const blockId = blk.body.data.blocked.id
      scope.cleanup.add(`unblock ${blockId}`, async () => checkStatus(await ctx.admin.post('/api/admin/classes/blocked.json', { action: 'remove', id: blockId }), 200, 'Unblock'))
      const startIso = chicagoToUtcIso(d0, '06:45')
      const body = {
        content: testContent({ name: nameOf(ctx, 'Repeat') }), status: 'open',
        sessions: [{ startIso, endIso: new Date(Date.parse(startIso) + 30 * 60_000).toISOString(), capacity: 6 }],
        pattern: { every: 1, untilYmd: dates[3] },
      }
      const prev = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'repeat-preview', ...body })
      checkStatus(prev, 200, 'Repeat preview')
      const pdates: any[] = prev.body.data.dates
      checkEqual(pdates.map((d) => d.ymd), dates, 'Preview dates')
      const bad = pdates.filter((d) => !d.ok)
      check(bad.some((d) => d.ymd === dates[2] && /Clashes with/.test(d.reason ?? '')), `Preview didn't skip the blocked date: ${JSON.stringify(bad)}`)
      if (bad.length > 1) scope.note(`the preview also skipped ${bad.filter((d) => d.ymd !== dates[2]).map((d) => `${d.ymd} (${d.reason})`).join(', ')}`)
      const createKey = randomUUID()
      const repeat = async () => {
        const created: any[] = [], skipped: any[] = []
        for (let i = 0; i < 6; i++) {
          const r = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'repeat', ...body, skip: [], createKey })
          checkStatus(r, 200, 'Repeat')
          const d = r.body.data
          for (const c of d.created ?? []) if (!created.some((x) => x.ymd === c.ymd)) created.push(c)
          for (const s of d.skipped ?? []) if (!skipped.some((x) => x.ymd === s.ymd)) skipped.push(s)
          for (const c of d.created ?? []) cleanUpClass(ctx, scope, { ...c.class, libraryId: d.libraryId ?? c.class.libraryId })
          if (!(d.left ?? []).length) break
        }
        return { created, skipped }
      }
      const first = await repeat()
      const wantMade = 4 - bad.length
      checkEqual(first.created.length, wantMade, 'Classes made')
      check(first.skipped.some((s) => s.ymd === dates[2] && /Clashes with/.test(s.reason) && s.reason.includes('E2E block')), `Skipped: ${JSON.stringify(first.skipped)}`)
      const again = await repeat()
      checkEqual(again.created.map((c) => c.class.id).sort(), first.created.map((c) => c.class.id).sort(), 'Replay: the same classes')
      const items = first.created.map((c) => c.class.square?.itemId)
      check(items.every(Boolean), `A repeated class isn't on the POS: ${JSON.stringify(items)}`)
      checkEqual(new Set(items).size, wantMade, 'POS items (one per class)')
      if (ctx.square) {
        for (const id of items) check((await ctx.square.get(`/catalog/object/${encodeURIComponent(id)}`)).object?.id === id, `POS item ${id} not in the sandbox`)
      } else noSquare(scope)
    },
  },
  {
    id: 56,
    title: 'S4-7 Waitlist adds and charges the saved card when a seat frees',
    plan: [
      'SKIPPED outside 8 AM–7:50 PM Chicago (the waitlist only charges and texts 8 AM–8 PM, by design)',
      'capacity 1, booked; join the waitlist with the sandbox card (Cards API: enabled, reference_id = the entry)',
      'refund the booking and free the seat → the run (inline, or Run the waitlist now) adds them',
      'entry added with a booking; that booking is on the ledger; Square order COMPLETED and paid in full; the card is off file',
      'the same-key payment replay proof is in scenario 61',
    ],
    async run(ctx, scope) {
      needWaitlistHours()
      const { cls, seat } = await fullClass(ctx, scope, 'Waitlist add')
      const { entryId } = await joinWaitlist(ctx, scope, cls, waiter(ctx, 1))
      if (ctx.square) {
        const card = await sandboxCardOf(ctx, entryId)
        check(card?.enabled === true, `Sandbox card for ${entryId}: ${JSON.stringify(card && { enabled: card.enabled, reference_id: card.reference_id })}`)
        checkEqual(card.reference_id, entryId, 'Card reference id')
      } else noSquare(scope)
      checkStatus(await freeTheSeat(ctx, cls.id, seat.bookingId), 200, 'Refund and free the seat')
      const rows = await settleWaitlist(ctx, cls.id, (r) => r.some((x) => x.id === entryId && x.state !== 'waiting' && x.state !== 'charging'))
      const row = rows.find((x) => x.id === entryId)
      checkEqual(row?.state, 'added', `Entry state (${row?.stateWords})`)
      check(row.bookingId, 'The added entry has no booking')
      const mine = await ledgerBooking(ctx, cls.id, row.bookingId)
      checkEqual([mine.state, mine.seatsComing], ['confirmed', 1], 'The waitlist booking on the ledger')
      if (!ctx.square) return noSquare(scope)
      const [order] = await ordersFor(ctx.square, [row.bookingId], sinceNow())
      check(order, `No Square order for ${row.bookingId}`)
      checkEqual(order.state, 'COMPLETED', 'Square order state')
      const paymentId = order.tenders?.[0]?.payment_id ?? order.tenders?.[0]?.id
      const payment = (await ctx.square.get(`/payments/${encodeURIComponent(paymentId)}`)).payment
      checkEqual([payment.status, Number(payment.total_money.amount)], ['COMPLETED', Number(order.total_money.amount)], 'Square payment (status, amount = order total)')
      scope.note(`order tenders carry ${order.tenders?.[0]?.payment_id ? 'payment_id' : 'id only'} (orderPaymentStatus reads that)`)
      const card = await sandboxCardOf(ctx, entryId)
      checkEqual(card?.enabled, false, 'Card off file after being added')
    },
  },
  {
    id: 57,
    title: 'S4-8 Waitlist decline: a disabled card moves on to the next person',
    plan: [
      'SKIPPED outside 8 AM–7:50 PM Chicago (the waitlist only charges and texts 8 AM–8 PM, by design)',
      'capacity 1, booked; two people join; the first one\'s card is disabled in the sandbox',
      'free the seat → the first is declined (card-gone or declined, never a setup stop), the second added',
      'owners are texted (the preview reroutes to Kaden); Square\'s error code for the charge is noted',
      'needs SQUARE_SANDBOX_ACCESS_TOKEN (skipped without it)',
    ],
    async run(ctx, scope) {
      needWaitlistHours()
      if (!ctx.square) throw new SkipScenario('needs SQUARE_SANDBOX_ACCESS_TOKEN to disable a sandbox card')
      const { cls, seat } = await fullClass(ctx, scope, 'Waitlist decline')
      const one = await joinWaitlist(ctx, scope, cls, waiter(ctx, 1))
      const two = await joinWaitlist(ctx, scope, cls, waiter(ctx, 2))
      const card = await sandboxCardOf(ctx, one.entryId)
      check(card, `No sandbox card for ${one.entryId}`)
      await ctx.square.post(`/cards/${encodeURIComponent(card.id)}/disable`, {})
      checkStatus(await freeTheSeat(ctx, cls.id, seat.bookingId), 200, 'Refund and free the seat')
      const rows = await settleWaitlist(ctx, cls.id, (r) => r.some((x) => x.id === two.entryId && x.state === 'added'))
      const first = rows.find((x) => x.id === one.entryId), second = rows.find((x) => x.id === two.entryId)
      scope.note(`first entry after the charge on a disabled card: ${first?.state} (${first?.stateWords})`)
      const view = await waitlistView(ctx, cls.id)
      check(!(view.stopped?.why === 'setup'), `The run stopped as a setup problem: a charge on a disabled card was misread (${view.stopped?.words}). Widen refersToCard.`)
      checkEqual(first?.state, 'declined', 'First entry')
      checkEqual(second?.state, 'added', 'Second entry')
      const hist = (first?.history ?? []).map((h: any) => h.change).join(' | ')
      scope.note(`first entry history: ${hist.slice(0, 300)}`)
      scope.note('owners were texted about the decline; on the preview that text goes to Kaden')
    },
  },
  {
    id: 58,
    title: 'S4-9 Goodwill refund (seat kept) with someone waiting: nobody charged',
    plan: ['capacity 1, booked; one person waiting', '$3 refund that keeps the seat → the waitlist doesn\'t run: still waiting, nothing charged'],
    async run(ctx, scope) {
      const { cls, seat } = await fullClass(ctx, scope, 'Waitlist goodwill')
      const { entryId } = await joinWaitlist(ctx, scope, cls, waiter(ctx, 1))
      const r = await refund(ctx, { classId: cls.id, bookingId: seat.bookingId, kind: 'custom', cents: 300, freeSeat: false, attempt: `e2e-${randomUUID()}` })
      checkStatus(r, 200, 'Goodwill refund')
      await ctx.sleep(8_000)
      const row = (await waitlistRows(ctx, cls.id)).find((x) => x.id === entryId)
      checkEqual(row?.state, 'waiting', 'Entry after a kept-seat refund')
      checkEqual(row?.bookingId ?? null, null, 'No booking made for them')
    },
  },
  {
    id: 59,
    title: 'S4-10 Waitlist cutoff passed: nobody charged, the seat is the public\'s',
    plan: [
      'a class 5+ days out (6 AM), capacity 1, booked; one person waiting; the class\'s waitlist cutoff moved past now (start + a day, inside 0–720 hours)',
      'free the seat → nobody charged; Run the waitlist now closes the entry and takes the card off',
      'a public booking takes the seat',
    ],
    async run(ctx, scope) {
      // A class a few days out: the cutoff can be moved past its start within the 0–720 hours allowed (run 2: 6585 hours was refused).
      const { cls, seat } = await fullClass(ctx, scope, 'Waitlist cutoff', 1, cutoffSession(ctx, 1))
      const { entryId } = await joinWaitlist(ctx, scope, cls, waiter(ctx, 1))
      const hours = Math.ceil((Date.parse(cls.sessions[0].startIso) - Date.now()) / 3_600_000) + 24
      check(hours <= 720, `The class is too far out to move its waitlist cutoff past now (${hours} hours)`)
      const { class: cur } = await bookingsOf(ctx, cls.id)
      const up = await updateClass(ctx, cls.id, { content: { ...cur.content, rules: { ...cur.content.rules, waitlistCutoffHours: hours } } })
      checkStatus(up, 200, `Move the waitlist cutoff ${hours} hours before`)
      checkStatus(await freeTheSeat(ctx, cls.id, seat.bookingId), 200, 'Refund and free the seat')
      const run = await ctx.admin.post('/api/admin/classes/waitlist.json', { action: 'run', classId: cls.id })
      checkStatus(run, 200, 'Run the waitlist now')
      const row = (run.body.data.rows as any[]).find((x) => x.id === entryId)
      checkEqual(row?.state, 'closed', `Entry after the cutoff (${row?.stateWords})`)
      checkEqual(row?.bookingId ?? null, null, 'Nobody added')
      if (ctx.square) {
        await ctx.sleep(2_000)
        checkEqual((await sandboxCardOf(ctx, entryId))?.enabled, false, 'Card off file')
      } else noSquare(scope)
      const b = await bookWith(ctx, cls.id, { tickets: { person: 1 } })
      checkStatus(b.reply, 200, 'A public booking takes the freed seat')
    },
  },
  {
    id: 60,
    title: 'S4-11 Waitlist first: a freed seat goes to the person waiting',
    plan: [
      'SKIPPED outside 8 AM–7:50 PM Chicago (the waitlist only charges and texts 8 AM–8 PM, by design)',
      'capacity 1, booked; one person waiting; free the seat and straight away book it as the public',
      'the public booking is refused sold out (the waitlist holds it, or already took it); the entry ends added',
    ],
    async run(ctx, scope) {
      needWaitlistHours()
      const { cls, seat } = await fullClass(ctx, scope, 'Waitlist first')
      const { entryId } = await joinWaitlist(ctx, scope, cls, waiter(ctx, 1))
      checkStatus(await freeTheSeat(ctx, cls.id, seat.bookingId), 200, 'Refund and free the seat')
      const pub = await bookWith(ctx, cls.id, { tickets: { person: 1 } })
      checkStatus(pub.reply, 409, 'A public booking for the freed seat')
      checkEqual(pub.reply.body?.code, 'sold_out', 'Refused as sold out')
      await checkNotCharged(ctx, scope, [pub.bookingId], sinceNow())
      const rows = await settleWaitlist(ctx, cls.id, (r) => r.some((x) => x.id === entryId && x.state === 'added'))
      checkEqual(rows.find((x) => x.id === entryId)?.state, 'added', 'Entry')
    },
  },
  {
    id: 61,
    title: 'HARD GATE · Saved-card proofs straight against the sandbox (Cards + Payments)',
    plan: [
      'a sandbox customer; CreateCard twice with one key → one card; a new key with the same nonce → noted',
      'CreatePayment on the saved card with customer_details (seller-initiated) → COMPLETED (HARD GATE: refused = FAIL); same key again → same payment; same key, other amount → IDEMPOTENCY_KEY_REUSED',
      'a charge with the wrong customer id → refused (4xx); DisableCard twice → the second answer noted',
      'the $1 test payment is refunded in the sandbox; every card made is disabled',
      'needs SQUARE_SANDBOX_ACCESS_TOKEN (skipped without it)',
    ],
    async run(ctx, scope) {
      const sq = ctx.square
      if (!sq) throw new SkipScenario('HARD GATE needs SQUARE_SANDBOX_ACCESS_TOKEN')
      const loc = await siteLocation(ctx, scope)
      const customer = (await sq.post('/customers', {
        idempotency_key: randomUUID(), given_name: 'E2E', family_name: `Cards ${ctx.runTag}`, email_address: ctx.person.email, reference_id: `e2e-${ctx.runTag}`,
      })).customer
      const other = (await sq.post('/customers', { idempotency_key: randomUUID(), given_name: 'E2E', family_name: `Other ${ctx.runTag}`, email_address: ctx.person.email })).customer
      scope.note(`sandbox customers ${customer.id}, ${other.id} stay in the sandbox (named E2E; harmless)`)
      const made: string[] = []
      scope.cleanup.add('disable the sandbox cards made', async () => {
        for (const id of made) await sq.post(`/cards/${encodeURIComponent(id)}/disable`, {}).catch(() => undefined)
      })
      const key = randomUUID()
      const cardBody = { idempotency_key: key, source_id: CARD_OK, card: { customer_id: customer.id, reference_id: `e2e-${ctx.runTag}` } }
      const c1 = (await sq.post('/cards', cardBody)).card
      made.push(c1.id)
      const c2 = (await sq.post('/cards', cardBody)).card
      checkEqual(c2.id, c1.id, 'CreateCard replay: the same card')
      check(c1.card_brand && c1.last_4 && Number.isInteger(c1.exp_month) && Number.isInteger(c1.exp_year), `Card fields: ${JSON.stringify({ b: c1.card_brand, l: c1.last_4, m: c1.exp_month, y: c1.exp_year })}`)
      const reuse = await errorOf(async () => { const c = (await sq.post('/cards', { ...cardBody, idempotency_key: randomUUID() })).card; made.push(c.id) })
      scope.note(`a new key with the same sandbox nonce: ${reuse ? `refused ${reuse.message}` : 'accepted (sandbox test nonces are reusable)'}`)

      const payKey = randomUUID()
      const pay = {
        idempotency_key: payKey, source_id: c1.id, customer_id: customer.id, location_id: loc, autocomplete: true,
        amount_money: { amount: 100, currency: 'USD' }, note: `E2E ${ctx.runTag} saved-card proof`,
        customer_details: { customer_initiated: false, seller_keyed_in: false },
      }
      let p1: any
      try {
        p1 = (await sq.post('/payments', pay)).payment
      } catch (e) {
        throw new Error(`Square REFUSED customer_details on a saved-card charge (${e instanceof Error ? e.message : e}). Every waitlist charge would fail: set SAVED_CARD_CUSTOMER_DETAILS to null before the waitlist ships.`)
      }
      checkEqual(p1.status, 'COMPLETED', 'Saved-card charge')
      scope.cleanup.add('refund the $1 sandbox proof payment', () => sq.post('/refunds', { idempotency_key: randomUUID(), payment_id: p1.id, amount_money: { amount: 100, currency: 'USD' }, reason: 'E2E sandbox proof' }))
      const p2 = (await sq.post('/payments', pay)).payment
      checkEqual(p2.id, p1.id, 'Same key, same body: the same payment')
      const changed = await errorOf(() => sq.post('/payments', { ...pay, amount_money: { amount: 101, currency: 'USD' } }))
      check(changed && /IDEMPOTENCY_KEY_REUSED/.test(changed.message), `Same key, other amount: ${changed?.message ?? 'accepted (a second charge!)'}`)
      const wrong = await errorOf(async () => {
        const p = (await sq.post('/payments', { ...pay, idempotency_key: randomUUID(), customer_id: other.id })).payment
        await sq.post('/refunds', { idempotency_key: randomUUID(), payment_id: p.id, amount_money: { amount: 100, currency: 'USD' }, reason: 'E2E sandbox proof' }).catch(() => undefined)
      })
      check(wrong && wrong.status >= 400 && wrong.status < 500, `A charge with another customer's id went through (${wrong?.message ?? 'accepted'})`)
      scope.note(`wrong customer id: ${wrong!.message}`)
      checkEqual((await sq.post(`/cards/${encodeURIComponent(c1.id)}/disable`, {})).card?.enabled, false, 'DisableCard')
      const again = await errorOf(() => sq.post(`/cards/${encodeURIComponent(c1.id)}/disable`, {}))
      scope.note(`DisableCard a second time: ${again ? again.message : '200'}`)
      const gone = await errorOf(() => sq.post('/payments', { ...pay, idempotency_key: randomUUID() }))
      check(gone && gone.status >= 400, 'A charge on a disabled card went through')
      scope.note(`charge on a disabled card: ${gone!.message} (must read as card-gone or declined, not setup)`)
    },
  },
  {
    id: 62,
    title: 'Register setup: what /admin reads from Square',
    plan: [
      'GET /api/admin/register.json: the tax and category in force, Square\'s taxes (percent as text, on/off, added on top) and categories',
      'notes whether a usable 9% tax exists; changes nothing',
    ],
    async run(ctx, scope) {
      const r = await ctx.admin.get('/api/admin/register.json')
      checkStatus(r, 200, 'Read Register setup')
      const d = r.body.data
      check(d.setup && 'classTaxId' in d.setup && 'classesCategoryId' in d.setup, `Setup shape: ${JSON.stringify(d.setup).slice(0, 200)}`)
      check(d.choices, `Square's taxes and categories couldn't be read: ${d.choicesError ?? 'no reason'}`)
      for (const t of d.choices.taxes as any[]) {
        check(typeof t.percent === 'string' && typeof t.enabled === 'boolean' && typeof t.additive === 'boolean', `Tax ${t.name}: ${JSON.stringify(t)}`)
      }
      check(Array.isArray(d.choices.categories), 'No category list')
      const usable = (d.choices.taxes as any[]).filter((t) => t.usable)
      scope.note(usable.length ? `usable 9% tax: ${usable.map((t) => `${t.name} (${t.percent}%)`).join(', ')}` : 'NO usable 9% tax on the preview: Make the 9% class tax in /admin › More › Register setup')
      scope.note(`tax in force from ${d.setup.source?.tax}, category from ${d.setup.source?.category}; ${d.notOnRegister?.length ?? 0} class(es) not on the register, ${d.oldSetup?.length ?? 0} on an old setup`)
    },
  },
  {
    id: 63,
    title: 'D4 POS price follows the early-bird, and back',
    plan: [
      'class $15 with an early-bird $12 running: the sandbox variation is $12, named "… (early-bird)"',
      'take the early-bird off → the variation is $15 with its plain name; the hourly job and Fix the register price now answer 200 (nothing to fix)',
      'Update the register answers 200',
      'needs SQUARE_SANDBOX_ACCESS_TOKEN for the Square half',
    ],
    async run(ctx, scope) {
      const content = { ...testContent({ name: nameOf(ctx, 'Price flip'), prices: PRICE15 }), earlyBird: { untilYmd: addDays(today(), 30), prices: { single: { person: 1200 } } } }
      const cls = await makeClass(ctx, scope, { content, sessions: ctx.slots.sessions(1) })
      const varId = cls.square?.variations?.['single:person']
      check(varId, 'No POS variation for the seat')
      const variation = async () => (await ctx.square!.get(`/catalog/object/${encodeURIComponent(varId)}`)).object?.item_variation_data
      if (ctx.square) {
        const v = await variation()
        checkEqual(Number(v.price_money?.amount), 1200, 'POS price while the early-bird runs')
        check(/\(early-bird\)$/.test(v.name ?? ''), `Variation name while the early-bird runs: "${v.name}"`)
      } else noSquare(scope)
      const { class: cur } = await bookingsOf(ctx, cls.id)
      const up = await updateClass(ctx, cls.id, { content: { ...cur.content, earlyBird: null } })
      checkStatus(up, 200, 'Take the early-bird off')
      if (up.body.warning) scope.note(`save warning: ${up.body.warning}`)
      const job = await ctx.admin.post('/api/jobs/class-prices.json', {})
      checkStatus(job, 200, 'Run the register-price job now')
      if (ctx.square) {
        const v = await variation()
        checkEqual(Number(v.price_money?.amount), 1500, 'POS price after the early-bird')
        check(!/early-bird/.test(v.name ?? ''), `Variation name after: "${v.name}"`)
      }
      const fix = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'fix-register-price', id: cls.id })
      checkStatus(fix, 200, 'Fix the register price now')
      checkEqual(fix.body.data.result, 'already', 'Nothing left to fix')
      checkStatus(await ctx.admin.post('/api/admin/classes/classes.json', { action: 'update-register', id: cls.id }), 200, 'Update the register')
    },
  },
  {
    id: 64,
    title: 'S4-12 Reader (simulated): a hand-built return is checked against Square',
    plan: [
      'skipped when Charge on the reader isn\'t linked on the preview; turned on for the test and put back',
      'start a reader sale; make a sandbox order + payment for exactly that amount, the booking id in the note',
      'post the return (that order id, the server-signed state) → paid; again → the same answer, still one seat',
      'a second sale with an order $1 off → refused, the seat stays waiting; then Let the seat go',
      'needs SQUARE_SANDBOX_ACCESS_TOKEN (skipped without it)',
    ],
    async run(ctx, scope) {
      const sq = ctx.square
      if (!sq) throw new SkipScenario('needs SQUARE_SANDBOX_ACCESS_TOKEN to make the sandbox payment the reader would')
      const st = await ctx.admin.get('/api/admin/reader.json')
      checkStatus(st, 200, 'Read Charge on the reader')
      if (!st.body.data.linked) throw new SkipScenario('Charge on the reader isn\'t linked on the preview (no SQUARE_POS_CLIENT_ID for the branch)')
      if (!st.body.data.on) {
        const on = await ctx.admin.post('/api/admin/reader.json', { enabled: true, expectedUpdatedAt: st.body.data.updatedAt })
        checkStatus(on, 200, 'Turn Charge on the reader on')
        scope.cleanup.add('turn Charge on the reader back off', async () => {
          const now = await ctx.admin.get('/api/admin/reader.json')
          checkStatus(await ctx.admin.post('/api/admin/reader.json', { enabled: false, expectedUpdatedAt: now.body.data.updatedAt }), 200, 'Turn it off')
        })
      }
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Reader') }), sessions: ctx.slots.sessions(1) })
      const loc = await siteLocation(ctx, scope)
      const start = async () => {
        const r = await ctx.staff.post('/api/staff/reader.json', {
          action: 'start', classId: cls.id, givenName: 'E2E', familyName: 'Reader', email: ctx.person.email, phone: ctx.person.phone,
          passId: 'single', tickets: { person: 1 }, attempt: `e2e-${randomUUID()}`,
        })
        checkStatus(r, 200, 'Start a reader sale')
        const d = r.body.data
        const raw = String(d.posUrl).split('data=')[1]
        const state = JSON.parse(decodeURIComponent(raw)).state
        check(typeof state === 'string' && state.startsWith(`${d.bookingId}.`), `State in the app link: ${String(state).slice(0, 40)}`)
        return { bookingId: d.bookingId as string, amountCents: d.amountCents as number, state: state as string }
      }
      const squareSale = async (bookingId: string, cents: number) => {
        const order = (await sq.post('/orders', {
          idempotency_key: randomUUID(),
          order: { location_id: loc, line_items: [{ name: 'E2E reader sale', quantity: '1', base_price_money: { amount: cents, currency: 'USD' } }] },
        })).order
        await sq.post('/payments', {
          idempotency_key: randomUUID(), source_id: CARD_OK, order_id: order.id, location_id: loc, autocomplete: true,
          amount_money: { amount: cents, currency: 'USD' }, note: `Hometown ${bookingId} · E2E reader`,
        })
        return order.id as string
      }
      const giveBack = (orderId: string, state: string) => ctx.staff.post('/api/staff/reader.json', {
        action: 'return', data: JSON.stringify({ status: 'ok', transaction_id: orderId, client_transaction_id: `e2e-${randomUUID().slice(0, 8)}`, state }),
      })
      const a = await start()
      checkEqual(a.amountCents, 2180, 'Reader amount ($20 + tax)')
      const orderA = await squareSale(a.bookingId, a.amountCents)
      const r1 = await giveBack(orderA, a.state)
      checkStatus(r1, 200, 'Return from the Square app')
      checkEqual(r1.body.data.outcome, 'paid', `Return answer (${r1.body.data.message})`)
      const r2 = await giveBack(orderA, a.state)
      checkStatus(r2, 200, 'The same return again')
      checkEqual(r2.body.data.outcome, 'paid', 'Replay answer')
      const mine = await ledgerBooking(ctx, cls.id, a.bookingId)
      checkEqual([mine.source, mine.state, mine.seatsComing], ['door-reader', 'confirmed', 1], 'Reader seat on the ledger')

      const b = await start()
      const orderB = await squareSale(b.bookingId, b.amountCents + 100)
      const r3 = await giveBack(orderB, b.state)
      check(r3.status !== 200 || r3.body.data.outcome !== 'paid', `A wrong-amount order paid the seat (${sayReply(r3)})`)
      scope.note(`wrong amount answer: ${r3.status} ${r3.body?.data?.message ?? r3.body?.error ?? ''}`)
      checkEqual((await ledgerBooking(ctx, cls.id, b.bookingId)).state, 'held', 'The second seat stays waiting')
      const go = await ctx.staff.post('/api/staff/reader.json', { action: 'let-go', bookingId: b.bookingId })
      scope.note(`Let the seat go: ${go.status} ${go.body?.data?.message ?? go.body?.error ?? ''}`)
    },
  },
  {
    id: 65,
    title: 'D2 Customer cancels 48+ hours ahead and is refunded',
    plan: [
      'book 2 seats ($21.80 each); the booking\'s "Can’t make it?" link opens a page that lets them cancel',
      'cancel seat 1 → $21.80 refunded in Square, seat 1 freed; the same tap again → nothing new',
      'two tabs cancel seat 2 at once → exactly one refund (the other tab: "changed"); the page then shows the whole booking cancelled',
      'the class sheet line counts it once: "Cancelled online by the customer · 2 seats, $43.60 refunded"',
      'Square shows exactly 2 refunds on the payment',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Self cancel') }), sessions: ctx.slots.sessions(1) })
      const b = await bookWith(ctx, cls.id, { tickets: { person: 2 } })
      checkStatus(b.reply, 200, 'Book 2 seats')
      const t = await cancelToken(ctx, cls.id, b.bookingId)
      const v = await cancelView(ctx, t)
      checkEqual([v.mode, v.state], ['self', 'open'], 'Cancel page (mode, state)')
      checkEqual((v.seats as any[]).map((s) => s.cents), [2180, 2180], 'Refund per seat shown')
      const [s1, s2] = (v.seats as any[]).sort((x, y) => x.seat - y.seat)
      const tap = { t, action: 'cancel', lineIds: [s1.lineId], attempt: `e2e-${randomUUID()}` }
      const c1 = await cancelPost(ctx, tap)
      checkStatus(c1, 200, 'Cancel seat 1')
      checkEqual([c1.body.data.result, c1.body.data.cents], ['cancelled', 2180], 'Cancel answer')
      const c1b = await cancelPost(ctx, tap)
      check(c1b.status === 200 || c1b.status === 409, `Double tap: ${sayReply(c1b)}`)
      const after1 = await ledgerBooking(ctx, cls.id, b.bookingId)
      checkEqual([after1.seatsComing, after1.refundedCents], [1, 2180], 'Ledger after seat 1 (coming, refunded)')
      const [x, y] = await Promise.all(['B', 'C'].map(() => cancelPost(ctx, { t, action: 'cancel', lineIds: [s2.lineId], attempt: `e2e-${randomUUID()}` })))
      check([x, y].some((r) => r.status === 200 && r.body.data.result === 'cancelled'), `Neither tab cancelled seat 2: ${sayReply(x)} / ${sayReply(y)}`)
      for (const r of [x, y]) check(r.status === 200 || (r.status === 409 && r.body?.code === 'changed'), `A tab answered ${sayReply(r)}`)
      const end = await cancelView(ctx, t)
      checkEqual(end.state, 'cancelled', 'Page state after both seats')
      checkEqual((end.seats as any[]).map((s) => s.state), ['cancelled', 'cancelled'], 'Seats on the page')
      const third = await cancelPost(ctx, { t, action: 'cancel', lineIds: [s1.lineId, s2.lineId], attempt: `e2e-${randomUUID()}` })
      check(third.status === 200 || third.status === 409, `A third cancel: ${sayReply(third)}`)
      const row = await ledgerBooking(ctx, cls.id, b.bookingId)
      checkEqual(row.refundedCents, 4360, 'Ledger refunded in total')
      // T3/F2: the class sheet counts each refund once, whatever the two tabs did.
      checkEqual(row.cancelLine, 'Cancelled online by the customer · 2 seats, $43.60 refunded', 'Class sheet line')
      if (!ctx.square) return noSquare(scope)
      const refunds = await refundsOn(ctx, b.reply.body.data.paymentId)
      checkEqual(refunds.length, 2, 'Square refunds on the payment')
      checkEqual(refunds.map((r) => Number(r.amount_money.amount)), [2180, 2180], 'Square refund amounts')
    },
  },
  {
    id: 66,
    title: 'D2 A comped seat asks instead; an owner decides in To decide',
    plan: [
      'comp a seat from /staff; its "Can’t make it?" page offers only "Send us a note" (with why)',
      'send a note → "requested"; To decide has a "cancel-request" item for it; Keep their seat → done',
      'the page still shows the note; nothing refunded',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Cancel request') }), sessions: ctx.slots.sessions(1) })
      const comp = await ctx.staff.post('/api/staff/comp-seat.json', {
        scheduleId: cls.id, givenName: 'E2E', familyName: 'Comp', email: ctx.person.email, phone: ctx.person.phone,
        passId: 'single', tickets: { person: 1 }, attempt: `e2e-${randomUUID()}`, reason: 'E2E sandbox test comp',
      })
      checkStatus(comp, 200, 'Comp a seat')
      const bookingId = comp.body.data.bookingId
      const t = await cancelToken(ctx, cls.id, bookingId)
      const v = await cancelView(ctx, t)
      checkEqual(v.mode, 'request', 'Cancel page mode for a comp')
      check(typeof v.why === 'string' && v.why.length > 5, `No reason shown: ${JSON.stringify(v.why)}`)
      const self = await cancelPost(ctx, { t, action: 'cancel', lineIds: v.seats.map((s: any) => s.lineId), attempt: `e2e-${randomUUID()}` })
      checkStatus(self, 409, 'Self-cancel on a comp')
      checkEqual(self.body?.code, 'request-only', 'Refused as request only')
      const req = await cancelPost(ctx, { t, action: 'request', note: 'E2E test note' })
      checkStatus(req, 200, 'Send us a note')
      checkEqual(req.body.data.result, 'requested', 'Note answer')
      let item: any
      for (let i = 0; i < 3 && !item; i++) {
        item = (await toDecide(ctx)).find((x: any) => x.kind === 'cancel-request' && x.detail?.bookingId === bookingId && !x.done)
        if (!item) await ctx.sleep(2_000)
      }
      check(item, 'No cancel-request item in To decide')
      const d = await ctx.admin.post('/api/admin/to-decide.json', { id: item.id, action: 'keep' })
      checkStatus(d, 200, 'Keep their seat')
      const again = await cancelView(ctx, t)
      checkEqual(again.request?.note, 'E2E test note', 'The page shows the note')
      checkEqual((await ledgerBooking(ctx, cls.id, bookingId)).seatsComing, 1, 'Seat kept')
    },
  },
  {
    id: 67,
    title: 'D2 A free booking cancels itself, no refund',
    plan: [
      'code E2E…J 100% off; book free; the cancel page says free (no money back)',
      'cancel → "cancelled", $0, seat freed, nothing refunded in Square',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Free cancel') }), sessions: ctx.slots.sessions(1) })
      const code = e2eCode(ctx.runTag, 'J')
      await makeCode(ctx, scope, { code, off: { kind: 'percent', percent: 100 }, maxUses: 1 })
      const b = await bookWith(ctx, cls.id, { tickets: { person: 1 } }, { code, token: null, expected: 0 })
      checkStatus(b.reply, 200, 'Free booking')
      const t = await cancelToken(ctx, cls.id, b.bookingId)
      const v = await cancelView(ctx, t)
      checkEqual(v.mode, 'free', 'Cancel page mode')
      const c = await cancelPost(ctx, { t, action: 'cancel', lineIds: v.seats.map((s: any) => s.lineId), attempt: `e2e-${randomUUID()}` })
      checkStatus(c, 200, 'Cancel the free booking')
      checkEqual([c.body.data.result, c.body.data.cents], ['cancelled', 0], 'Cancel answer')
      const mine = await ledgerBooking(ctx, cls.id, b.bookingId)
      checkEqual([mine.seatsComing, mine.refundedCents], [0, 0], 'Ledger (coming, refunded)')
      await checkNotCharged(ctx, scope, [b.bookingId], sinceNow())
    },
  },
]

// ── After a run stopped part way ───────────────────────────────────────────

export const EXTRAS_CLEANUP_PLAN = [
  'turn off every promo code starting "E2E" that is still on (codes are never deleted)',
  'take people named "E2E" off the waitlists of "E2E …" classes (their saved cards come off file)',
  'with SQUARE_SANDBOX_ACCESS_TOKEN: disable any sandbox card still on file for those waitlist entries',
]

/** Run before the class cleanup (a cancelled class's waitlist closes by itself, but this says so per person). */
export async function cleanUpExtrasLeftovers(ctx: Pick<Ctx, 'admin' | 'square'>, log: (line: string) => void): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = []
  const failed: string[] = []
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn()
      done.push(label)
      log(`    done: ${label}`)
    } catch (e) {
      const msg = `${label} (${e instanceof Error ? e.message : String(e)})`
      failed.push(msg)
      log(`    FAILED: ${msg}`)
    }
  }
  const codes = await ctx.admin.get('/api/admin/promos.json')
  checkStatus(codes, 200, 'List promo codes')
  for (const c of (codes.body.data.codes as any[]).filter((x) => typeof x.code === 'string' && x.code.startsWith('E2E') && x.active)) {
    await step(`turn off code ${c.code}`, () => turnOffCode(ctx, c.code))
  }
  const classes = await ctx.admin.get('/api/admin/classes/classes.json')
  checkStatus(classes, 200, 'List classes')
  for (const cls of (classes.body.data.classes as any[]).filter((x) => typeof x.content?.name === 'string' && x.content.name.startsWith('E2E '))) {
    const w = await ctx.admin.get(`/api/admin/classes/waitlist.json?id=${encodeURIComponent(cls.id)}`)
    if (w.status !== 200) continue
    for (const row of (w.body.data.rows as any[]).filter((r) => typeof r.name === 'string' && r.name.startsWith('E2E'))) {
      if (row.state === 'waiting' && cls.status !== 'cancelled') {
        await step(`take ${row.name} (${row.id}) off ${cls.content.name}`, async () => {
          checkStatus(await ctx.admin.post('/api/admin/classes/waitlist.json', { action: 'remove', classId: cls.id, entryId: row.id }), 200, 'Remove')
        })
      }
      if (ctx.square) {
        const sq = ctx.square
        const card = ((await sq.get(`/cards?reference_id=${encodeURIComponent(row.id)}&include_disabled=true`).catch(() => ({ cards: [] }))).cards ?? [])[0]
        if (card?.enabled) await step(`disable the sandbox card for ${row.id}`, async () => { await sq.post(`/cards/${encodeURIComponent(card.id)}/disable`, {}) })
      }
    }
  }
  return { done, failed }
}

/** Extras scenarios that skip without SQUARE_SANDBOX_ACCESS_TOKEN (the rest only skip their Square half). */
export const EXTRAS_NEED_TOKEN = [49, 57, 61, 64]
