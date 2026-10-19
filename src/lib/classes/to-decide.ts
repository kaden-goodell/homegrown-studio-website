/**
 * /admin › To decide: things that happened in Square (or at the door)
 * without the owners, each waiting for one of them to pick what it means.
 * Nothing here ever cancels, refunds or charges anything on its own; each
 * decision is one owner's tap, recorded (who, when, what) in the audit log
 * and in a small "decided" store so the item reads "Done · …" afterwards.
 *
 *   pos-unmatched        a counter sale of a class item matched no class
 *                        → Match to a class (seats as a counter sale) · Not for a class
 *   refund-plain         a refund made in Square: → Keep their seat · Free a seat
 *   refund-failed        Square couldn't finish one of our refunds → Mark as handled
 *   refund-unfinished    "It went through" was saved but never finished → Finish it
 *   refund-unconfirmed   our refund got no answer from Square in 24 h
 *                        → It went through · It didn't go through
 *   pos-needs-days       a counter seat of a pick-your-days pass → pick the day(s)
 *   below-minimum        short of its minimum within 3 days of its decide-by
 *                        → Keep it running · Text the people booked
 *   door-unpaid          a pay-at-the-counter seat never rung up
 *                        → Mark paid at the counter · Free the seat
 *   counter-match-check  a counter sale matched one of several unpaid door seats
 *                        → Yes, it was them · it was someone else (the payment moves)
 *
 * The decisions reuse the setters the rest of the system uses: setPosDays,
 * decideRefundFlag, clearRefundRequest, freeSeatOnly, recordPos, setNames,
 * markCounterMatchChecked. Server only.
 */
import { createHash } from 'node:crypto'
import { makeKvStore } from '@lib/blob-store'
import { recordAudit } from '@lib/audit'
import type { By } from '@lib/staff-auth'
import { studioDate } from '@lib/studio-time'
import { getClass, listClasses } from './class-store'
import { listCounterMatchChecks, listDoorUnpaid } from './door-unpaid'
import { clearRefundRequest, freeSeatOnly, RefundError } from './refunds'
import { listRefundRequests } from './refund-requests'
import {
  decideRefundFlag, listPosNeedsDays, listRefundFlags, listUnmatchedPos, setPosDays, splitCents, type RefundFlag,
} from './square-events'
import { squareFetch } from './square-api'
import {
  getLedger, markCounterMatchChecked, markDoorPaid, moveCounterPayment, recordPos, seatsTaken, setNames, unpaidDoorSeat, type LedgerLine,
} from './seat-ledger'
import { onStaffConsole } from './staff-view'
import type { Cents, ScheduledClass } from './types'

const decidedKv = makeKvStore('to-decide', 'to-decide')

export type ToDecideKind =
  | 'pos-unmatched' | 'refund-plain' | 'refund-failed' | 'refund-unfinished' | 'refund-unconfirmed'
  | 'pos-needs-days' | 'below-minimum' | 'door-unpaid' | 'counter-match-check'

/** One thing waiting for an owner (or decided lately). */
export interface ToDecideItem {
  id: string
  kind: ToDecideKind
  /** "Counter sale to match", "Refund done in Square", "Short of its minimum" */
  title: string
  /** One line of what happened. */
  head: string
  /** What to do next ("Match it to a class"). */
  hint: string
  /** When it happened (ISO), for ordering. */
  at: string
  classId?: string
  className?: string
  /** What the sheet needs to show it (per kind). */
  detail: Record<string, unknown>
  /** Once decided: what was done, by whom, when. */
  done?: string
  doneBy?: string
  doneAt?: string
}

export interface Decided { id: string; kind: ToDecideKind; title: string; head: string; classId?: string; className?: string; what: string; by: By; at: string }

export class DecideError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

/** How long a decided item still shows as "Done". */
export const DONE_SHOWN_DAYS = 14
/** Below-minimum shows from this long before its decide-by. */
export const MINIMUM_AHEAD_MS = 3 * 86_400_000

const money = (c: Cents) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`
const dayText = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')
const whenText = (iso: string) => {
  const day = dayText(studioDate(iso))
  const time = new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(':00', '')
  return `${day} ${time}`
}
const seatsText = (n: number) => (n === 1 ? '1 seat' : `${n} seats`)
const safeKey = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
const personName = (c: LedgerLine['customer']) => (c ? `${c.givenName} ${c.familyName}`.trim() : '')

/** An id the /admin address bar can carry (plain, at most 110 characters). */
export function tokenOf(raw: string): string {
  return /^[A-Za-z0-9._-]{1,110}$/.test(raw) ? raw : `h${createHash('sha1').update(raw).digest('hex').slice(0, 24)}`
}

// ---------------------------------------------------------------- decided store

/** Every decision on file (each item once), and their ids: a decided item never shows as waiting again. */
async function listDecided(): Promise<{ all: Decided[]; ids: Set<string> }> {
  const keys = (await decidedKv.list()).filter((k) => k.startsWith('done-'))
  const all = (await Promise.all(keys.map((k) => decidedKv.get(k)))).filter((j): j is string => !!j).map((j) => JSON.parse(j) as Decided)
  return { all, ids: new Set(keys.map((k) => k.slice(5))) }
}

// ---------------------------------------------------------------- reading

type ClassCache = Map<string, ScheduledClass | null>
async function classOf(cache: ClassCache, id: string): Promise<ScheduledClass | null> {
  if (!cache.has(id)) cache.set(id, await getClass(id).catch(() => null))
  return cache.get(id) ?? null
}

/** The class whose name is in the counter item's name, if exactly one is coming up (a guess to start the picker on). */
function guessClass(name: string, classes: ScheduledClass[]): string | null {
  const n = name.toLowerCase()
  const hits = classes.filter((c) => c.status !== 'cancelled' && n.includes(c.content.name.toLowerCase()))
  return hits.length === 1 ? hits[0].id : null
}

async function unmatchedItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const list = await listUnmatchedPos()
  if (!list.length) return []
  const classes = await listClasses({ fromIso: new Date(now.getTime() - 60 * 86_400_000).toISOString(), toIso: new Date(now.getTime() + 400 * 86_400_000).toISOString() })
  return list
    .map((u): ToDecideItem => ({
      id: tokenOf(`pos-${safeKey(u.orderId)}-${safeKey(u.lineUid)}`),
      kind: 'pos-unmatched',
      title: 'Counter sale to match',
      head: `${u.qty} × ${u.name} rung up at the counter, ${whenText(u.at)}`,
      hint: 'Match it to a class',
      at: u.at,
      detail: { orderId: u.orderId, lineUid: u.lineUid, name: u.name, qty: u.qty, at: u.at, guessClassId: guessClass(u.name, classes) },
    }))
    .filter((i) => !skip.has(i.id))
}

const REFUND_KIND: Record<RefundFlag['kind'], ToDecideKind> = {
  'plain-refund': 'refund-plain', 'refund-failed': 'refund-failed', 'refund-unfinished': 'refund-unfinished', 'refund-unconfirmed': 'refund-unconfirmed',
}

async function refundItems(cache: ClassCache, skip: Set<string>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const f of await listRefundFlags()) {
    const id = tokenOf(f.id)
    if (skip.has(id)) continue
    const cls = await classOf(cache, f.classId)
    const className = cls?.content.name ?? 'A class'
    const lines = (await getLedger(f.classId)).lines.filter((l) => l.bookingId === f.bookingId)
    const name = personName(lines.find((l) => l.customer)?.customer ?? null) || 'Someone'
    const held = lines.filter((l) => (l.state === 'confirmed' || l.state === 'refunded') && !l.refunds.some((r) => r.freedSeat))
    const ticket = (tid: string) => cls?.content.ticketTypes.find((t) => t.id === tid)?.label ?? 'Seat'
    const first = cls ? [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0] : undefined
    const amount = money(f.refundCents ?? f.cents)
    const kind = REFUND_KIND[f.kind]
    const base = {
      id, kind, at: f.at, classId: f.classId, className,
      detail: {
        flagId: f.id, bookingId: f.bookingId, name, cents: f.cents, refundCents: f.refundCents ?? f.cents, requestId: f.requestId ?? null,
        seats: held.map((l) => ({ lineId: l.id, seat: l.seat, label: ticket(l.ticketTypeId) })), firstStartIso: first?.startIso ?? null,
      },
    }
    switch (f.kind) {
      case 'plain-refund':
        out.push({ ...base, title: 'Refund done in Square', head: `${amount} refunded in Square on ${name}’s booking (${className}). Free a seat?`, hint: 'Free a seat or keep it' })
        break
      case 'refund-failed':
        out.push({ ...base, title: 'Refund didn’t go through', head: `Square couldn’t finish a ${amount} refund for ${name} (${className}).`, hint: 'Check it in Square' })
        break
      case 'refund-unfinished':
        out.push({ ...base, title: 'Refund half finished', head: `A ${amount} refund for ${name} (${className}) was checked in Square but never finished here.`, hint: 'Finish it' })
        break
      case 'refund-unconfirmed':
        out.push({ ...base, title: 'Refund with no answer', head: `A ${amount} refund for ${name} (${className}) got no answer from Square for a day.`, hint: 'Check Square, then say what you saw' })
        break
    }
  }
  return out
}

async function needsDaysItems(cache: ClassCache, skip: Set<string>): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const d of await listPosNeedsDays()) {
    const id = tokenOf(d.id)
    if (skip.has(id)) continue
    const cls = await classOf(cache, d.classId)
    if (!cls) continue
    const pass = cls.content.passes.find((p) => p.id === d.passId)
    const count = pass?.covers.kind === 'choose' ? pass.covers.count : null
    out.push({
      id, kind: 'pos-needs-days', title: 'Counter seat needs its day', at: d.at, classId: cls.id, className: cls.content.name,
      head: `${seatsText(d.lineIds.length)} of ${cls.content.name} rung up ${whenText(d.at)}: which ${count && count > 1 ? `${count} days` : 'day'}?`,
      hint: count && count > 1 ? `Pick ${count} days` : 'Pick the day',
      detail: {
        needsId: d.id, lineIds: d.lineIds, count, passLabel: pass?.label ?? '', current: d.sessionIds,
        sessions: [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso)).map((s) => ({ id: s.id, startIso: s.startIso, endIso: s.endIso })),
      },
    })
  }
  return out
}

async function minimumItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const classes = (await listClasses({ fromIso: now.toISOString(), toIso: new Date(now.getTime() + 400 * 86_400_000).toISOString() }))
    .filter((c) => c.content.rules.minimumToRun && onStaffConsole(c))
  const out: ToDecideItem[] = []
  for (const cls of classes) {
    const min = cls.content.rules.minimumToRun!
    const first = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))[0]
    if (!first || Date.parse(first.startIso) <= now.getTime()) continue
    if (now.getTime() < Date.parse(min.decideByIso) - MINIMUM_AHEAD_MS) continue
    const booked = seatsTaken(await getLedger(cls.id), first.id, now)
    if (booked >= min.count) continue
    const id = tokenOf(`min-${cls.id}`)
    if (skip.has(id)) continue
    out.push({
      id, kind: 'below-minimum', title: 'Short of its minimum', at: min.decideByIso, classId: cls.id, className: cls.content.name,
      head: `${cls.content.name}: ${booked} of ${min.count} needed by ${whenText(min.decideByIso)}`,
      hint: 'Keep it running, or text the people booked',
      detail: { booked, count: min.count, decideByIso: min.decideByIso, firstStartIso: first.startIso },
    })
  }
  return out
}

async function doorItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  return (await listDoorUnpaid(now))
    .map((u): ToDecideItem => ({
      id: tokenOf(u.id), kind: 'door-unpaid', title: 'Not paid at the counter', at: u.sessionStartIso, classId: u.classId, className: u.className,
      head: `${u.name || 'A door seat'} · ${seatsText(u.seats)} · ${u.className} · ${dayText(u.day)}: never rung up`,
      hint: 'Mark it paid, or free the seat',
      detail: { bookingId: u.bookingId, lineIds: u.lineIds, name: u.name, day: u.day, seats: u.seats },
    }))
    .filter((i) => !skip.has(i.id))
}

async function matchItems(skip: Set<string>, now: Date): Promise<ToDecideItem[]> {
  const out: ToDecideItem[] = []
  for (const m of await listCounterMatchChecks(now)) {
    const id = tokenOf(m.id)
    if (skip.has(id)) continue
    const ledger = await getLedger(m.classId)
    const line = ledger.lines.find((l) => l.id === m.lineId)
    // The other unpaid door seats that day, same way to book and ticket: who else it could have been.
    const others = line ? ledger.lines.filter((l) => unpaidDoorSeat(l) && l.id !== line.id && l.bookingId !== line.bookingId
      && l.passId === line.passId && l.ticketTypeId === line.ticketTypeId && studioDate(l.at) === m.day) : []
    out.push({
      id, kind: 'counter-match-check', title: 'Check a counter sale', at: m.at, classId: m.classId, className: m.className,
      head: `A counter sale of ${m.className} on ${dayText(m.day)} was matched to ${m.name}. Was it them?`,
      hint: 'Say who it was',
      detail: {
        lineId: m.lineId, name: m.name, day: m.day,
        others: others.map((l) => ({ lineId: l.id, name: personName(l.customer) || 'A door seat', seat: l.seat })),
      },
    })
  }
  return out
}

/**
 * Everything waiting, newest first, then what was decided in the last two
 * weeks. Each source is read on its own: one that fails is named in
 * `failed` and the rest still show.
 */
export async function listToDecide(now = new Date()): Promise<{ items: ToDecideItem[]; failed: string[] }> {
  const cache: ClassCache = new Map()
  const { all: decided, ids: skip } = await listDecided()
  const failed: string[] = []
  const safe = async (what: string, fn: () => Promise<ToDecideItem[]>) => fn().catch((e) => {
    failed.push(what)
    console.error(`[to-decide] ${what}: ${e instanceof Error ? e.message : String(e)}`)
    return [] as ToDecideItem[]
  })
  const groups = await Promise.all([
    safe('counter sales', () => unmatchedItems(skip, now)),
    safe('refunds', () => refundItems(cache, skip)),
    safe('counter days', () => needsDaysItems(cache, skip)),
    safe('minimums', () => minimumItems(skip, now)),
    safe('door seats', () => doorItems(skip, now)),
    safe('counter checks', () => matchItems(skip, now)),
  ])
  const open = groups.flat().sort((a, b) => b.at.localeCompare(a.at))
  const done = decided
    .filter((d) => Date.parse(d.at) >= now.getTime() - DONE_SHOWN_DAYS * 86_400_000)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((d): ToDecideItem => ({
      id: d.id, kind: d.kind, title: d.title, head: d.head, hint: '', at: d.at, classId: d.classId, className: d.className,
      detail: {}, done: d.what, doneBy: d.by.name, doneAt: d.at,
    }))
  return { items: [...open, ...done], failed }
}

// ---------------------------------------------------------------- deciding

const ACTIONS: Record<ToDecideKind, string[]> = {
  'pos-unmatched': ['match', 'dismiss'],
  'refund-plain': ['keep', 'free'],
  'refund-failed': ['handled'],
  'refund-unfinished': ['finish'],
  'refund-unconfirmed': ['went-through', 'did-not-go-through'],
  'pos-needs-days': ['set-days'],
  'below-minimum': ['keep-running', 'texted'],
  'door-unpaid': ['paid', 'free'],
  'counter-match-check': ['confirm', 'move'],
}

async function record(item: ToDecideItem, what: string, by: By, action: string): Promise<Decided> {
  const d: Decided = { id: item.id, kind: item.kind, title: item.title, head: item.head, classId: item.classId, className: item.className, what, by, at: new Date().toISOString() }
  await decidedKv.set(`done-${item.id}`, JSON.stringify(d))
  await recordAudit({
    by: { ...by, role: 'owner' }, action: `to-decide-${action}`,
    target: { kind: item.classId ? 'class' : 'counter-sale', id: item.classId ?? String(item.detail.orderId ?? item.id), label: item.className ?? item.title },
    details: { item: item.id, kind: item.kind, what },
  })
  return d
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const asRefund = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof RefundError) throw new DecideError(e.status, e.message)
    throw e
  }
}

/** Reads the counter sale's line from Square (read only): its money, payments and when it was rung up. */
async function readSale(orderId: string, lineUid: string): Promise<{ units: { priceCents: Cents; taxCents: Cents }[]; totalCents: Cents; paymentIds: string[]; saleIso: string }> {
  let order: any
  try {
    order = (await squareFetch(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }))?.order
  } catch {
    throw new DecideError(503, 'Couldn’t reach Square to read that sale. Try again.')
  }
  const li = (order?.line_items ?? []).find((x: any) => x?.uid === lineUid)
  if (!li) throw new DecideError(404, 'That sale isn’t in Square any more.')
  const qty = Math.max(1, Math.floor(Number(li.quantity)) || 1)
  const total = Number(li.total_money?.amount) || 0
  const tax = Number(li.total_tax_money?.amount) || 0
  const prices = splitCents(total - tax, qty), taxes = splitCents(tax, qty)
  const paymentIds = [...new Set<string>((order.tenders ?? []).map((t: any) => t?.payment_id ?? t?.id).filter((x: unknown): x is string => typeof x === 'string' && !!x))]
  return {
    units: prices.map((p, i) => ({ priceCents: p, taxCents: taxes[i] })), totalCents: total, paymentIds,
    saleIso: order.closed_at ?? order.updated_at ?? order.created_at ?? new Date().toISOString(),
  }
}

/** The money on a counter sale's line, for the sheet. Null when Square can't be read. */
export async function saleAmount(item: ToDecideItem): Promise<Cents | null> {
  if (item.kind !== 'pos-unmatched') return null
  try {
    return (await readSale(str(item.detail.orderId), str(item.detail.lineUid))).totalCents
  } catch {
    return null
  }
}

export interface DecideResult {
  decided: Decided
  /** pos-unmatched › match: the counter seats made, to name next. */
  seats?: { lineId: string; seat: number; named: boolean }[]
  classId?: string
}

/** Finds an open item by id; refuses one already decided or gone. */
export async function openItem(id: string, now = new Date()): Promise<ToDecideItem> {
  const { items } = await listToDecide(now)
  const item = items.find((i) => i.id === id)
  if (!item) throw new DecideError(404, 'This isn’t waiting any more.')
  if (item.done) throw new DecideError(409, `Already done: ${item.done}.`)
  return item
}

export async function decide(id: string, action: string, body: any, by: By, now = new Date()): Promise<DecideResult> {
  const item = await openItem(id, now)
  if (!ACTIONS[item.kind].includes(action)) throw new DecideError(400, 'That isn’t one of the choices for this.')
  const actor = { by, role: 'owner' as const }
  const d = item.detail
  switch (item.kind) {
    case 'pos-unmatched': {
      if (action === 'dismiss') return { decided: await record(item, 'Left as a counter sale', by, action) }
      const cls = await getClass(str(body?.classId))
      if (!cls || cls.status === 'cancelled') throw new DecideError(400, 'Pick a class.')
      const pass = cls.content.passes.find((p) => p.id === str(body?.passId)) ?? (cls.content.passes.length === 1 ? cls.content.passes[0] : undefined)
      const ticket = cls.content.ticketTypes.find((t) => t.id === str(body?.ticketTypeId)) ?? (cls.content.ticketTypes.length === 1 ? cls.content.ticketTypes[0] : undefined)
      if (!pass || !ticket) throw new DecideError(400, 'Pick which seat it was.')
      const sorted = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
      let sessionIds: string[]
      if (pass.covers.kind === 'all') sessionIds = sorted.map((s) => s.id)
      else if (pass.covers.kind === 'fixed') sessionIds = pass.covers.sessionIds
      else {
        sessionIds = [...new Set(strs(body?.sessionIds))].filter((sid) => sorted.some((s) => s.id === sid))
        const need = pass.covers.kind === 'choose' ? pass.covers.count : null
        if (!sessionIds.length) throw new DecideError(400, 'Pick the date.')
        if (need && sessionIds.length !== need) throw new DecideError(400, need === 1 ? 'Pick 1 date.' : `Pick ${need} dates.`)
      }
      const orderId = str(d.orderId), lineUid = str(d.lineUid)
      const sale = await readSale(orderId, lineUid)
      const bookingId = `bkg_pos_${safeKey(orderId)}`
      const ledger = await getLedger(cls.id)
      const already = ledger.lines.find((l) => l.square.orderId === orderId && l.square.chargedCents !== undefined)
      const lines = await recordPos(cls, {
        bookingId, orderId, paymentId: sale.paymentIds[0] ?? null, paymentIds: sale.paymentIds,
        chargedCents: (already?.square.chargedCents ?? 0) + sale.totalCents,
        lines: [{ lineUid, passId: pass.id, ticketTypeId: ticket.id, sessionIds, units: sale.units }],
        saleIso: sale.saleIso,
      }, now)
      const day = sorted.find((s) => sessionIds.includes(s.id))
      const what = `Added ${seatsText(lines.length || sale.units.length)} to ${cls.content.name}${day ? ` · ${dayText(studioDate(day.startIso))}` : ''}`
      const decided = await record(item, what, by, action)
      return { decided, classId: cls.id, seats: lines.map((l) => ({ lineId: l.id, seat: l.seat, named: !!l.customer })) }
    }
    case 'refund-plain': {
      if (action === 'keep') {
        await asRefund(() => decideRefundFlag(str(d.flagId), 'kept-seat', actor))
        return { decided: await record(item, 'Kept their seat', by, action) }
      }
      const lineIds = strs(body?.lineIds)
      try {
        await asRefund(() => decideRefundFlag(str(d.flagId), 'freed-seat', actor, lineIds))
      } catch (e) {
        if (e instanceof Error && /Pick which seat/.test(e.message)) throw new DecideError(409, 'Pick which seat to free.', { needsPick: true })
        throw e
      }
      const n = lineIds.length || 1
      return { decided: await record(item, `Freed ${seatsText(n)}. Back on sale`, by, action) }
    }
    case 'refund-failed':
      await asRefund(() => decideRefundFlag(str(d.flagId), 'dismissed', actor))
      return { decided: await record(item, 'Checked in Square', by, action) }
    case 'refund-unfinished':
    case 'refund-unconfirmed': {
      const outcome = item.kind === 'refund-unfinished' || action === 'went-through' ? 'went-through' : 'did-not-go-through'
      const requestId = str(d.requestId)
      const req = (await listRefundRequests(item.classId!, str(d.bookingId))).find((r) => r.id === requestId)
      if (!req) throw new DecideError(404, 'That refund isn’t on the booking any more.')
      await asRefund(() => clearRefundRequest(
        { classId: item.classId!, bookingId: str(d.bookingId), requestId, outcome, reason: 'Checked in Square (To decide)' }, actor,
      ))
      await decideRefundFlag(str(d.flagId), 'dismissed', actor).catch(() => undefined)
      const what = item.kind === 'refund-unfinished' ? 'Finished the refund' : outcome === 'went-through' ? 'It went through' : 'It didn’t go through'
      return { decided: await record(item, what, by, action) }
    }
    case 'pos-needs-days': {
      const ids = strs(body?.sessionIds)
      try {
        await setPosDays(str(d.needsId), ids, actor, now)
      } catch (e) {
        throw new DecideError(400, e instanceof Error ? e.message : 'Pick the day.')
      }
      const sessions = (d.sessions as { id: string; startIso: string }[]).filter((s) => ids.includes(s.id))
      return { decided: await record(item, `Put on ${sessions.map((s) => dayText(studioDate(s.startIso))).join(', ')}`, by, action) }
    }
    case 'below-minimum':
      return { decided: await record(item, action === 'texted' ? `Texted the people booked` : 'Keeping it running', by, action) }
    case 'door-unpaid': {
      const lineIds = strs(d.lineIds)
      if (action === 'paid') {
        await markDoorPaid(item.classId!, lineIds, by, now)
        return { decided: await record(item, 'Marked paid at the counter', by, action) }
      }
      await asRefund(() => freeSeatOnly(item.classId!, str(d.bookingId), lineIds, actor, 'Not paid at the counter'))
      return { decided: await record(item, `Freed ${seatsText(lineIds.length)}`, by, action) }
    }
    case 'counter-match-check': {
      if (action === 'confirm') {
        await markCounterMatchChecked(item.classId!, str(d.lineId), by, now)
        return { decided: await record(item, `Yes, it was ${str(d.name)}`, by, action) }
      }
      const to = (d.others as { lineId: string; name: string }[]).find((o) => o.lineId === str(body?.toLineId))
      if (!to) throw new DecideError(400, 'Pick who it was.')
      try {
        await moveCounterPayment(item.classId!, str(d.lineId), to.lineId, by, now)
      } catch (e) {
        throw new DecideError(409, e instanceof Error ? e.message : 'That didn’t work. Try again.')
      }
      return { decided: await record(item, `It was ${to.name}: the payment moved`, by, action) }
    }
  }
}

/**
 * Names the seats of a counter sale after it was matched to a class ("Who
 * are the seats for?"). Only that sale's own counter seats, still unnamed.
 */
export async function nameCounterSeats(classId: string, names: { lineId: string; name: string }[], by: By): Promise<number> {
  const cls = await getClass(classId)
  if (!cls) throw new DecideError(404, 'That class no longer exists.')
  const ledger = await getLedger(cls.id)
  let named = 0
  for (const { lineId, name } of names) {
    const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
    if (!clean) continue
    const line = ledger.lines.find((l) => l.id === lineId)
    if (!line || line.source !== 'pos' || line.customer) throw new DecideError(400, 'One of those seats can’t be named here.')
    const [given, ...rest] = clean.split(' ')
    await setNames(cls.id, [lineId], { givenName: given, familyName: rest.join(' '), email: '', phone: '' })
    named++
  }
  if (named) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'to-decide-names', target: { kind: 'class', id: cls.id, label: cls.content.name },
      details: { seats: named },
    })
  }
  return named
}
