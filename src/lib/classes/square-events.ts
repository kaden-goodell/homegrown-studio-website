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
 * - A Square refund on one of our payments: one our own refund flow already
 *   recorded → ignored; itemized returns → those seats refunded and freed;
 *   a plain amount refund → a 'refund-flags' entry for a person, seats
 *   untouched; a refund we recorded that later FAILED/REJECTED → a
 *   'refund-failed' flag (never undone automatically).
 * Nothing here cancels or refunds anything. Never throws to the caller.
 */
import { makeKvStore } from '@lib/blob-store'
import { createLogger } from '@lib/logger'
import type { By } from '@lib/staff-auth'
import { listClasses } from './class-store'
import { classIdFromVariation } from './square-catalog'
import { squareFetch, squareSettings } from './square-api'
import { getLedger, recordPos, recordRefund, type LedgerLine, type PosLineInput } from './seat-ledger'
import { onSeatFreed } from './refunds'
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
}
export type RefundFlagKind = 'plain-refund' | 'refund-failed'
export type RefundFlagAction = 'freed-seat' | 'kept-seat' | 'dismissed'
export interface RefundFlag {
  id: string
  kind: RefundFlagKind
  classId: string
  bookingId: string
  paymentId: string
  squareRefundId: string
  cents: Cents
  /** Square's status for the refund (COMPLETED, FAILED, REJECTED) */
  status: string
  at: string
  resolved: { at: string; by: By; action: RefundFlagAction } | null
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

/** Of these variation ids, the ones that are class items (Classes category, or sku 'cls_…'). */
async function classLike(variationIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!variationIds.length) return out
  const categoryId = squareSettings().classesCategoryId || ''
  try {
    const res = await squareFetch('/catalog/batch-retrieve', {
      method: 'POST',
      body: JSON.stringify({ object_ids: variationIds, include_related_objects: true }),
    })
    const items = new Map<string, any>([...(res?.objects ?? []), ...(res?.related_objects ?? [])]
      .filter((o: any) => o?.type === 'ITEM').map((o: any) => [o.id, o]))
    for (const v of res?.objects ?? []) {
      if (v?.type !== 'ITEM_VARIATION') continue
      const sku = String(v.item_variation_data?.sku ?? '')
      const item = items.get(v.item_variation_data?.item_id)
      const cats = [
        ...(item?.item_data?.categories ?? []).map((c: any) => c?.id),
        item?.item_data?.category_id,
        item?.item_data?.reporting_category?.id,
      ].filter(Boolean)
      if (sku.startsWith('cls_') || (categoryId && cats.includes(categoryId))) out.add(v.id)
    }
  } catch (e) {
    logger.warn('Catalog lookup for unmatched lines failed', { error: e instanceof Error ? e.message : String(e) })
  }
  return out
}

/**
 * Puts a paid order's class seats on the ledger. `hint` comes from a
 * payment event (the payment is COMPLETED, and its id). Safe to run again.
 */
export async function handleOrder(
  order: any,
  now: Date,
  opts: { classes?: ScheduledClass[]; paymentCompleted?: boolean; paymentId?: string } = {},
): Promise<SaleOutcome> {
  const orderId = String(order?.id ?? '')
  const out: SaleOutcome = { orderId, recorded: 0, unmatched: 0 }
  const loc = squareSettings().locationId || ''
  if (loc && order?.location_id && order.location_id !== loc) return { ...out, skipped: 'other-location' }
  if (String(order?.reference_id ?? '').startsWith('bkg_')) return { ...out, skipped: 'not-ours' }
  const paid = order?.state === 'COMPLETED' || (order?.state === 'OPEN' && (opts.paymentCompleted || (await anyTenderCompleted(order))))
  if (!paid) return { ...out, skipped: 'not-paid' }

  const lineItems: any[] = (order.line_items ?? []).filter((li: any) => li?.catalog_object_id && li?.uid)
  if (!lineItems.length) return { ...out, skipped: 'no-class-lines' }
  const classes = opts.classes ?? (await listClasses())
  const saleIso = order.closed_at ?? order.updated_at ?? order.created_at ?? now.toISOString()
  const tender = (order.tenders ?? [])[0]
  const paymentId: string | null = opts.paymentId ?? tender?.payment_id ?? tender?.id ?? null

  const perClass = new Map<string, { cls: ScheduledClass; lines: (PosLineInput & { needsDays: boolean })[]; charged: Cents }>()
  const unknown: any[] = []
  for (const li of lineItems) {
    const qty = Math.floor(Number(li.quantity))
    if (!Number.isFinite(qty) || qty < 1) continue
    const m = classIdFromVariation(li.catalog_object_id, classes)
    if (!m) { unknown.push(li); continue }
    if (m.key.startsWith('addon:')) {
      logger.info('POS add-on line not attached to a seat', { orderId, lineUid: li.uid, classId: m.classId, key: m.key })
      continue
    }
    const cls = classes.find((c) => c.id === m.classId)!
    const [passId, ticketTypeId] = m.key.split(':')
    const sess = sessionsFor(cls, passId, saleIso)
    if (!sess || !sess.sessionIds.length) {
      await storeUnmatched(orderId, li, now)
      out.unmatched++
      continue
    }
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

  if (unknown.length) {
    const ours = await classLike([...new Set(unknown.map((li) => li.catalog_object_id as string))])
    for (const li of unknown) {
      if (!ours.has(li.catalog_object_id)) continue
      await storeUnmatched(orderId, li, now)
      out.unmatched++
    }
  }

  for (const { cls, lines, charged } of perClass.values()) {
    // Belt and braces: an order already on this class's ledger from our own flow is ours.
    const ledger = await getLedger(cls.id)
    if (ledger.lines.some((l) => l.square.orderId === orderId && l.source !== 'pos')) {
      out.skipped = 'not-ours'
      continue
    }
    const bookingId = `bkg_pos_${safeKey(orderId)}`
    const added = await recordPos(cls, { bookingId, orderId, paymentId, chargedCents: charged, lines }, now)
    out.recorded += added.length
    for (const pl of lines.filter((x) => x.needsDays)) {
      const mine = added.filter((l) => l.square.lineUid === pl.lineUid)
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
  | { action: 'ignored'; why: 'not-ours' | 'already-recorded' | 'pending' | 'not-class-items' }
  | { action: 'freed'; lineIds: string[] }
  | { action: 'flagged'; kind: RefundFlagKind }

interface PaidLine { classId: string; line: LedgerLine }

async function linesForPayment(paymentId: string): Promise<PaidLine[]> {
  const out: PaidLine[] = []
  for (const c of await listClasses()) {
    const ledger = await getLedger(c.id)
    for (const l of ledger.lines) if (l.square.paymentId === paymentId) out.push({ classId: c.id, line: l })
  }
  return out
}

const paidOn = (l: LedgerLine) => l.priceCents + l.taxCents + l.addOnCents + l.addOnTaxCents
const leftOn = (l: LedgerLine) => paidOn(l) - l.refunds.reduce((s, r) => s + r.cents, 0)
const holdsSeat = (l: LedgerLine) => (l.state === 'confirmed' || l.state === 'refunded') && !l.refunds.some((r) => r.freedSeat)

async function flag(kind: RefundFlagKind, refund: any, hit: PaidLine, now: Date): Promise<RefundOutcome> {
  const id = `flag-${kind}-${safeKey(String(refund.id))}`
  const entry: RefundFlag = {
    id, kind, classId: hit.classId, bookingId: hit.line.bookingId, paymentId: String(refund.payment_id),
    squareRefundId: String(refund.id), cents: money(refund.amount_money), status: String(refund.status ?? ''),
    at: now.toISOString(), resolved: null,
  }
  if (await putOnce(flagsKv, id, entry)) logger.warn('Square refund needs a person', { kind, refundId: refund.id, bookingId: entry.bookingId })
  return { action: 'flagged', kind }
}

/**
 * A refund made in Square (webhook payload's `refund`). `order` may be given
 * when already in hand; else the refund's order is fetched for its returns.
 */
export async function handleRefund(refund: any, now: Date, opts: { order?: any } = {}): Promise<RefundOutcome> {
  const paymentId = refund?.payment_id
  if (!paymentId || !refund?.id) return { action: 'ignored', why: 'not-ours' }
  const hits = await linesForPayment(paymentId)
  if (!hits.length) return { action: 'ignored', why: 'not-ours' }
  const known = hits.some((h) => h.line.refunds.some((r) => r.squareRefundId === refund.id))
  const status = String(refund.status ?? '')

  if (status === 'FAILED' || status === 'REJECTED') {
    if (!known) return { action: 'ignored', why: 'pending' }
    const hit = hits.find((h) => h.line.refunds.some((r) => r.squareRefundId === refund.id))!
    return flag('refund-failed', refund, hit, now)
  }
  if (status !== 'COMPLETED') return { action: 'ignored', why: 'pending' }
  if (known) return { action: 'ignored', why: 'already-recorded' }

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
  if (!returnLines.length) return flag('plain-refund', refund, hits[0], now)

  const classes = await listClasses()
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
      const m = classIdFromVariation(rli.catalog_object_id, classes)
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
  if (!chosen.size) return flag('plain-refund', refund, hits[0], now)

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
    logger.error('Square event not processed', { type, eventId: event?.event_id, error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

export interface ReconcileResult { orders: number; recorded: number; unmatched: number; errors: number }

/** Every COMPLETED order at our location updated in the last 48 hours, through the sale handler. Idempotent. */
export async function reconcileClasses(now = new Date()): Promise<ReconcileResult> {
  const loc = squareSettings().locationId || ''
  if (!loc) throw new Error('The Square location is not set up.')
  const classes = await listClasses()
  const result: ReconcileResult = { orders: 0, recorded: 0, unmatched: 0, errors: 0 }
  let cursor: string | undefined
  for (let page = 0; page < 50; page++) {
    const res = await squareFetch('/orders/search', {
      method: 'POST',
      body: JSON.stringify({
        location_ids: [loc],
        limit: 500,
        ...(cursor ? { cursor } : {}),
        query: {
          filter: {
            state_filter: { states: ['COMPLETED'] },
            date_time_filter: { updated_at: { start_at: new Date(now.getTime() - 48 * 3_600_000).toISOString(), end_at: now.toISOString() } },
          },
          sort: { sort_field: 'UPDATED_AT', sort_order: 'ASC' },
        },
      }),
    })
    for (const order of res?.orders ?? []) {
      result.orders++
      try {
        const o = await handleOrder(order, now, { classes })
        result.recorded += o.recorded
        result.unmatched += o.unmatched
      } catch (e) {
        result.errors++
        logger.error('Reconcile could not record an order', { orderId: order?.id, error: e instanceof Error ? e.message : String(e) })
      }
    }
    cursor = res?.cursor
    if (!cursor) break
  }
  return result
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
  return (await readAll<PosNeedsDays>(needsDaysKv, 'days-')).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Refunds made in Square that a person has to decide on, newest first. A
 * plain refund that our own refund flow has since recorded (the webhook beat
 * the save) is left out.
 */
export async function listRefundFlags(opts: { includeResolved?: boolean } = {}): Promise<RefundFlag[]> {
  const all = await readAll<RefundFlag>(flagsKv, 'flag-')
  const ledgers = new Map<string, LedgerLine[]>()
  const out: RefundFlag[] = []
  for (const f of all) {
    if (f.resolved && !opts.includeResolved) continue
    if (f.kind === 'plain-refund') {
      if (!ledgers.has(f.classId)) ledgers.set(f.classId, (await getLedger(f.classId)).lines)
      if (ledgers.get(f.classId)!.some((l) => l.refunds.some((r) => r.squareRefundId === f.squareRefundId))) continue
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
