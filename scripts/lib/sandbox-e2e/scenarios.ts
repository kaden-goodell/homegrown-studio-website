/**
 * The sandbox end-to-end scenarios (scripts/sandbox-e2e.ts runs them). Each
 * one makes its own "E2E …" classes (link-only unless the scenario is about
 * the public list), checks what the site answered, the seat ledger through
 * /api/admin/classes/bookings.json and, with SQUARE_SANDBOX_ACCESS_TOKEN set,
 * the order and payment in the Square sandbox. Each cleans up after itself:
 * its classes are cancelled (never refunded) and their library entries
 * archived. Only scenarios 10 and 17 refund, and only sandbox money.
 */
import { createHash, randomUUID } from 'node:crypto'
import { ownPriceLabel } from '../../../src/lib/classes/public-class'
import {
  addDays, check, checkEqual, checkStatus, chicagoDate, chicagoToUtcIso, lineTax, sayReply, SkipScenario, totalWithTax, weekdayOf,
  type PreviewClient, type RateGate, type Reply, type Scenario, type Scope, type SlotAllocator, type SquareSandbox,
} from './core'

export interface Person { givenName: string; familyName: string; email: string; phone: string }
export interface Ctx {
  /** a customer: no cookies */
  pub: PreviewClient
  /** signed in to /admin */
  admin: PreviewClient
  /** signed in to /staff */
  staff: PreviewClient
  /** shared by every booking call (the endpoint allows 5 a minute) */
  gate: RateGate
  square: SquareSandbox | null
  slots: SlotAllocator
  /** short and unique to this run, in every class name */
  runTag: string
  person: Person
  /** the saved studio settings (closed days, café hours) as read at the start */
  settings: any
  sleep(ms: number): Promise<void>
  log(line: string): void
}

// ── Building blocks ────────────────────────────────────────────────────────

export const CARD_OK = 'cnon:card-nonce-ok'
export const CARD_DECLINED = 'cnon:card-nonce-declined'
export const CARD_BAD_CVV = 'cnon:card-nonce-rejected-cvv'
export const GIFT_CARD_OK = 'cnon:gift-card-nonce-ok'

const DESCRIPTION = 'A test class made by the sandbox end-to-end suite. It is cancelled when the test ends.'

/** Our booking id for an attempt (the same rule as src/lib/classes/checkout.ts bookingIdFor; a unit test keeps them equal). */
export function bookingIdOf(attemptId: string): string {
  return `bkg_${createHash('sha256').update(attemptId).digest('hex').slice(0, 16)}`
}

export interface ContentInput {
  name: string
  ticketTypes?: { id: string; label: string }[]
  passes?: { id: string; label: string; covers: any }[]
  prices?: Record<string, Record<string, number>>
  rules?: Record<string, unknown>
}

/** A class's details: link-only, taxable, one "Person" seat at $20 unless said otherwise. */
export function testContent(c: ContentInput): any {
  return {
    name: c.name,
    description: DESCRIPTION,
    imageUrl: null,
    instructor: null,
    rules: { linkOnly: true, taxable: true, maxPerBooking: 10, ...(c.rules ?? {}) },
    ticketTypes: c.ticketTypes ?? [{ id: 'person', label: 'Person' }],
    passes: c.passes ?? [{ id: 'single', label: 'Class', covers: { kind: 'all' } }],
    prices: c.prices ?? { single: { person: 2000 } },
    questions: [],
    addOns: [],
    defaultCapacity: 6,
    defaultMinutes: 30,
  }
}

const nameOf = (ctx: Ctx, what: string) => `E2E ${ctx.runTag} ${what}`.slice(0, 80)

const registered = new WeakMap<Scope, Set<string>>()
/** Cleanup for a class: cancel it, then archive its library entry (registered so they run in that order). Once per class. */
function cleanUpClass(ctx: Ctx, scope: Scope, cls: any): void {
  const seen = registered.get(scope) ?? new Set<string>()
  registered.set(scope, seen)
  if (seen.has(cls.id)) return
  seen.add(cls.id)
  if (cls.libraryId) scope.cleanup.add(`archive library ${cls.libraryId}`, () => archiveLibrary(ctx, cls.libraryId))
  scope.cleanup.add(`cancel ${cls.id}`, () => cancelClass(ctx, cls.id))
}

/** Schedule a class (POST create). Fails unless it is on the POS when open. Cleanup is registered. */
export async function makeClass(
  ctx: Ctx, scope: Scope,
  opts: { content: any; sessions: { startIso: string; endIso: string; capacity: number }[]; status?: 'open' | 'draft'; createKey?: string; libraryId?: string },
): Promise<any> {
  const r = await ctx.admin.post('/api/admin/classes/classes.json', {
    action: 'create',
    ...(opts.libraryId ? { libraryId: opts.libraryId } : { content: opts.content }),
    sessions: opts.sessions,
    status: opts.status ?? 'open',
    ...(opts.createKey ? { createKey: opts.createKey } : {}),
  })
  checkStatus(r, 200, `Schedule ${opts.content?.name ?? 'class'}`)
  const cls = r.body.data.class
  cleanUpClass(ctx, scope, cls)
  if (r.body.warning) scope.note(`schedule warning: ${r.body.warning}`)
  if ((opts.status ?? 'open') === 'open') check(cls.square?.itemId, `${cls.content.name} is not on the POS (${r.body.warning ?? 'no item id'}), so it can't be sold`)
  return cls
}

export async function bookingsOf(ctx: Ctx, classId: string): Promise<{ class: any; bookings: any[]; seatsTaken: Record<string, number> }> {
  const r = await ctx.admin.get(`/api/admin/classes/bookings.json?id=${encodeURIComponent(classId)}`)
  checkStatus(r, 200, 'Read the bookings')
  return r.body.data
}

export async function cancelClass(ctx: Ctx, classId: string): Promise<void> {
  const { class: cls } = await bookingsOf(ctx, classId)
  if (cls.status === 'cancelled') return
  const r = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'cancel', id: classId, expectedUpdatedAt: cls.updatedAt })
  checkStatus(r, 200, `Cancel ${classId}`)
  if (r.body.warning) throw new Error(`cancelled with a warning: ${r.body.warning}`)
}

async function archiveLibrary(ctx: Ctx, libraryId: string): Promise<void> {
  const r = await ctx.admin.post('/api/admin/classes/library.json', { action: 'archive', id: libraryId })
  checkStatus(r, 200, `Archive library ${libraryId}`)
}

async function updateClass(ctx: Ctx, classId: string, change: Record<string, unknown>): Promise<Reply> {
  const { class: cls } = await bookingsOf(ctx, classId)
  return ctx.admin.post('/api/admin/classes/classes.json', { action: 'update', id: classId, expectedUpdatedAt: cls.updatedAt, ...change })
}

export interface Booked { reply: Reply; attemptId: string; bookingId: string }

/** Book as a customer (through the shared gate). */
export async function book(
  ctx: Ctx, classId: string,
  req: { passId: string; tickets: Record<string, number>; sessionIds?: string[] },
  token = CARD_OK, opts: { gated?: boolean } = {},
): Promise<Booked> {
  const attemptId = randomUUID()
  const reply = await ctx.pub.post('/api/classes/book.json', {
    classId, ...req, paymentToken: token, attemptId, sourceKind: token.startsWith('cnon:gift') ? 'gift' : 'card',
    customer: ctx.person,
  }, { gated: opts.gated ?? true })
  if (reply.status === 403) throw new Error(`Bookings are closed on the preview (${sayReply(reply)}). Set BOOKINGS_OPEN to include workshops for the branch.`)
  return { reply, attemptId, bookingId: bookingIdOf(attemptId) }
}

/** A booking that should have gone through: the reply, the ledger, and Square's order and payment. */
async function checkPaid(ctx: Ctx, scope: Scope, cls: any, b: Booked, expect: { seatPrices: number[]; sessionIds?: string[]; tickets?: Record<string, number>; giftCard?: boolean }) {
  checkStatus(b.reply, 200, 'Booking')
  const d = b.reply.body.data
  check(!d.simulated, 'The preview simulated the payment (DEV_BYPASS_PAYMENT is on for the branch); turn it off so the sandbox is charged')
  const total = totalWithTax(expect.seatPrices)
  checkEqual(d.bookingId, b.bookingId, 'Booking id')
  checkEqual(d.totalChargedCents, total, 'Charged (cents)')
  checkEqual(d.seatsBooked, expect.seatPrices.length, 'Seats booked')
  if (expect.sessionIds) checkEqual([...d.sessionIds].sort(), [...expect.sessionIds].sort(), 'Sessions booked')

  const { bookings } = await bookingsOf(ctx, cls.id)
  const mine = bookings.find((x) => x.bookingId === b.bookingId)
  check(mine, `Ledger has no booking ${b.bookingId}`)
  checkEqual(mine.state, 'confirmed', 'Ledger booking state')
  checkEqual(mine.source, 'online', 'Ledger seat source')
  checkEqual(mine.paidCents, total, 'Ledger paid (cents)')
  checkEqual(mine.lineIds.length, expect.seatPrices.length, 'Ledger seat lines')
  if (expect.tickets) checkEqual(mine.seats, expect.tickets, 'Ledger seats per ticket type')
  if (expect.sessionIds) checkEqual([...mine.sessionIds].sort(), [...expect.sessionIds].sort(), 'Ledger sessions')
  check(mine.paidHere, 'Ledger booking has no Square payment id')

  if (!ctx.square) return noSquare(scope)
  const order = (await ctx.square.get(`/orders/${encodeURIComponent(d.orderId)}`)).order
  checkEqual(order.state, 'COMPLETED', 'Square order state')
  checkEqual(order.reference_id, b.bookingId, 'Square order reference')
  checkEqual(Number(order.total_money?.amount), total, 'Square order total')
  const lines = order.line_items ?? []
  checkEqual(lines.reduce((s: number, li: any) => s + Number(li.quantity), 0), expect.seatPrices.length, 'Square order seat lines')
  for (const li of lines) {
    const base = Number(li.base_price_money?.amount)
    checkEqual(Number(li.total_tax_money?.amount), lineTax(base) * Number(li.quantity), `Square tax on the ${base / 100} line`)
  }
  checkEqual(lines.map((li: any) => Number(li.base_price_money?.amount)).sort(), [...expect.seatPrices].sort(), 'Square line prices')
  check(!(order.taxes ?? []).some((t: any) => t.scope === 'ORDER'), 'Square order carries an order-level tax (it must come from the catalog per line)')
  const payment = (await ctx.square.get(`/payments/${encodeURIComponent(d.paymentId)}`)).payment
  checkEqual(payment.status, 'COMPLETED', 'Square payment status')
  checkEqual(Number(payment.total_money?.amount), total, 'Square payment amount')
  checkEqual(payment.order_id, d.orderId, 'Square payment order')
  if (expect.giftCard) checkEqual(payment.card_details?.card?.card_brand, 'SQUARE_GIFT_CARD', 'Square payment card brand')
}

const noted = new WeakSet<Scope>()
function noSquare(scope: Scope): void {
  if (noted.has(scope)) return
  noted.add(scope)
  scope.note('Square side not checked (no SQUARE_SANDBOX_ACCESS_TOKEN)')
}

let locationCache: string[] | null = null
async function locationIds(sq: SquareSandbox): Promise<string[]> {
  if (!locationCache) locationCache = ((await sq.get('/locations')).locations ?? []).filter((l: any) => l.status === 'ACTIVE').map((l: any) => l.id)
  return locationCache!
}

/** Orders made since `sinceIso` whose reference is one of these booking ids. */
async function ordersFor(sq: SquareSandbox, refs: string[], sinceIso: string): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const res = await sq.post('/orders/search', {
      location_ids: await locationIds(sq),
      limit: 500,
      ...(cursor ? { cursor } : {}),
      query: { filter: { date_time_filter: { created_at: { start_at: sinceIso } } }, sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' } },
    })
    out.push(...(res.orders ?? []).filter((o: any) => refs.includes(o.reference_id)))
    cursor = res.cursor
    if (!cursor) break
  }
  return out
}

/** Nothing was charged for these bookings: no paid order, no tender. */
async function checkNotCharged(ctx: Ctx, scope: Scope, refs: string[], sinceIso: string): Promise<void> {
  if (!ctx.square) return noSquare(scope)
  for (const o of await ordersFor(ctx.square, refs, sinceIso)) {
    check(o.state !== 'COMPLETED', `Square order ${o.id} for ${o.reference_id} is COMPLETED (charged)`)
    check(!(o.tenders ?? []).length, `Square order ${o.id} for ${o.reference_id} has a payment`)
  }
}

const sinceNow = () => new Date(Date.now() - 2 * 60_000).toISOString()
const sessionLeft = async (ctx: Ctx, classId: string) => {
  const r = await ctx.pub.get(`/api/classes/${classId}.json`)
  checkStatus(r, 200, 'Read the class by its link')
  return (r.body.workshop.own.sessions as any[]).map((s) => s.left)
}

async function publicList(ctx: Ctx): Promise<any[]> {
  const r = await ctx.pub.get(`/api/workshops.json?e2e=${Date.now()}`)
  checkStatus(r, 200, 'Read the public class list')
  return r.body?.workshops ?? r.body?.data?.workshops ?? (Array.isArray(r.body) ? r.body : [])
}

async function squareItem(sq: SquareSandbox, id: string): Promise<any> {
  return (await sq.get(`/catalog/object/${encodeURIComponent(id)}?include_related_objects=false`)).object
}
const hidden = (o: any) => o.present_at_all_locations === false && !(o.present_at_location_ids ?? []).length

/** Pick a day for the class right now: refuses unless it can start `minutes` from now today. */
function startingSoon(minutesAhead: number, lengthMinutes: number): { startIso: string; endIso: string; capacity: number } {
  const start = Math.ceil((Date.now() + minutesAhead * 60_000) / 60_000) * 60_000
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + lengthMinutes * 60_000).toISOString(), capacity: 6 }
}

/** The location the site's own orders use (a sandbox may have several). */
async function siteLocation(ctx: Ctx, scope: Scope): Promise<string> {
  const ids = await locationIds(ctx.square!)
  if (ids.length === 1) return ids[0]
  const recent = await ctx.square!.post('/orders/search', {
    location_ids: ids, limit: 50, query: { sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' } },
  })
  const ours = (recent.orders ?? []).find((o: any) => String(o.reference_id ?? '').startsWith('bkg_'))
  if (ours) return ours.location_id
  scope.note(`several sandbox locations and no site order to tell which; used ${ids[0]}`)
  return ids[0]
}

/** A sale rung up "at the counter": a sandbox order of class items, paid with the sandbox card. */
async function counterSale(ctx: Ctx, scope: Scope, lines: { variationId: string; qty: number }[]): Promise<{ orderId: string; totalCents: number }> {
  const sq = ctx.square!
  const location = await siteLocation(ctx, scope)
  const order = (await sq.post('/orders', {
    idempotency_key: randomUUID(),
    order: {
      location_id: location,
      line_items: lines.map((l) => ({ catalog_object_id: l.variationId, quantity: String(l.qty) })),
      pricing_options: { auto_apply_taxes: true },
    },
  })).order
  const total = Number(order.total_money.amount)
  await sq.post('/payments', {
    idempotency_key: randomUUID(), source_id: CARD_OK, order_id: order.id, location_id: location,
    amount_money: { amount: total, currency: order.total_money.currency ?? 'USD' },
  })
  return { orderId: order.id, totalCents: total }
}

async function reconcile(ctx: Ctx): Promise<any> {
  const r = await ctx.admin.post('/api/jobs/reconcile-classes.json?force=1', {})
  checkStatus(r, 200, 'Run the reconcile')
  check(!r.body?.data?.skipped, `Reconcile skipped: ${r.body?.data?.skipped}`)
  return r.body.data
}

async function toDecide(ctx: Ctx): Promise<any[]> {
  const r = await ctx.admin.get('/api/admin/to-decide.json')
  checkStatus(r, 200, 'Read To decide')
  return r.body.data.items
}

/** Refund through /admin. */
async function refund(ctx: Ctx, body: Record<string, unknown>): Promise<Reply> {
  return ctx.admin.post('/api/admin/classes/refund.json', { reason: 'E2E sandbox test', ...body })
}

async function checkRefundInSquare(ctx: Ctx, scope: Scope, refundId: string, cents: number): Promise<void> {
  if (!ctx.square) return noSquare(scope)
  check(refundId, 'The refund has no Square refund id')
  const r = (await ctx.square.get(`/refunds/${encodeURIComponent(refundId)}`)).refund
  checkEqual(Number(r.amount_money?.amount), cents, 'Square refund amount')
  check(['PENDING', 'COMPLETED'].includes(r.status), `Square refund status is ${r.status}`)
}

// ── The scenarios ──────────────────────────────────────────────────────────

export const scenarios: Scenario<Ctx>[] = [
  {
    id: 1,
    title: 'Library class scheduled, on the public list',
    plan: [
      'save a library class (Adult $20, Kid $15), schedule it link-only from the library',
      'check it is NOT on the public list, then make it public',
      'public list shows it at $15 and the label "$20 adult · $15 kid"; Square item has both prices',
      'cleanup: cancel the class, archive the library entry',
    ],
    async run(ctx, scope) {
      const content = testContent({
        name: nameOf(ctx, 'Library'),
        ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
        prices: { single: { adult: 2000, kid: 1500 } },
      })
      const lib = await ctx.admin.post('/api/admin/classes/library.json', { action: 'save', content, note: 'E2E test' })
      checkStatus(lib, 200, 'Save to the library')
      const libraryId = lib.body.data.library.id
      scope.cleanup.add(`archive library ${libraryId}`, () => archiveLibrary(ctx, libraryId))
      const cls = await makeClass(ctx, scope, { content, libraryId, sessions: ctx.slots.sessions(1) })
      checkEqual(cls.libraryId, libraryId, 'Class library id')
      checkEqual(cls.content.name, content.name, 'Class name from the library')
      check(!(await publicList(ctx)).some((w) => w.id === cls.id), 'A link-only class is on the public list')

      const r = await updateClass(ctx, cls.id, { content: { ...cls.content, rules: { ...cls.content.rules, linkOnly: false } } })
      checkStatus(r, 200, 'Make it public')
      const row = (await publicList(ctx)).find((w) => w.id === cls.id)
      check(row, 'The class is not on the public list')
      checkEqual(row.price, 1500, 'Listed price (lowest, cents)')
      checkEqual(row.own?.prices?.single, { adult: 2000, kid: 1500 }, 'Listed prices')
      checkEqual(row.taxPercent, 9, 'Listed tax percent')
      checkEqual(ownPriceLabel(row.own), '$20 adult · $15 kid', 'Price label')

      if (!ctx.square) return noSquare(scope)
      const item = await squareItem(ctx.square, cls.square.itemId)
      const prices = (item.item_data.variations as any[]).map((v) => Number(v.item_variation_data.price_money.amount)).sort()
      checkEqual(prices, [1500, 2000], 'Square item prices')
      check(item.present_at_all_locations === true, 'Square item is not on the POS')
      check((item.item_data.tax_ids ?? []).length >= 1, 'Square item has no tax')
    },
  },
  {
    id: 2,
    title: 'One price, booking of 3',
    plan: ['class at $20, book 3 with the sandbox card', 'one payment of $65.40, three $1.80 tax lines, 3 ledger seats'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Three seats') }), sessions: ctx.slots.sessions(1) })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 3 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000, 2000, 2000], tickets: { person: 3 } })
      const { seatsTaken } = await bookingsOf(ctx, cls.id)
      checkEqual(seatsTaken[cls.sessions[0].id], 3, 'Seats taken')
    },
  },
  {
    id: 3,
    title: 'Adult + 2 Kids (ticket types)',
    plan: ['class with Adult $20 / Kid $15, book 1 adult + 2 kids', 'lines 2000/1500/1500, tax 180/135/135, total $54.50'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, {
        content: testContent({
          name: nameOf(ctx, 'Adult and kids'),
          ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
          prices: { single: { adult: 2000, kid: 1500 } },
        }),
        sessions: ctx.slots.sessions(1),
      })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { adult: 1, kid: 2 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000, 1500, 1500], tickets: { adult: 1, kid: 2 } })
    },
  },
  {
    id: 4,
    title: '4-session camp: full series, one day, choose 2',
    plan: [
      '4 sessions; passes Full $80 (all), Day $25 (choose 1), Two days $45 (choose 2)',
      'book each once; seats taken per session = 1, 2, 2, 2; ledger sessions match each pass',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, {
        content: testContent({
          name: nameOf(ctx, 'Camp'),
          passes: [
            { id: 'full', label: 'Full camp', covers: { kind: 'all' } },
            { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
            { id: 'two', label: 'Two days', covers: { kind: 'choose', count: 2 } },
          ],
          prices: { full: { person: 8000 }, day: { person: 2500 }, two: { person: 4500 } },
        }),
        sessions: ctx.slots.sessions(4),
      })
      const s = (cls.sessions as any[]).map((x) => x.id)
      const full = await book(ctx, cls.id, { passId: 'full', tickets: { person: 1 } })
      await checkPaid(ctx, scope, cls, full, { seatPrices: [8000], sessionIds: s })
      const day = await book(ctx, cls.id, { passId: 'day', tickets: { person: 1 }, sessionIds: [s[1]] })
      await checkPaid(ctx, scope, cls, day, { seatPrices: [2500], sessionIds: [s[1]] })
      const two = await book(ctx, cls.id, { passId: 'two', tickets: { person: 1 }, sessionIds: [s[2], s[3]] })
      await checkPaid(ctx, scope, cls, two, { seatPrices: [4500], sessionIds: [s[2], s[3]] })
      const { seatsTaken } = await bookingsOf(ctx, cls.id)
      checkEqual(s.map((id) => seatsTaken[id]), [1, 2, 2, 2], 'Seats taken per session')
      const bad = await book(ctx, cls.id, { passId: 'two', tickets: { person: 1 }, sessionIds: [s[0]] })
      checkStatus(bad.reply, 400, 'Choose-2 pass with one day picked')
    },
  },
  {
    id: 5,
    title: 'Join partway after session 1 started',
    plan: [
      'a 3-session class whose first session starts about 2 minutes from now (the server refuses moving dates into the past, R37, so the script waits instead)',
      'after it starts: the full-series pass is refused before any charge; the "rest of it" pass books sessions 2 and 3 only',
    ],
    async run(ctx, scope) {
      const first = startingSoon(2, 10)
      const cls = await makeClass(ctx, scope, {
        content: testContent({
          name: nameOf(ctx, 'Join partway'),
          passes: [
            { id: 'full', label: 'Whole class', covers: { kind: 'all' } },
            { id: 'rest', label: 'The rest of it', covers: { kind: 'remaining' } },
          ],
          prices: { full: { person: 6000 }, rest: { person: 4000 } },
          rules: { joinPartway: true },
        }),
        sessions: [first, ...ctx.slots.sessions(2)],
      })
      const wait = Date.parse(first.startIso) - Date.now() + 5_000
      if (wait > 0) { ctx.log(`    waiting ${Math.round(wait / 1000)}s for session 1 to start`); await ctx.sleep(wait) }
      const s = (cls.sessions as any[]).map((x) => x.id)
      const since = sinceNow()
      const whole = await book(ctx, cls.id, { passId: 'full', tickets: { person: 1 } })
      checkStatus(whole.reply, 409, 'Whole-class pass after it started')
      await checkNotCharged(ctx, scope, [whole.bookingId], since)
      const rest = await book(ctx, cls.id, { passId: 'rest', tickets: { person: 1 } })
      await checkPaid(ctx, scope, cls, rest, { seatPrices: [4000], sessionIds: [s[1], s[2]] })
    },
  },
  {
    id: 6,
    title: 'Sold out: capacity 2, third refused before charge',
    plan: ['capacity 2, book 2', 'a third seat is refused (409 sold_out) and Square has no paid order for it'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Sold out') }), sessions: ctx.slots.sessions(1, { capacity: 2 }) })
      const two = await book(ctx, cls.id, { passId: 'single', tickets: { person: 2 } })
      await checkPaid(ctx, scope, cls, two, { seatPrices: [2000, 2000] })
      const since = sinceNow()
      const third = await book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } })
      checkStatus(third.reply, 409, 'Third seat')
      checkEqual(third.reply.body?.code, 'sold_out', 'Refusal code')
      const { seatsTaken, bookings } = await bookingsOf(ctx, cls.id)
      checkEqual(seatsTaken[cls.sessions[0].id], 2, 'Seats taken')
      check(!bookings.some((x) => x.bookingId === third.bookingId), 'The refused booking is on the ledger')
      await checkNotCharged(ctx, scope, [third.bookingId], since)
    },
  },
  {
    id: 7,
    title: 'Concurrent last seat: one 200, one 409, one charge',
    plan: ['capacity 1, two bookings sent at the same moment', 'one 200 and one 409; one seat taken; only the winner charged'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Last seat') }), sessions: ctx.slots.sessions(1, { capacity: 1 }) })
      const since = sinceNow()
      await ctx.gate.take(2)
      const both = await Promise.all([
        book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } }, CARD_OK, { gated: false }),
        book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } }, CARD_OK, { gated: false }),
      ])
      checkEqual(both.map((b) => b.reply.status).sort(), [200, 409], 'Statuses')
      const won = both.find((b) => b.reply.status === 200)!
      const lost = both.find((b) => b.reply.status === 409)!
      await checkPaid(ctx, scope, cls, won, { seatPrices: [2000] })
      const { seatsTaken } = await bookingsOf(ctx, cls.id)
      checkEqual(seatsTaken[cls.sessions[0].id], 1, 'Seats taken')
      await checkNotCharged(ctx, scope, [lost.bookingId], since)
    },
  },
  {
    id: 8,
    title: 'Declined card and bad CVV: nothing held, nothing paid',
    plan: ['book with the declined nonce, then the rejected-CVV nonce', 'both 402 card_declined; no seats held; no paid order'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Declined') }), sessions: ctx.slots.sessions(1) })
      const since = sinceNow()
      const refs: string[] = []
      for (const token of [CARD_DECLINED, CARD_BAD_CVV]) {
        const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } }, token)
        checkStatus(b.reply, 402, `Booking with ${token}`)
        checkEqual(b.reply.body?.code, 'card_declined', `Refusal code for ${token}`)
        refs.push(b.bookingId)
      }
      const { seatsTaken, bookings } = await bookingsOf(ctx, cls.id)
      checkEqual(seatsTaken[cls.sessions[0].id], 0, 'Seats taken')
      check(!bookings.some((x) => refs.includes(x.bookingId)), 'A declined booking is on the ledger')
      await checkNotCharged(ctx, scope, refs, since)
    },
  },
  {
    id: 9,
    title: 'Gift card pays',
    plan: ['book 1 with the sandbox gift card nonce', 'paid; the Square payment is on a Square gift card'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Gift card') }), sessions: ctx.slots.sessions(1) })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } }, GIFT_CARD_OK)
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000], giftCard: true })
    },
  },
  {
    id: 10,
    title: 'Refund one seat (frees it); goodwill refund keeps the seat',
    plan: [
      'book 2 at $20; refund one person: seats left +1, a Square refund of $21.80',
      'a $5 goodwill refund on the other seat: seat kept, a Square refund of $5',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Refund') }), sessions: ctx.slots.sessions(1, { capacity: 4 }) })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 2 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000, 2000] })
      checkEqual(await sessionLeft(ctx, cls.id), [2], 'Seats left before')
      const mine = (await bookingsOf(ctx, cls.id)).bookings.find((x) => x.bookingId === b.bookingId)
      const [l1, l2] = mine.lineIds as string[]

      const r1 = await refund(ctx, { classId: cls.id, bookingId: b.bookingId, kind: 'person', lineIds: [l1], attempt: `e2e-${randomUUID()}` })
      checkStatus(r1, 200, 'Refund one person')
      checkEqual(r1.body.data.cents, 2180, 'Refunded (cents)')
      checkEqual(r1.body.data.freeSeat, true, 'Seat freed')
      checkEqual(await sessionLeft(ctx, cls.id), [3], 'Seats left after the refund')
      await checkRefundInSquare(ctx, scope, r1.body.data.refundId, 2180)

      const r2 = await refund(ctx, { classId: cls.id, bookingId: b.bookingId, kind: 'custom', lineIds: [l2], cents: 500, freeSeat: false, attempt: `e2e-${randomUUID()}` })
      checkStatus(r2, 200, 'Goodwill refund')
      checkEqual(r2.body.data.cents, 500, 'Goodwill refunded (cents)')
      checkEqual(r2.body.data.freeSeat, false, 'Goodwill keeps the seat')
      checkEqual(await sessionLeft(ctx, cls.id), [3], 'Seats left after the goodwill refund')
      await checkRefundInSquare(ctx, scope, r2.body.data.refundId, 500)
      const after = (await bookingsOf(ctx, cls.id)).bookings.find((x) => x.bookingId === b.bookingId)
      checkEqual(after.refundedCents, 2680, 'Ledger refunded (cents)')
    },
  },
  {
    id: 11,
    title: 'Counter (POS) sale: reconcile adds counter seats once; naming; pick-the-day flag',
    plan: [
      'needs SQUARE_SANDBOX_ACCESS_TOKEN (skipped without it)',
      'a sandbox order of 2 × the class item, paid with the sandbox card (as the POS would)',
      'reconcile → 2 counter seats with no name; reconcile again → still 2',
      'name one seat through To decide; a pick-your-day pass sold at the counter shows in To decide and its day is set',
    ],
    async run(ctx, scope) {
      if (!ctx.square) throw new SkipScenario('needs SQUARE_SANDBOX_ACCESS_TOKEN to ring up a sandbox sale')
      const cls = await makeClass(ctx, scope, {
        content: testContent({
          name: nameOf(ctx, 'Counter sale'),
          passes: [
            { id: 'single', label: 'Both days', covers: { kind: 'all' } },
            { id: 'day', label: 'One day', covers: { kind: 'choose', count: 1 } },
          ],
          prices: { single: { person: 2000 }, day: { person: 1500 } },
        }),
        sessions: ctx.slots.sessions(2),
      })
      const sale = await counterSale(ctx, scope, [{ variationId: cls.square.variations['single:person'], qty: 2 }])
      checkEqual(sale.totalCents, totalWithTax([2000, 2000]), 'Counter sale total')
      await reconcile(ctx)
      const counter = async () => (await bookingsOf(ctx, cls.id)).bookings.filter((x) => x.source === 'pos')
      let pos = await counter()
      checkEqual(pos.length, 1, 'Counter bookings')
      checkEqual(pos[0].lineIds.length, 2, 'Counter seats')
      checkEqual(pos[0].customer, null, 'Counter seat name before naming')
      await reconcile(ctx)
      pos = await counter()
      checkEqual(pos.length === 1 ? pos[0].lineIds.length : -1, 2, 'Counter seats after a second reconcile')

      const named = await ctx.admin.post('/api/admin/to-decide.json', { action: 'names', classId: cls.id, names: [{ lineId: pos[0].lineIds[0], name: 'E2E Counter Person' }] })
      checkStatus(named, 200, 'Name a counter seat')
      checkEqual(named.body.data.named, 1, 'Seats named')
      checkEqual((await counter())[0].customer?.givenName, 'E2E', 'Counter seat name after naming')

      await counterSale(ctx, scope, [{ variationId: cls.square.variations['day:person'], qty: 1 }])
      await reconcile(ctx)
      const item = (await toDecide(ctx)).find((i) => i.kind === 'pos-needs-days' && i.classId === cls.id && !i.done)
      check(item, 'To decide has no "Counter seat needs its day" for the pick-your-day sale')
      const set = await ctx.admin.post('/api/admin/to-decide.json', { id: item.id, action: 'set-days', sessionIds: [cls.sessions[1].id] })
      checkStatus(set, 200, 'Set the day')
      const { seatsTaken } = await bookingsOf(ctx, cls.id)
      checkEqual([seatsTaken[cls.sessions[0].id], seatsTaken[cls.sessions[1].id]], [2, 3], 'Seats taken per day')
    },
  },
  {
    id: 12,
    title: 'Cancel a class: nobody refunded, off the POS',
    plan: ['book 1, cancel the class', 'class cancelled, the booking still paid with nothing refunded, link gone, Square item hidden, no refund on the payment'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Cancel') }), sessions: ctx.slots.sessions(1) })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000] })
      const { class: before } = await bookingsOf(ctx, cls.id)
      const r = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'cancel', id: cls.id, expectedUpdatedAt: before.updatedAt })
      checkStatus(r, 200, 'Cancel')
      check(!r.body.warning, `Cancel warned: ${r.body.warning}`)
      checkEqual(r.body.data.class.status, 'cancelled', 'Class status')
      checkEqual(r.body.data.booked.length, 1, 'People listed to contact')
      const mine = (await bookingsOf(ctx, cls.id)).bookings.find((x) => x.bookingId === b.bookingId)
      checkEqual([mine.state, mine.refundedCents], ['confirmed', 0], 'Booking after cancel')
      checkStatus(await ctx.pub.get(`/api/classes/${cls.id}.json`), 404, 'The class link after cancel')
      if (!ctx.square) return noSquare(scope)
      const item = await squareItem(ctx.square, cls.square.itemId)
      check(hidden(item), 'Square item is still on the POS')
      const payment = (await ctx.square.get(`/payments/${encodeURIComponent(b.reply.body.data.paymentId)}`)).payment
      check(!Number(payment.refunded_money?.amount ?? 0) && !(payment.refund_ids ?? []).length, 'The payment was refunded')
    },
  },
  {
    id: 13,
    title: 'Clashes: blocked time, Craft Café, a party',
    plan: [
      'block 4:30–6 AM on a day, schedule a class at 5 AM there: refused naming the block',
      'a class inside a Craft Café window: refused (when the café runs in the next 6 weeks)',
      'a class on a booked party (when the sandbox has one in the next 6 weeks): refused',
    ],
    async run(ctx, scope) {
      const [day] = ctx.slots.days(1)
      const reason = `E2E block ${ctx.runTag}`
      const blk = await ctx.admin.post('/api/admin/classes/blocked.json', {
        action: 'add', startIso: chicagoToUtcIso(day, '04:30'), endIso: chicagoToUtcIso(day, '06:00'), reason,
      })
      checkStatus(blk, 200, 'Block time')
      const blockId = blk.body.data.blocked.id
      scope.cleanup.add(`unblock ${blockId}`, async () => checkStatus(await ctx.admin.post('/api/admin/classes/blocked.json', { action: 'remove', id: blockId }), 200, 'Unblock'))
      const tryAt = async (startIso: string, label: string) => {
        const r = await ctx.admin.post('/api/admin/classes/classes.json', {
          action: 'create', content: testContent({ name: nameOf(ctx, `Clash ${label}`) }), status: 'draft',
          sessions: [{ startIso, endIso: new Date(Date.parse(startIso) + 30 * 60_000).toISOString(), capacity: 6 }],
        })
        if (r.status === 200) cleanUpClass(ctx, scope, r.body.data.class)
        checkStatus(r, 409, `A class over ${label}`)
        check(/^Clashes with/.test(r.body?.error ?? ''), `Clash message for ${label}: ${r.body?.error}`)
        return r.body.error as string
      }
      const msg = await tryAt(chicagoToUtcIso(day, '05:00'), 'blocked time')
      check(msg.includes(reason), `The clash message doesn't name the block: ${msg}`)

      const from = new Date().toISOString(), to = new Date(Date.now() + 44 * 86_400_000).toISOString()
      const cal = await ctx.admin.get(`/api/admin/classes/calendar.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      checkStatus(cal, 200, 'Read the calendar')
      const items: any[] = cal.body.data?.items ?? cal.body.data ?? []
      const future = (k: string) => items.find((i) => i.kind === k && Date.parse(i.startIso) > Date.now() + 60 * 60_000)
      const cafe = future('cafe')
      if (cafe) {
        const m = await tryAt(new Date(Date.parse(cafe.startIso) + 15 * 60_000).toISOString(), 'Craft Café')
        check(m.includes('Craft Café'), `The clash message doesn't name Craft Café: ${m}`)
      } else scope.note('no Craft Café window in the next 6 weeks; café clash not checked')
      const party = future('party')
      if (party) await tryAt(party.startIso, 'a party')
      else scope.note('no party booked in the sandbox in the next 6 weeks; party clash not checked (book one on the preview to cover it)')
    },
  },
  {
    id: 14,
    title: 'Link-only class: not listed, bookable by link',
    plan: ['link-only open class', 'absent from /api/workshops.json, answers at /api/classes/<id>.json, books with the sandbox card'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Link only') }), sessions: ctx.slots.sessions(1) })
      check(!(await publicList(ctx)).some((w) => w.id === cls.id), 'A link-only class is on the public list')
      checkEqual(await sessionLeft(ctx, cls.id), [6], 'Seats left by link')
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000] })
    },
  },
  {
    id: 15,
    title: 'Edit with bookings: capacity below sold refused',
    plan: ['capacity 4, book 2', 'capacity 1 refused (409, "can\'t go below 2"); capacity 2 saved'],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Capacity') }), sessions: ctx.slots.sessions(1, { capacity: 4 }) })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 2 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000, 2000] })
      const at = (capacity: number) => (cls.sessions as any[]).map((s) => ({ ...s, capacity }))
      const low = await updateClass(ctx, cls.id, { sessions: at(1) })
      checkStatus(low, 409, 'Capacity 1')
      check(/can.t go below 2/.test(low.body?.error ?? ''), `Refusal message: ${low.body?.error}`)
      const ok = await updateClass(ctx, cls.id, { sessions: at(2) })
      checkStatus(ok, 200, 'Capacity 2')
      checkEqual(ok.body.data.class.sessions[0].capacity, 2, 'Saved capacity')
    },
  },
  {
    id: 16,
    title: 'Comp and pay-at-the-counter seats from /staff',
    plan: [
      'staff comps 1 seat (a retry of it adds nothing), then sells 1 to pay at the counter',
      'ledger: a comp and a door-counter seat, no Square payment, $21.80 due at the counter; no Square order',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Staff seats') }), sessions: ctx.slots.sessions(1) })
      checkStatus(await ctx.staff.get(`/api/staff/class.json?id=${cls.id}`), 200, 'The class on /staff')
      const seat = (extra: Record<string, unknown>) => ctx.staff.post('/api/staff/comp-seat.json', {
        scheduleId: cls.id, givenName: 'E2E', familyName: 'Staff', email: ctx.person.email, phone: ctx.person.phone,
        passId: 'single', tickets: { person: 1 }, ...extra,
      })
      const attempt = `e2e-${randomUUID()}`
      const comp = await seat({ attempt })
      checkStatus(comp, 200, 'Comp a seat')
      checkEqual(comp.body.data.own, true, 'Comp went to our ledger')
      const again = await seat({ attempt })
      checkStatus(again, 200, 'Comp retried')
      checkEqual(again.body.data.replayed, true, 'Retry recognised')
      const door = await seat({ attempt: `e2e-${randomUUID()}`, payAtRegister: true })
      checkStatus(door, 200, 'Sell a seat to pay at the counter')
      checkEqual(door.body.data.dueCents, 2180, 'Due at the counter (cents)')

      const { bookings, seatsTaken } = await bookingsOf(ctx, cls.id)
      checkEqual(seatsTaken[cls.sessions[0].id], 2, 'Seats taken')
      const bySource = Object.fromEntries(bookings.map((x) => [x.source, x]))
      check(bySource.comp && bySource['door-counter'], `Ledger sources: ${bookings.map((x) => x.source).join(', ')}`)
      check(!bySource.comp.paidHere && !bySource['door-counter'].paidHere, 'A staff seat has a Square payment')
      checkEqual(bySource.comp.paidCents, 0, 'Comp paid (cents)')
      await checkNotCharged(ctx, scope, [comp.body.data.bookingId, door.body.data.bookingId], sinceNow())
    },
  },
  {
    id: 17,
    title: 'Refund again / already refunded (R29–R31)',
    plan: [
      'book 1, $3 goodwill refund; the same refund asked again (new screen) answers "Already refunded", nothing sent',
      '"Refund again" of it sends a second $3; its retry repeats the answer; a stale "Refund again" is refused (409)',
      'Square: two $3 refunds on the payment',
    ],
    async run(ctx, scope) {
      const cls = await makeClass(ctx, scope, { content: testContent({ name: nameOf(ctx, 'Refund again') }), sessions: ctx.slots.sessions(1) })
      const b = await book(ctx, cls.id, { passId: 'single', tickets: { person: 1 } })
      await checkPaid(ctx, scope, cls, b, { seatPrices: [2000] })
      const ask = { classId: cls.id, bookingId: b.bookingId, kind: 'custom', cents: 300, freeSeat: false }
      const first = await refund(ctx, { ...ask, attempt: `e2e-${randomUUID()}` })
      checkStatus(first, 200, 'First goodwill refund')
      check(!first.body.data.already, 'The first refund said "already refunded"')
      const same = await refund(ctx, { ...ask, attempt: `e2e-${randomUUID()}` })
      checkStatus(same, 200, 'Same refund again')
      const already = same.body.data.already
      check(already?.latest?.requestId, 'The repeat was not answered "Already refunded"')
      check(/^Already refunded/.test(already.message), `Message: ${already.message}`)
      const token = `e2e-${randomUUID()}`
      const again = await refund(ctx, { ...ask, attempt: `e2e-${randomUUID()}`, again: { of: already.latest.requestId, token } })
      checkStatus(again, 200, 'Refund again')
      check(again.body.data.refundId && again.body.data.refundId !== first.body.data.refundId, 'Refund again did not make a new refund')
      const retry = await refund(ctx, { ...ask, attempt: `e2e-${randomUUID()}`, again: { of: already.latest.requestId, token } })
      checkStatus(retry, 200, 'Refund again, retried')
      checkEqual(retry.body.data.refundId, again.body.data.refundId, 'Retry answers with the same refund')
      const stale = await refund(ctx, { ...ask, attempt: `e2e-${randomUUID()}`, again: { of: already.latest.requestId, token: `e2e-${randomUUID()}` } })
      checkStatus(stale, 409, 'A stale Refund again')
      const mine = (await bookingsOf(ctx, cls.id)).bookings.find((x) => x.bookingId === b.bookingId)
      checkEqual(mine.refundedCents, 600, 'Ledger refunded (cents)')
      if (!ctx.square) return noSquare(scope)
      const payment = (await ctx.square.get(`/payments/${encodeURIComponent(b.reply.body.data.paymentId)}`)).payment
      checkEqual((payment.refund_ids ?? []).length, 2, 'Square refunds on the payment')
    },
  },
  {
    id: 18,
    title: 'Bring in Square classes: dry run answers',
    plan: ['POST import-square { dryRun: true }: create, skip and addPhoto lists come back (empty is fine on the sandbox); nothing is added'],
    async run(ctx) {
      const r = await ctx.admin.post('/api/admin/classes/import-square.json', { dryRun: true })
      checkStatus(r, 200, 'Import dry run')
      for (const k of ['create', 'skip', 'addPhoto']) check(Array.isArray(r.body.data?.[k]), `Dry run has no ${k} list`)
    },
  },
  {
    id: 19,
    title: 'Closed day refuses scheduling, then settings restored',
    plan: ['add a closed day in studio settings', 'a class that day is refused ("a day the studio is closed")', 'cleanup: settings saved back as they were'],
    async run(ctx, scope) {
      const view = await ctx.admin.get('/api/admin/settings.json')
      checkStatus(view, 200, 'Read settings')
      const s = view.body.data.settings
      const [day] = ctx.slots.days(1)
      const rows = { cafeWeekly: s.cafeWeekly, cafeSpecialDays: s.cafeSpecialDays }
      const save = await ctx.admin.post('/api/admin/settings.json', {
        ...rows, closures: [...s.closures, { from: day, to: day, name: `E2E closure ${ctx.runTag}` }], expectedUpdatedAt: s.updatedAt,
      })
      checkStatus(save, 200, 'Save a closed day')
      const savedAt: string = save.body.data.settings.updatedAt
      scope.cleanup.add('restore studio settings', async () => {
        const back = await ctx.admin.post('/api/admin/settings.json', { ...rows, closures: s.closures, expectedUpdatedAt: savedAt })
        checkStatus(back, 200, 'Restore settings')
      })
      const r = await ctx.admin.post('/api/admin/classes/classes.json', {
        action: 'create', content: testContent({ name: nameOf(ctx, 'Closed day') }), status: 'draft',
        sessions: [{ startIso: chicagoToUtcIso(day, '05:00'), endIso: chicagoToUtcIso(day, '05:30'), capacity: 6 }],
      })
      if (r.status === 200) cleanUpClass(ctx, scope, r.body.data.class)
      checkStatus(r, 409, 'A class on the closed day')
      check(/closed/.test(r.body?.error ?? ''), `Message: ${r.body?.error}`)
    },
  },
  {
    id: 20,
    title: 'To decide lists a class short of its minimum',
    plan: ['open class needing 3 people, decide-by tomorrow, nobody booked', '/admin To decide lists "Short of its minimum" for it'],
    async run(ctx, scope) {
      const decideByIso = new Date(Date.now() + 24 * 3_600_000).toISOString()
      const cls = await makeClass(ctx, scope, {
        content: testContent({ name: nameOf(ctx, 'Minimum'), rules: { minimumToRun: { count: 3, decideByIso } } }),
        sessions: ctx.slots.sessions(1),
      })
      const item = (await toDecide(ctx)).find((i) => i.kind === 'below-minimum' && i.classId === cls.id)
      check(item, 'To decide has no "Short of its minimum" for the class')
      checkEqual(item.detail?.count, 3, 'Minimum on the item')
    },
  },
  {
    id: 21,
    title: 'Square: a removed price leaves the POS item (omission)',
    plan: ['class with two passes (two POS options); remove one pass (nobody booked on it)', 'the class keeps one option; the Square item has one variation, the other is gone'],
    async run(ctx, scope) {
      const content = testContent({
        name: nameOf(ctx, 'Remove option'),
        passes: [{ id: 'single', label: 'Class', covers: { kind: 'all' } }, { id: 'early', label: 'Early bird', covers: { kind: 'all' } }],
        prices: { single: { person: 2000 }, early: { person: 1800 } },
      })
      const cls = await makeClass(ctx, scope, { content, sessions: ctx.slots.sessions(1) })
      checkEqual(Object.keys(cls.square.variations).sort(), ['early:person', 'single:person'], 'POS options before')
      const dropped = cls.square.variations['early:person']
      const r = await updateClass(ctx, cls.id, { content: { ...cls.content, passes: [cls.content.passes[0]], prices: { single: { person: 2000 } } } })
      checkStatus(r, 200, 'Remove the pass')
      check(!r.body.warning, `Saved with a warning: ${r.body.warning}`)
      checkEqual(Object.keys(r.body.data.class.square.variations), ['single:person'], 'POS options after')
      if (!ctx.square) return noSquare(scope)
      const item = await squareItem(ctx.square, cls.square.itemId)
      checkEqual((item.item_data.variations as any[]).map((v) => v.id), [cls.square.variations['single:person']], 'Square variations')
      let gone = false
      try {
        const v = await squareItem(ctx.square, dropped)
        gone = !!v?.is_deleted
      } catch (e: any) {
        gone = e?.status === 404
      }
      check(gone, `The removed Square variation ${dropped} is still there`)
    },
  },
  {
    id: 22,
    title: 'Square: cancel hides the whole item and keeps its details',
    plan: ['needs SQUARE_SANDBOX_ACCESS_TOKEN', 'cancel a class: the item and every variation present nowhere; name, description, prices, category and tax unchanged; a second cancel is fine'],
    async run(ctx, scope) {
      if (!ctx.square) throw new SkipScenario('needs SQUARE_SANDBOX_ACCESS_TOKEN to read the POS item')
      const cls = await makeClass(ctx, scope, {
        content: testContent({
          name: nameOf(ctx, 'Hide on cancel'),
          ticketTypes: [{ id: 'adult', label: 'Adult' }, { id: 'kid', label: 'Kid' }],
          prices: { single: { adult: 2000, kid: 1500 } },
        }),
        sessions: ctx.slots.sessions(1),
      })
      const before = await squareItem(ctx.square, cls.square.itemId)
      await cancelClass(ctx, cls.id)
      const after = await squareItem(ctx.square, cls.square.itemId)
      check(hidden(after), 'Square item is still on the POS')
      for (const v of after.item_data.variations) check(hidden(v), `Square variation ${v.id} is still on the POS`)
      const keep = (o: any) => ({
        name: o.item_data.name, description: o.item_data.description ?? '', category: o.item_data.categories?.map((c: any) => c.id) ?? [],
        tax: o.item_data.tax_ids ?? [], prices: (o.item_data.variations as any[]).map((v) => [v.id, Number(v.item_variation_data.price_money?.amount)]),
      })
      checkEqual(keep(after), keep(before), 'Item details after cancel')
      const { class: now } = await bookingsOf(ctx, cls.id)
      const again = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'cancel', id: cls.id, expectedUpdatedAt: now.updatedAt })
      checkStatus(again, 200, 'Cancel again')
      check(!again.body.warning, `Cancel again warned: ${again.body.warning}`)
    },
  },
  {
    id: 23,
    title: 'Create retried: one class, one POS item',
    plan: ['the same create (same createKey) sent twice at once, then once more', 'one class id, the repeats say replay; Square has one item for the class'],
    async run(ctx, scope) {
      const createKey = `e2e-${randomUUID()}`
      const body = { action: 'create', content: testContent({ name: nameOf(ctx, 'Create retry') }), sessions: ctx.slots.sessions(1), status: 'open', createKey }
      const [a, b] = await Promise.all([ctx.admin.post('/api/admin/classes/classes.json', body), ctx.admin.post('/api/admin/classes/classes.json', body)])
      for (const r of [a, b]) if (r.status === 200) cleanUpClass(ctx, scope, r.body.data.class)
      checkStatus(a, 200, 'Create (first of two)')
      checkStatus(b, 200, 'Create (second of two)')
      const c = await ctx.admin.post('/api/admin/classes/classes.json', body)
      checkStatus(c, 200, 'Create (third)')
      const ids = new Set([a, b, c].map((r) => r.body.data.class.id))
      checkEqual(ids.size, 1, 'Distinct classes made')
      checkEqual(c.body.data.replay, true, 'The third create is a replay')
      check([a, b].some((r) => r.body.data.replay === true), 'Neither concurrent create was a replay')
      const cls = c.body.data.class
      check(cls.square.itemId, 'The class has no POS item')
      if (!ctx.square) return noSquare(scope)
      const found = await ctx.square.post('/catalog/search', {
        object_types: ['ITEM_VARIATION'], include_deleted_objects: false,
        query: { exact_query: { attribute_name: 'sku', attribute_value: cls.id } },
      })
      const items = new Set((found.objects ?? []).map((v: any) => v.item_variation_data?.item_id))
      checkEqual([...items], [cls.square.itemId], 'Square items for the class')
    },
  },
]

/** The studio days a test class must not use: owners' closed days and café days. */
export function blockedDay(settings: any): (ymd: string) => boolean {
  const closures: { from: string; to: string }[] = settings?.closures ?? []
  const cafeDays = new Set<string>((settings?.cafeWeekly ?? []).map((w: any) => w.weekday))
  const special = new Set<string>((settings?.cafeSpecialDays ?? []).map((d: any) => d.date))
  return (ymd) => closures.some((c) => ymd >= c.from && ymd <= c.to) || cafeDays.has(weekdayOf(ymd)) || special.has(ymd)
}

/** Where a run's classes start: 90 to 300 days out, a different stretch each run, so leftovers from a broken run never clash. */
export function firstDay(now: Date, random = Math.random()): string {
  return addDays(chicagoDate(now), 90 + Math.floor(random * 210))
}

// ── After a run stopped part way ───────────────────────────────────────────

/** What --cleanup-only does (also printed by --cleanup-only --dry-run). */
export const CLEANUP_PLAN = [
  'cancel every class whose name starts "E2E " that is not cancelled yet (cancelling never refunds anyone)',
  'archive every library class whose name starts "E2E "',
  'remove blocked time whose reason starts "E2E block"',
  'remove closed days named "E2E closure …" from the studio settings',
]

const isTestName = (name: unknown) => typeof name === 'string' && name.startsWith('E2E ')

/** Finds what earlier runs left behind on the preview and clears it. Only ever touches "E2E …" things. */
export async function cleanUpLeftovers(ctx: Pick<Ctx, 'admin'>, log: (line: string) => void): Promise<{ done: string[]; failed: string[] }> {
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

  const classes = await ctx.admin.get('/api/admin/classes/classes.json')
  checkStatus(classes, 200, 'List classes')
  for (const c of (classes.body.data.classes as any[]).filter((x) => isTestName(x.content?.name) && x.status !== 'cancelled')) {
    await step(`cancel ${c.content.name} (${c.id})`, async () => {
      const r = await ctx.admin.post('/api/admin/classes/classes.json', { action: 'cancel', id: c.id, expectedUpdatedAt: c.updatedAt })
      checkStatus(r, 200, 'Cancel')
    })
  }

  const lib = await ctx.admin.get('/api/admin/classes/library.json')
  checkStatus(lib, 200, 'List the library')
  for (const l of (lib.body.data.library as any[]).filter((x) => !x.archived && isTestName(x.versions?.[x.versions.length - 1]?.content?.name))) {
    await step(`archive library ${l.versions[l.versions.length - 1].content.name} (${l.id})`, async () => {
      checkStatus(await ctx.admin.post('/api/admin/classes/library.json', { action: 'archive', id: l.id }), 200, 'Archive')
    })
  }

  const blocked = await ctx.admin.get('/api/admin/classes/blocked.json')
  checkStatus(blocked, 200, 'List blocked time')
  for (const b of (blocked.body.data.blocked as any[]).filter((x) => typeof x.reason === 'string' && x.reason.startsWith('E2E block'))) {
    await step(`unblock ${b.reason} (${b.id})`, async () => {
      checkStatus(await ctx.admin.post('/api/admin/classes/blocked.json', { action: 'remove', id: b.id }), 200, 'Unblock')
    })
  }

  const view = await ctx.admin.get('/api/admin/settings.json')
  checkStatus(view, 200, 'Read settings')
  const s = view.body.data.settings
  const keep = (s.closures as any[]).filter((c) => !(typeof c.name === 'string' && c.name.startsWith('E2E closure')))
  if (keep.length !== s.closures.length) {
    await step(`remove ${s.closures.length - keep.length} "E2E closure" day(s) from the settings`, async () => {
      const r = await ctx.admin.post('/api/admin/settings.json', {
        cafeWeekly: s.cafeWeekly, cafeSpecialDays: s.cafeSpecialDays, closures: keep, expectedUpdatedAt: s.updatedAt,
      })
      checkStatus(r, 200, 'Save settings')
    })
  }
  return { done, failed }
}
