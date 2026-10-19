/**
 * Square → our seat ledger. Counter (POS) sales of our class items and
 * refunds made in Square reach the ledger here, from the webhook
 * (src/pages/api/webhooks/square.json.ts) and the nightly reconcile
 * (src/pages/api/jobs/reconcile-classes.json.ts).
 *
 * Rules:
 * - A paid order (COMPLETED, or OPEN with a COMPLETED payment) at our location
 *   whose lines are our class seat variations → one confirmed 'pos' line per
 *   unit, no name yet, capacity ignored. Orders with reference_id 'bkg_…' are
 *   our own online/door bookings (already on the ledger) and are skipped.
 *   Replays never add a seat twice (order id + line uid + unit).
 * - A 'choose' pass sold at the counter can't know its days: it is put on the
 *   next upcoming session(s) and listed in 'pos-needs-days' for staff.
 * - A class item we can't match (Classes category, or sku 'cls_…') → kv
 *   'unmatched-pos'. Add-on lines attach to nothing (logged).
 * - A Square refund on one of our payments (any of the order's tenders): one
 *   our own refund flow already recorded → ignored; itemized returns → those
 *   seats refunded and freed; a plain amount refund → recorded at once as
 *   money (seat kept), spread over the payment's seats in seat order, class
 *   by class, each capped at what it has left, and a 'refund-flags' entry per
 *   class asks a person whether to free a seat; a refund we recorded that
 *   later FAILED/REJECTED → a 'refund-failed' flag (never undone automatically).
 * - The nightly reconcile runs every order (COMPLETED or OPEN) and every
 *   refund of the last 48 hours through the same handlers. Catalog lookups
 *   for items that aren't ours are batched: one call per run.
 * Nothing here cancels or refunds anything. Never throws to the caller.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import { recordAudit } from '@lib/audit'
import type { By } from '@lib/staff-auth'
import { listClasses } from './class-store'
import { squareFetch, squareSettings } from './square-api'
import { getLedger, moveLines, paidBy, recordPos, recordRefund, type LedgerLine, type PosLineInput } from './seat-ledger'
import { bookingCap, claimSquareRefund, freeSeatOnly, onSeatFreed } from './refunds'
import { allRefundRequests, listRefundRequests, UNCONFIRMED_AFTER_MS, type SavedRefundRequest } from './refund-requests'
import { getClass } from './class-store'
import type { Cents, ScheduledClass, Session } from './types'

const logger = createLogger('classes:square-events')

/** Who a ledger change made from Square is recorded as. */
export const SQUARE_BY: By = { id: 'square', name: 'Square' }

const unmatchedKv = makeKvStore('unmatched-pos', 'unmatched-pos')
const needsDaysKv = makeKvStore('pos-needs-days', 'pos-needs-days')
const flagsKv = makeKvStore('refund-flags', 'refund-flags')
const ATTEMPTS = 3

export interface UnmatchedPos { orderId: string; lineUid: string; name: string; qty: number; at: string }
export interface PosNeedsDays {
  id: string; classId: string; bookingId: string; lineIds: string[]; orderId: string; lineUid: string
  passId: string; sessionIds: string[]; at: string
  /** set once a person picked the days (setPosDays) */
  resolved?: { at: string; by: By; sessionIds: string[] } | null
}
/**
 * refund-unconfirmed: one of our refunds was saved and sent, but Square never showed it within 24 h.
 * refund-unfinished: a person said "It went through" and the money was saved, but the request was never marked done.
 */
export type RefundFlagKind = 'plain-refund' | 'refund-failed' | 'refund-unconfirmed' | 'refund-unfinished'
export type RefundFlagAction = 'freed-seat' | 'kept-seat' | 'dismissed'
export interface RefundFlag {
  id: string
  kind: RefundFlagKind
  classId: string
  bookingId: string
  paymentId: string
  squareRefundId: string
  /** plain-refund: what was recorded on this class's seats; refund-failed: the refund's amount */
  cents: Cents
  /** the whole Square refund (it may be spread over several classes) */
  refundCents?: Cents
  /** Square's status for the refund (COMPLETED, FAILED, REJECTED) */
  status: string
  at: string
  resolved: { at: string; by: By; action: RefundFlagAction } | null
  /** refund-unconfirmed: our saved request */
  requestId?: string
}

const money = (m: any): Cents => (Number.isFinite(Number(m?.amount)) ? Number(m.amount) : 0)

/** Splits `total` into `n` whole-cent parts, the odd cents on the first parts. */
export function splitCents(total: Cents, n: number): Cents[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  const extra = total - base * n
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0))
}

const safeKey = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')

async function putOnce(kv: ReturnType<typeof makeKvStore>, key: string, value: unknown): Promise<boolean> {
  if (await kv.get(key)) return false
  await kv.set(key, JSON.stringify(value))
  return true
}

// ---------------------------------------------------------------- sales

export interface SaleOutcome {
  orderId: string
  skipped?: 'not-ours' | 'other-location' | 'not-paid' | 'no-class-lines'
  /** ledger lines added this time */
  recorded: number
  unmatched: number
}

/** The sessions a counter seat on `passId` covers, and whether staff must pick the days. */
function sessionsFor(cls: ScheduledClass, passId: string, saleIso: string): { sessionIds: string[]; needsDays: boolean } | null {
  const pass = cls.content.passes.find((p) => p.id === passId)
  if (!pass) return null
  const sorted = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
  const sale = Date.parse(saleIso)
  const last = (): Session[] => sorted.slice(-1)
  switch (pass.covers.kind) {
    case 'all':
      return { sessionIds: sorted.map((s) => s.id), needsDays: false }
    case 'fixed': {
      const ids = (pass.covers as { sessionIds: string[] }).sessionIds.filter((id) => sorted.some((s) => s.id === id))
      return { sessionIds: ids.length ? ids : sorted.map((s) => s.id), needsDays: !ids.length }
    }
    case 'remaining': {
      const ahead = sorted.filter((s) => Date.parse(s.startIso) > sale)
      return ahead.length ? { sessionIds: ahead.map((s) => s.id), needsDays: false } : { sessionIds: last().map((s) => s.id), needsDays: true }
    }
    case 'choose': {
      const count = Math.max(1, (pass.covers as { count: number }).count)
      const upcoming = sorted.filter((s) => Date.parse(s.endIso) > sale)
      const pick = (upcoming.length ? upcoming : last()).slice(0, count)
      return { sessionIds: pick.map((s) => s.id), needsDays: true }
    }
  }
}

/** True when any payment on the order's tenders is COMPLETED. */
async function anyTenderCompleted(order: any): Promise<boolean> {
  for (const t of order.tenders ?? []) {
    const id = t.payment_id ?? t.id
    if (!id) continue
    try {
      const res = await squareFetch(`/payments/${encodeURIComponent(id)}`, { method: 'GET' })
      if (res?.payment?.status === 'COMPLETED') return true
    } catch (e) {
      logger.warn('Payment lookup failed', { paymentId: id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return false
}

/** Square's BatchRetrieveCatalogObjects takes at most 1000 ids. */
const CATALOG_BATCH = 1000
const CACHE_MS = 60 * 60_000

/**
 * Remembers, per catalog variation id, whether it is a class item (Classes
 * category, or sku 'cls_…'). Unknown ids are fetched with one
 * BatchRetrieveCatalogObjects call per 1000. A failed lookup is not
 * remembered, so it is asked again next time.
 */
export class CatalogCache {
  private known = new Map<string, boolean>()
  private failed = new Set<string>()
  /** rememberFailures: a lookup that failed is not tried again by this cache (one reconcile run) */
  constructor(private readonly opts: { rememberFailures?: boolean } = {}, private readonly bornAt = Date.now()) {}
  get age(): number { return Date.now() - this.bornAt }

  /** Looks up every id not yet known. Never throws. */
  async prefetch(variationIds: Iterable<string>): Promise<void> {
    const todo = [...new Set(variationIds)].filter((id) => id && !this.known.has(id) && !this.failed.has(id))
    if (!todo.length) return
    const categoryId = squareSettings().classesCategoryId || ''
    for (let i = 0; i < todo.length; i += CATALOG_BATCH) {
      const ids = todo.slice(i, i + CATALOG_BATCH)
      try {
        const res = await squareFetch('/catalog/batch-retrieve', {
          method: 'POST',
          body: JSON.stringify({ object_ids: ids, include_related_objects: true }),
        })
        const items = new Map<string, any>([...(res?.objects ?? []), ...(res?.related_objects ?? [])]
          .filter((o: any) => o?.type === 'ITEM').map((o: any) => [o.id, o]))
        for (const id of ids) this.known.set(id, false) // not found = not a class item
        for (const v of res?.objects ?? []) {
          if (v?.type !== 'ITEM_VARIATION') continue
          const sku = String(v.item_variation_data?.sku ?? '')
          const item = items.get(v.item_variation_data?.item_id)
          const cats = [
            ...(item?.item_data?.categories ?? []).map((c: any) => c?.id),
            item?.item_data?.category_id,
            item?.item_data?.reporting_category?.id,
          ].filter(Boolean)
          this.known.set(v.id, sku.startsWith('cls_') || (!!categoryId && cats.includes(categoryId)))
        }
      } catch (e) {
        if (this.opts.rememberFailures) for (const id of ids) this.failed.add(id) // next run asks again
        logger.warn('Catalog lookup for unmatched lines failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  /** Of these ids, the ones that are class items (looked up first when not known). */
  async classLike(variationIds: string[]): Promise<Set<string>> {
    await this.prefetch(variationIds)
    return new Set(variationIds.filter((id) => this.known.get(id) === true))
  }
}

// The webhook's cache lives as long as the server instance, renewed hourly.
let webhookCache = new CatalogCache()
function sharedCache(): CatalogCache {
  if (webhookCache.age > CACHE_MS) webhookCache = new CatalogCache()
  return webhookCache
}
/** Forget every remembered catalog answer (tests). */
export function resetCatalogCache(): void { webhookCache = new CatalogCache() }

/** catalog variation id → our class and key, built once per run. */
type VariationIndex = Map<string, { classId: string; key: string }>
function indexVariations(classes: ScheduledClass[]): VariationIndex {
  const out: VariationIndex = new Map()
  for (const c of classes) for (const [key, id] of Object.entries(c.square?.variations ?? {})) if (id && !out.has(id)) out.set(id, { classId: c.id, key })
  return out
}

/** What a run shares between orders and refunds: one classes read, one variation index, one catalog cache. */
export interface RunContext {
  classes: ScheduledClass[]
  index: VariationIndex
  catalog: CatalogCache
  /** reconcile only: payment id → the classes holding seats paid by it */
  payments?: Map<string, Set<string>>
}
function contextFor(classes: ScheduledClass[], catalog: CatalogCache = sharedCache()): RunContext {
  return { classes, index: indexVariations(classes), catalog }
}

/** Every payment id on the order's tenders. */
function tenderPaymentIds(order: any): string[] {
  return [...new Set<string>((order?.tenders ?? []).map((t: any) => t?.payment_id ?? t?.id).filter((x: unknown): x is string => typeof x === 'string' && !!x))]
}

/**
 * Puts a paid order's class seats on the ledger. `hint` comes from a
 * payment event (the payment is COMPLETED, and its id). Safe to run again.
 * Lines only count once the order is paid: COMPLETED, or OPEN with a
 * COMPLETED payment on one of its tenders.
 */
export async function handleOrder(
  order: any,
  now: Date,
  opts: { classes?: ScheduledClass[]; ctx?: RunContext; paymentCompleted?: boolean; paymentId?: string } = {},
): Promise<SaleOutcome> {
  const orderId = String(order?.id ?? '')
  const out: SaleOutcome = { orderId, recorded: 0, unmatched: 0 }
  const loc = squareSettings().locationId || ''
  if (loc && order?.location_id && order.location_id !== loc) return { ...out, skipped: 'other-location' }
  if (String(order?.reference_id ?? '').startsWith('bkg_')) return { ...out, skipped: 'not-ours' }
  if (order?.state !== 'COMPLETED' && order?.state !== 'OPEN') return { ...out, skipped: 'not-paid' }

  const lineItems: any[] = (order.line_items ?? []).filter((li: any) => li?.catalog_object_id && li?.uid)
  if (!lineItems.length) return { ...out, skipped: 'no-class-lines' }
  const ctx = opts.ctx ?? contextFor(opts.classes ?? (await listClasses()))
  const saleIso = order.closed_at ?? order.updated_at ?? order.created_at ?? now.toISOString()
  const paymentIds = tenderPaymentIds(order)
  if (opts.paymentId && !paymentIds.includes(opts.paymentId)) paymentIds.unshift(opts.paymentId)
  const paymentId: string | null = opts.paymentId ?? paymentIds[0] ?? null

  // Sort the lines first (no writes), so an unpaid order costs no payment lookups unless it has class lines.
  const perClass = new Map<string, { cls: ScheduledClass; lines: (PosLineInput & { needsDays: boolean })[]; charged: Cents }>()
  const noSession: any[] = []
  const unknown: any[] = []
  for (const li of lineItems) {
    const qty = Math.floor(Number(li.quantity))
    if (!Number.isFinite(qty) || qty < 1) continue
    const m = ctx.index.get(li.catalog_object_id)
    if (!m) { unknown.push(li); continue }
    if (m.key.startsWith('addon:')) {
      logger.info('POS add-on line not attached to a seat', { orderId, lineUid: li.uid, classId: m.classId, key: m.key })
      continue
    }
    const cls = ctx.classes.find((c) => c.id === m.classId)!
    const [passId, ticketTypeId] = m.key.split(':')
    const sess = sessionsFor(cls, passId, saleIso)
    if (!sess || !sess.sessionIds.length) { noSession.push(li); continue }
    const total = money(li.total_money)
    const tax = money(li.total_tax_money)
    const prices = splitCents(total - tax, qty)
    const taxes = splitCents(tax, qty)
    const entry = perClass.get(cls.id) ?? { cls, lines: [], charged: 0 }
    entry.lines.push({
      lineUid: li.uid, passId, ticketTypeId, sessionIds: sess.sessionIds, needsDays: sess.needsDays,
      units: prices.map((p, i) => ({ priceCents: p, taxCents: taxes[i] })),
    })
    entry.charged += total
    perClass.set(cls.id, entry)
  }
  const ours = unknown.length ? await ctx.catalog.classLike([...new Set(unknown.map((li) => li.catalog_object_id as string))]) : new Set<string>()
  const unmatched = [...noSession, ...unknown.filter((li) => ours.has(li.catalog_object_id))]
  if (!perClass.size && !unmatched.length) return { ...out, skipped: 'no-class-lines' }

  const paid = order.state === 'COMPLETED' || opts.paymentCompleted || (await anyTenderCompleted(order))
  if (!paid) return { ...out, skipped: 'not-paid' }

  for (const li of unmatched) {
    await storeUnmatched(orderId, li, now)
    out.unmatched++
  }

  for (const { cls, lines, charged } of perClass.values()) {
    // Belt and braces: an order already on this class's ledger from our own flow is ours.
    const ledger = await getLedger(cls.id)
    if (ledger.lines.some((l) => l.square.orderId === orderId && l.source !== 'pos')) {
      out.skipped = 'not-ours'
      continue
    }
    const bookingId = `bkg_pos_${safeKey(orderId)}`
    const added = await recordPos(cls, { bookingId, orderId, paymentId, paymentIds, chargedCents: charged, lines }, now)
    out.recorded += added.length
    for (const pl of lines.filter((x) => x.needsDays)) {
      // A door seat paid at the counter already has its days.
      const mine = added.filter((l) => l.square.lineUid === pl.lineUid && l.source === 'pos')
      if (!mine.length) continue
      const id = `days-${safeKey(orderId)}-${safeKey(pl.lineUid)}-${mine[0].seat}`
      await putOnce(needsDaysKv, id, {
        id, classId: cls.id, bookingId, lineIds: mine.map((l) => l.id), orderId, lineUid: pl.lineUid,
        passId: pl.passId, sessionIds: pl.sessionIds, at: now.toISOString(),
      } satisfies PosNeedsDays)
    }
    if (added.length) logger.info('POS sale recorded', { orderId, classId: cls.id, seats: added.length })
  }
  return out
}

async function storeUnmatched(orderId: string, li: any, now: Date): Promise<void> {
  const name = [li.name, li.variation_name].filter(Boolean).join(' · ') || 'Unnamed item'
  const entry: UnmatchedPos = { orderId, lineUid: String(li.uid), name, qty: Math.floor(Number(li.quantity)) || 0, at: now.toISOString() }
  if (await putOnce(unmatchedKv, `unmatched-${safeKey(orderId)}-${safeKey(String(li.uid))}`, entry)) {
    logger.warn('POS class sale matches no class', { orderId, lineUid: li.uid, name })
  }
}

/** Fetches the order and runs handleOrder on it. */
export async function handleOrderById(orderId: string, now: Date, opts: { paymentCompleted?: boolean; paymentId?: string } = {}): Promise<SaleOutcome> {
  const res = await squareFetch(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' })
  if (!res?.order) return { orderId, recorded: 0, unmatched: 0, skipped: 'no-class-lines' }
  return handleOrder(res.order, now, opts)
}

// ---------------------------------------------------------------- refunds

export type RefundOutcome =
  | { action: 'ignored'; why: 'not-ours' | 'already-recorded' | 'pending' | 'not-class-items' | 'ours' }
  | { action: 'freed'; lineIds: string[] }
  | { action: 'flagged'; kind: RefundFlagKind; recordedCents?: Cents }

interface PaidLine { classId: string; line: LedgerLine }

/** Every ledger line paid by this payment, class by class in `classIds` order. */
async function linesForPayment(paymentId: string, classIds: string[]): Promise<PaidLine[]> {
  const out: PaidLine[] = []
  for (const id of classIds) {
    const ledger = await getLedger(id)
    for (const l of ledger.lines) if (paidBy(l, paymentId)) out.push({ classId: id, line: l })
  }
  return out
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
const leftOn = (l: LedgerLine) => paidOn(l) - l.refunds.reduce((s, r) => s + r.cents, 0)
const isPaid = (l: LedgerLine) => l.state === 'confirmed' || l.state === 'refunded'
const holdsSeat = (l: LedgerLine) => isPaid(l) && !l.refunds.some((r) => r.freedSeat)
const bySquare = (r: LedgerLine['refunds'][number]) => r.by?.id === SQUARE_BY.id

async function flag(kind: RefundFlagKind, refund: any, hit: PaidLine, now: Date, extra: { cents?: Cents } = {}): Promise<void> {
  // A plain refund is asked about per class (one payment can cover several); a failure once per refund.
  const id = kind === 'plain-refund'
    ? `flag-${kind}-${safeKey(String(refund.id))}-${safeKey(hit.classId)}`
    : `flag-${kind}-${safeKey(String(refund.id))}`
  const entry: RefundFlag = {
    id, kind, classId: hit.classId, bookingId: hit.line.bookingId, paymentId: String(refund.payment_id),
    squareRefundId: String(refund.id), cents: extra.cents ?? money(refund.amount_money), refundCents: money(refund.amount_money),
    status: String(refund.status ?? ''), at: now.toISOString(), resolved: null,
  }
  if (await putOnce(flagsKv, id, entry)) logger.warn('Square refund needs a person', { kind, refundId: refund.id, classId: hit.classId, bookingId: entry.bookingId })
}

/**
 * A plain amount refund made in Square: recorded now as money (seats kept),
 * spread over the payment's seats in seat order, class by class, each capped
 * at what that seat and its booking have left; then one "Free a seat?" flag
 * per class. Idempotent by the Square refund id: a class already carrying it
 * is not written again, and only what is still unrecorded is spread.
 */
async function recordPlainRefund(refund: any, hits: PaidLine[], now: Date): Promise<RefundOutcome> {
  const refundId = String(refund.id)
  const total = money(refund.amount_money)
  const carries = (l: LedgerLine) => l.refunds.some((r) => r.squareRefundId === refundId)
  const already = hits.reduce((s, h) => s + h.line.refunds.filter((r) => r.squareRefundId === refundId).reduce((a, r) => a + r.cents, 0), 0)
  let rest = Math.max(0, total - already)
  const classIds = [...new Set(hits.map((h) => h.classId))]
  const onClass = new Map<string, Cents>()
  for (const classId of classIds) {
    const mine = hits.filter((h) => h.classId === classId)
    if (mine.some((h) => carries(h.line))) {
      onClass.set(classId, mine.reduce((s, h) => s + h.line.refunds.filter((r) => r.squareRefundId === refundId).reduce((a, r) => a + r.cents, 0), 0))
      continue
    }
    const cents: Record<string, Cents> = {}
    const bookings = [...new Set(mine.map((h) => h.line.bookingId))]
    for (const bookingId of bookings) {
      const booking = mine.filter((h) => h.line.bookingId === bookingId).map((h) => h.line)
      let room = bookingCap(booking) ?? Infinity
      for (const l of booking.filter(isPaid).sort((a, b) => a.seat - b.seat)) {
        const c = Math.max(0, Math.min(rest, leftOn(l), room))
        if (c > 0) { cents[l.id] = c; rest -= c; room -= c }
      }
    }
    const ids = Object.keys(cents)
    if (ids.length) {
      await recordRefund(classId, ids, { cents, reason: 'Refunded in Square (amount only)', by: SQUARE_BY, freeSeat: false, squareRefundId: refundId })
    }
    onClass.set(classId, ids.reduce((s, id) => s + cents[id], 0))
  }
  if (rest > 0) logger.warn('Square refund is more than the seats on it have left', { refundId, unrecordedCents: rest })
  for (const classId of classIds) {
    await flag('plain-refund', refund, hits.find((h) => h.classId === classId)!, now, { cents: onClass.get(classId) ?? 0 })
  }
  const recordedCents = [...onClass.values()].reduce((s, c) => s + c, 0)
  logger.info('Square plain refund recorded', { refundId, recordedCents, classes: classIds.length })
  return { action: 'flagged', kind: 'plain-refund', recordedCents }
}

/**
 * A refund made in Square (webhook payload's `refund`, or one row of
 * ListPaymentRefunds). `order` may be given when already in hand; else the
 * refund's order is fetched for its returns.
 */
export async function handleRefund(refund: any, now: Date, opts: { order?: any; ctx?: RunContext } = {}): Promise<RefundOutcome> {
  const paymentId = refund?.payment_id
  if (!paymentId || !refund?.id) return { action: 'ignored', why: 'not-ours' }
  const ctx = opts.ctx ?? contextFor(await listClasses())
  // In a reconcile run the payment index says which classes to read; otherwise read them all.
  const classIds = ctx.payments ? [...(ctx.payments.get(paymentId) ?? [])] : ctx.classes.map((c) => c.id)
  if (!classIds.length) return { action: 'ignored', why: 'not-ours' }
  const hits = await linesForPayment(paymentId, classIds)
  if (!hits.length) return { action: 'ignored', why: 'not-ours' }
  const entries = hits.flatMap((h) => h.line.refunds.filter((r) => r.squareRefundId === refund.id))
  const status = String(refund.status ?? '')

  if (status === 'FAILED' || status === 'REJECTED') {
    if (!entries.length) return { action: 'ignored', why: 'pending' }
    const hit = hits.find((h) => h.line.refunds.some((r) => r.squareRefundId === refund.id))!
    await flag('refund-failed', refund, hit, now)
    return { action: 'flagged', kind: 'refund-failed' }
  }
  if (status !== 'COMPLETED') return { action: 'ignored', why: 'pending' }
  const bookings = [...new Map(hits.map((h) => [`${h.classId}|${h.line.bookingId}`, {
    classId: h.classId, bookingId: h.line.bookingId, label: ctx.classes.find((c) => c.id === h.classId)?.content.name,
  }])).values()]
  const asClaimed = { id: String(refund.id), paymentId, cents: money(refund.amount_money) }
  if (entries.length) {
    // A plain refund recorded from Square: finish any class a crash left out (no-op otherwise).
    if (entries.every((r) => bySquare(r) && !r.freedSeat)) {
      await recordPlainRefund(refund, hits, now)
      return { action: 'ignored', why: 'already-recorded' }
    }
    // One of ours whose money is written but whose request may not be marked done (a failure in between):
    // finish it. Matched only by this refund's id or the request id on the ledger, never by amount.
    const requestIds = [...new Set(entries.map((r) => r.requestId).filter((x): x is string => !!x))]
    if (await claimSquareRefund(asClaimed, bookings, { requestIds, exactOnly: true })) return { action: 'ignored', why: 'ours' }
    return { action: 'ignored', why: 'already-recorded' }
  }

  // One of our own saved refund requests (its save here hasn't happened yet): saved as that request, nothing of Square's.
  if (await claimSquareRefund(asClaimed, bookings)) {
    logger.info('Square refund is one of ours, saved as asked', { refundId: refund.id })
    return { action: 'ignored', why: 'ours' }
  }

  let order = opts.order
  if (!order && refund.order_id) {
    try {
      order = (await squareFetch(`/orders/${encodeURIComponent(refund.order_id)}`, { method: 'GET' }))?.order
    } catch (e) {
      logger.warn('Refund order lookup failed', { refundId: refund.id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  const returns: any[] = order?.returns ?? []
  const returnLines = returns.flatMap((r) => (r.return_line_items ?? []).map((rli: any) => ({ rli, sourceOrderId: r.source_order_id as string | undefined })))
  if (!returnLines.length) return recordPlainRefund(refund, hits, now)

  const chosen = new Map<string, { classId: string; cents: Cents }>() // line id → refund
  let aboutClasses = false
  for (const { rli, sourceOrderId } of returnLines) {
    const qty = Math.floor(Number(rli.quantity))
    if (!Number.isFinite(qty) || qty < 1) continue
    const free = (h: PaidLine) => holdsSeat(h.line) && !chosen.has(h.line.id)
    let pool = hits.filter((h) => h.line.square.lineUid && h.line.square.lineUid === rli.source_line_item_uid
      && (!sourceOrderId || h.line.square.orderId === sourceOrderId))
    if (pool.length) aboutClasses = true
    if (!pool.length && rli.catalog_object_id) {
      // Our online bookings carry no Square line uid: match by the class variation instead.
      const m = ctx.index.get(rli.catalog_object_id)
      if (m && !m.key.startsWith('addon:')) {
        aboutClasses = true
        const [passId, ticketTypeId] = m.key.split(':')
        pool = hits.filter((h) => h.classId === m.classId && h.line.passId === passId && h.line.ticketTypeId === ticketTypeId)
      }
    }
    const pick = pool.filter(free).sort((a, b) => a.line.seat - b.line.seat).slice(0, qty)
    const cents = splitCents(money(rli.total_money), qty)
    pick.forEach((h, i) => chosen.set(h.line.id, { classId: h.classId, cents: Math.max(0, Math.min(cents[i] ?? 0, leftOn(h.line))) }))
  }
  if (!aboutClasses) return { action: 'ignored', why: 'not-class-items' }
  if (!chosen.size) return recordPlainRefund(refund, hits, now)

  const byClass = new Map<string, Record<string, Cents>>()
  for (const [lineId, { classId, cents }] of chosen) byClass.set(classId, { ...(byClass.get(classId) ?? {}), [lineId]: cents })
  const freed: string[] = []
  for (const [classId, cents] of byClass) {
    const lines = await recordRefund(classId, Object.keys(cents), {
      cents, reason: 'Refunded in Square', by: SQUARE_BY, freeSeat: true, squareRefundId: String(refund.id),
    })
    freed.push(...Object.keys(cents))
    await onSeatFreed(classId, [...new Set(lines.flatMap((l) => l.sessionIds))]).catch(() => undefined)
  }
  logger.info('Square return freed seats', { refundId: refund.id, seats: freed.length })
  return { action: 'freed', lineIds: freed }
}

// ---------------------------------------------------------------- webhook + reconcile

const ORDER_EVENTS = new Set(['order.created', 'order.updated'])
const PAYMENT_EVENTS = new Set(['payment.created', 'payment.updated'])
const REFUND_EVENTS = new Set(['refund.created', 'refund.updated'])
export const CLASS_EVENTS = new Set([...ORDER_EVENTS, ...PAYMENT_EVENTS, ...REFUND_EVENTS])

/** One webhook event. Logs and swallows every error: Square must always get its 200. */
export async function handleSquareEvent(event: any, now = new Date()): Promise<SaleOutcome | RefundOutcome | null> {
  const type = String(event?.type ?? '')
  try {
    const obj = event?.data?.object ?? {}
    if (ORDER_EVENTS.has(type)) {
      const orderId = event?.data?.id ?? obj.order_created?.order_id ?? obj.order_updated?.order_id
      if (!orderId) return null
      const state = obj.order_created?.state ?? obj.order_updated?.state
      // DRAFT/CANCELED orders never hold a sale; OPEN may (paid, not yet closed).
      if (state && state !== 'COMPLETED' && state !== 'OPEN') return null
      return await handleOrderById(orderId, now)
    }
    if (PAYMENT_EVENTS.has(type)) {
      const p = obj.payment
      if (p?.status !== 'COMPLETED' || !p?.order_id) return null
      return await handleOrderById(p.order_id, now, { paymentCompleted: true, paymentId: p.id })
    }
    if (REFUND_EVENTS.has(type)) {
      return obj.refund ? await handleRefund(obj.refund, now) : null
    }
    return null
  } catch (e) {
    // Ids and the type only: the event can hold customer details.
    logger.error('Square event not processed', { type, eventId: event?.event_id, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

export interface ReconcileResult {
  orders: number; recorded: number; unmatched: number
  /** refunds listed by Square for the window, and how many changed or flagged something here */
  refunds: number; refundsHandled: number
  /** our saved refunds Square never showed within 24 h, flagged for the owners (never retried) */
  staleRequests: number
  errors: number
}

const MAX_PAGES = 50

/**
 * The safety net for missed webhooks. Every order at our location updated in
 * the last 48 hours (COMPLETED, or OPEN with a completed payment) through the
 * sale handler, then every refund made in those 48 hours (ListPaymentRefunds)
 * through the refund handler. Both are idempotent (order id + line uid + unit;
 * Square refund id). Catalog lookups for items that aren't ours: one batched
 * call for the whole run.
 */
export async function reconcileClasses(now = new Date()): Promise<ReconcileResult> {
  const loc = squareSettings().locationId || ''
  if (!loc) throw new Error('The Square location is not set up.')
  const ctx = contextFor(await listClasses(), new CatalogCache({ rememberFailures: true }))
  const result: ReconcileResult = { orders: 0, recorded: 0, unmatched: 0, refunds: 0, refundsHandled: 0, staleRequests: 0, errors: 0 }
  const since = new Date(now.getTime() - 48 * 3_600_000).toISOString()

  // 1. Every order first, so the catalog is asked once about every item that isn't ours.
  const orders: any[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await squareFetch('/orders/search', {
      method: 'POST',
      body: JSON.stringify({
        location_ids: [loc],
        limit: 500,
        ...(cursor ? { cursor } : {}),
        query: {
          filter: {
            state_filter: { states: ['COMPLETED', 'OPEN'] },
            date_time_filter: { updated_at: { start_at: since, end_at: now.toISOString() } },
          },
          sort: { sort_field: 'UPDATED_AT', sort_order: 'ASC' },
        },
      }),
    })
    orders.push(...(res?.orders ?? []))
    cursor = res?.cursor
    if (!cursor) break
  }
  await ctx.catalog.prefetch(orders.flatMap((o) => (o?.line_items ?? [])
    .map((li: any) => li?.catalog_object_id as string | undefined)
    .filter((id: string | undefined): id is string => !!id && !ctx.index.has(id))))
  for (const order of orders) {
    result.orders++
    try {
      const o = await handleOrder(order, now, { ctx })
      result.recorded += o.recorded
      result.unmatched += o.unmatched
    } catch (e) {
      result.errors++
      logger.error('Reconcile could not record an order', { orderId: order?.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // 2. Refunds. Which classes each payment touched, read once (after the sales above landed).
  const payments = new Map<string, Set<string>>()
  for (const c of ctx.classes) {
    for (const l of (await getLedger(c.id)).lines) {
      for (const id of [l.square.paymentId, ...(l.square.paymentIds ?? [])]) {
        if (!id) continue
        payments.set(id, (payments.get(id) ?? new Set()).add(c.id))
      }
    }
  }
  const refundCtx: RunContext = { ...ctx, payments }
  cursor = undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const q: URLSearchParams = new URLSearchParams({ begin_time: since, location_id: loc, ...(cursor ? { cursor } : {}) })
    const res: any = await squareFetch(`/refunds?${q.toString()}`, { method: 'GET' })
    for (const refund of res?.refunds ?? []) {
      result.refunds++
      try {
        const r = await handleRefund(refund, now, { ctx: refundCtx })
        if (r.action !== 'ignored') result.refundsHandled++
      } catch (e) {
        result.errors++
        logger.error('Reconcile could not handle a refund', { refundId: refund?.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    cursor = res?.cursor
    if (!cursor) break
  }

  // 3. Our own refunds saved and sent but never seen at Square: shown to the owners, never sent again.
  try {
    result.staleRequests = await flagUnconfirmedRequests(now)
  } catch (e) {
    result.errors++
    logger.error('Reconcile could not check saved refunds', { error: e instanceof Error ? e.message : String(e) })
  }
  return result
}

/** "It went through" was saved but the request never marked done, this long ago (not a check still running). */
const UNFINISHED_AFTER_MS = 10 * 60_000
const checkedButUnfinished = (r: SavedRefundRequest) => r.status === 'sent' && !r.squareRefundId && r.cleared?.outcome === 'went-through'

/**
 * Flags every saved refund still pending (no Square refund id) after 24
 * hours, and every "It went through" left half-finished. Returns how many are open.
 */
export async function flagUnconfirmedRequests(now: Date): Promise<number> {
  let open = 0
  for (const r of await allRefundRequests()) {
    if (checkedButUnfinished(r) && now.getTime() - Date.parse(r.cleared!.at) >= UNFINISHED_AFTER_MS) {
      open++
      const id = `flag-refund-unfinished-${safeKey(r.id)}`
      const entry: RefundFlag = {
        id, kind: 'refund-unfinished', classId: r.classId, bookingId: r.bookingId, paymentId: r.paymentId, squareRefundId: '',
        cents: r.totalCents, refundCents: r.totalCents, status: 'sent', at: now.toISOString(), resolved: null, requestId: r.id,
      }
      if (await putOnce(flagsKv, id, entry)) logger.warn('A refund checked in Square was saved but never finished', { classId: r.classId, bookingId: r.bookingId })
      continue
    }
    if (r.status !== 'pending' || r.squareRefundId || now.getTime() - Date.parse(r.createdAt) < UNCONFIRMED_AFTER_MS) continue
    open++
    const id = `flag-refund-unconfirmed-${safeKey(r.id)}`
    const entry: RefundFlag = {
      id, kind: 'refund-unconfirmed', classId: r.classId, bookingId: r.bookingId, paymentId: r.paymentId, squareRefundId: '',
      cents: r.totalCents, refundCents: r.totalCents, status: 'pending', at: now.toISOString(), resolved: null, requestId: r.id,
    }
    if (await putOnce(flagsKv, id, entry)) logger.warn('A refund we sent was never confirmed by Square', { classId: r.classId, bookingId: r.bookingId })
  }
  return open
}

// ---------------------------------------------------------------- readers (Task 14 shows these)

async function readAll<T>(kv: ReturnType<typeof makeKvStore>, prefix: string): Promise<T[]> {
  const keys = (await kv.list()).filter((k) => k.startsWith(prefix))
  const jsons = await Promise.all(keys.map((k) => kv.get(k)))
  return jsons.filter((j): j is string => !!j).map((j) => JSON.parse(j) as T)
}

/** Counter sales of class items that match no class, newest first. */
export async function listUnmatchedPos(): Promise<UnmatchedPos[]> {
  return (await readAll<UnmatchedPos>(unmatchedKv, 'unmatched-')).sort((a, b) => b.at.localeCompare(a.at))
}

/** Counter sales of a pick-your-days pass, put on the next session(s) until staff set the days. */
export async function listPosNeedsDays(): Promise<PosNeedsDays[]> {
  return (await readAll<PosNeedsDays>(needsDaysKv, 'days-')).filter((p) => !p.resolved).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Refunds made in Square that a person has to decide on, newest first. Only
 * refunds made in Square itself: a plain-refund flag whose refund our own
 * flow recorded (by a person, not SQUARE_BY: the webhook beat the save) is
 * left out.
 */
export async function listRefundFlags(opts: { includeResolved?: boolean } = {}): Promise<RefundFlag[]> {
  const all = await readAll<RefundFlag>(flagsKv, 'flag-')
  const ledgers = new Map<string, LedgerLine[]>()
  const out: RefundFlag[] = []
  for (const f of all) {
    if (f.resolved && !opts.includeResolved) continue
    if (f.kind === 'refund-unconfirmed') {
      // Gone once that request is settled (a retry went through, or Square turned it down).
      const req = (await listRefundRequests(f.classId, f.bookingId)).find((r) => r.id === f.requestId)
      if (!req || req.status !== 'pending' || req.squareRefundId) continue
    }
    if (f.kind === 'refund-unfinished') {
      // Gone once that request is finished (the same check again, or a refund retry).
      const req = (await listRefundRequests(f.classId, f.bookingId)).find((r) => r.id === f.requestId)
      if (!req || !checkedButUnfinished(req)) continue
    }
    if (f.kind === 'plain-refund') {
      if (!ledgers.has(f.classId)) ledgers.set(f.classId, (await getLedger(f.classId)).lines)
      if (ledgers.get(f.classId)!.some((l) => l.refunds.some((r) => r.squareRefundId === f.squareRefundId && !bySquare(r)))) continue
    }
    out.push(f)
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Marks a flag decided. Records the decision only: freeing the seat itself is
 * done with the usual "free their seat" action (refunds.freeSeatOnly).
 */
export async function resolveRefundFlag(id: string, by: By, action: RefundFlagAction): Promise<RefundFlag> {
  if (!['freed-seat', 'kept-seat', 'dismissed'].includes(action)) throw new Error('Pick what was done about this refund.')
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await flagsKv.getWithMeta(id)
    if (!value) throw new Error('That refund note is no longer there.')
    const cur = JSON.parse(value) as RefundFlag
    if (cur.resolved) return cur
    const next: RefundFlag = { ...cur, resolved: { at: new Date().toISOString(), by, action } }
    if (await flagsKv.setIfMatch(id, JSON.stringify(next), etag, true)) return next
  }
  throw new Error('Concurrent update — please retry')
}

/**
 * A person says which day(s) a counter seat of a pick-your-days pass is for
 * (R27): its seats move to those sessions and it leaves the list. Refused when
 * the count doesn't match the pass or a day isn't part of the class.
 */
export async function setPosDays(id: string, sessionIds: string[], actor: { by: By; role: 'owner' | 'crew' }, now = new Date()): Promise<PosNeedsDays> {
  const by = actor.by
  const raw = await needsDaysKv.get(id)
  if (!raw) throw new Error('That counter sale is no longer waiting for its days.')
  const entry = JSON.parse(raw) as PosNeedsDays
  if (entry.resolved) return entry
  const cls = await getClass(entry.classId)
  if (!cls) throw new Error('That class no longer exists.')
  const pass = cls.content.passes.find((p) => p.id === entry.passId)
  const ids = [...new Set(sessionIds)]
  const count = pass?.covers.kind === 'choose' ? pass.covers.count : ids.length
  if (ids.length !== count) throw new Error(count === 1 ? 'Pick 1 day.' : `Pick ${count} days.`)
  await moveLines(cls, entry.lineIds, ids, now)
  const next: PosNeedsDays = { ...entry, resolved: { at: now.toISOString(), by, sessionIds: ids } }
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const { value, etag } = await needsDaysKv.getWithMeta(id)
    if (!value) break
    if ((JSON.parse(value) as PosNeedsDays).resolved) return JSON.parse(value)
    if (await needsDaysKv.setIfMatch(id, JSON.stringify(next), etag, true)) break
  }
  await recordAudit({
    by: { ...by, role: actor.role }, action: 'class-pos-days', target: { kind: 'class', id: cls.id, label: cls.content.name },
    details: { orderId: entry.orderId, lines: entry.lineIds.join(','), sessions: ids.join(',') },
  }).catch(() => undefined)
  return next
}

/**
 * Decides a refund flag (R27). 'freed-seat' frees the seats picked (or the
 * booking's only seat still held), with no money (refunds.freeSeatOnly), then
 * records the decision; 'kept-seat' and 'dismissed' only record it. Deciding twice changes
 * nothing.
 */
export async function decideRefundFlag(
  id: string, action: RefundFlagAction, actor: { by: By; role: 'owner' | 'crew' }, lineIds: string[] = [],
): Promise<RefundFlag> {
  const raw = await flagsKv.get(id)
  if (!raw) throw new Error('That refund note is no longer there.')
  const flag = JSON.parse(raw) as RefundFlag
  if (flag.resolved) return flag
  if (action === 'freed-seat') {
    if (!lineIds.length) {
      // Never guess which person: with more than one seat still held, a person picks.
      const holding = (await getLedger(flag.classId)).lines.filter((l) =>
        l.bookingId === flag.bookingId && (l.state === 'confirmed' || l.state === 'refunded') && !l.refunds.some((r) => r.freedSeat))
      if (holding.length > 1) throw new Error('Pick which seat to free.')
    }
    try {
      await freeSeatOnly(flag.classId, flag.bookingId, lineIds, actor, 'Refunded in Square')
    } catch (e) {
      // Already free is fine: the decision still stands.
      if (!(e instanceof Error) || !/already free/i.test(e.message)) throw e
    }
  }
  return resolveRefundFlag(id, actor.by, action)
}
