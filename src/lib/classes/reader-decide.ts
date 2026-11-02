/**
 * Stage 4: what an owner answers about a reader sale in /admin › To decide
 * (TOP RULE: every answer is a button here, never the Square dashboard).
 *
 *   reader-waiting    the Square app never came back → Ask Square · Let the seat go
 *                     (or, R1, Square showed a payment that didn't match →
 *                     Keep it, they paid $X · Refund it and let the seat go)
 *   reader-extra      R2: a second payment for a sale already paid (or a
 *                     payment that didn't match after its seat was let go)
 *                     → Refund it · It's already sorted
 *   reader-late       R3: paid after the seat was let go or after its hold ran
 *                     out (seated over capacity) → Keep them · Refund and free the seat
 *
 * Every money answer reads Square again first, is idempotent (a double tap or
 * a retry never refunds or records twice) and is audited. Server only.
 */
import { recordAudit } from '@lib/audit'
import type { By } from '@lib/staff-auth'
import { formatCalendarDay, formatSlotLabel, formatTime, studioDate } from '@lib/studio-time'
import { RefundError } from '@lib/booking-core/refund-words'
import { tokenOf } from './decided'
import { getClass } from './class-store'
import { checkReaderOrder, paidForSeat, paymentIdsOf, MONEY_REFUSALS } from './reader'
import { markReaderPaid, readerHoldEnds, readerNeedsDeciding, settleReaderOrder } from './reader-flow'
import { refundReaderPayments } from './reader-refund'
import { getReaderOrderLink, getReaderSale, linkReaderOrder, listReaderSales, updateReaderSale, type ReaderSale } from './reader-store'
import { refundClassBooking } from './refunds'
import { release } from './seat-ledger'
import { squareFetch, squareSettings } from './square-api'

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`
const nameOf = (s: ReaderSale) => `${s.customer.givenName} ${s.customer.familyName}`.trim()

export class ReaderDecideError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

const NOT_WAITING = 'This isn’t waiting any more.'

/** The order as Square shows it now (read only). */
async function readOrder(orderId: string): Promise<any> {
  try {
    const order = (await squareFetch(`/orders/${encodeURIComponent(orderId)}`, { method: 'GET' }))?.order
    if (order) return order
  } catch { /* below */ }
  throw new ReaderDecideError(503, 'Couldn’t reach Square to check the payment first. Nothing changed. Try again in a minute.')
}

const asDecide = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof RefundError) throw new ReaderDecideError(e.status, e.message, e.extra ?? {})
    throw e
  }
}

/**
 * Re-reads the order that didn't match and says what it is now. A payment that
 * passes now is simply seated (and the caller refuses the owner's choice); one
 * that is another booking's or not finished can't be kept or refunded here.
 */
async function recheck(sale: ReaderSale, origin: string, now: Date): Promise<{ order: any; why: string }> {
  const p = sale.problem!
  const order = await readOrder(p.orderId)
  const verdict = checkReaderOrder(order, { locationId: squareSettings().locationId || '', amountCents: sale.amountCents, bookingId: sale.bookingId, startedAt: sale.startedAt })
  if (verdict.ok) {
    await settleReaderOrder(sale, order, 'check', origin, now)
    throw new ReaderDecideError(409, 'Square shows this payment matches now, so they have their seat. Nothing was refunded.')
  }
  if (verdict.why === 'not-completed') throw new ReaderDecideError(409, 'Square doesn’t show that payment as finished yet. Nothing changed. Try again in a few minutes.')
  if (!MONEY_REFUSALS.has(verdict.why)) throw new ReaderDecideError(409, 'That payment isn’t this sale’s, so it can’t be kept or refunded here. Ask Square, or let the seat go.')
  const link = await getReaderOrderLink(String(order.id))
  if (link && link.bookingId !== sale.bookingId) throw new ReaderDecideError(409, 'That payment already pays for another seat, so it can’t be kept or refunded here. Ask Square, or let the seat go.')
  return { order, why: verdict.why }
}

/**
 * R1 "Keep it, they paid $X": the seat is paid with the order Square showed,
 * recording what Square shows (less any tip). Less than the seat → refused
 * until the owner confirms that exact shortfall (`shortCents` = what Square
 * shows paid). A split payment can't be kept (its refund couldn't go back on
 * one payment later). Never after a refund of it was started.
 */
export async function keepReaderPayment(bookingId: string, by: By, opts: { confirmPaidCents?: number; origin: string; now?: Date }): Promise<{ message: string; paidCents: number; overCapacity: boolean; replayed?: true }> {
  const now = opts.now ?? new Date()
  const sale = await getReaderSale(bookingId)
  if (!sale) throw new ReaderDecideError(404, NOT_WAITING)
  if (sale.state === 'paid' && sale.paid?.how === 'kept') return { message: `Kept. They paid ${dollars(sale.paid.paidCents ?? sale.amountCents)}`, paidCents: sale.paid.paidCents ?? sale.amountCents, overCapacity: false, replayed: true }
  if (sale.state !== 'waiting' || !sale.problem || !MONEY_REFUSALS.has(sale.problem.why)) throw new ReaderDecideError(409, NOT_WAITING)
  const { order, why } = await recheck(sale, opts.origin, now)
  const paymentIds = paymentIdsOf(order)
  if (why === 'split' || paymentIds.length !== 1) {
    throw new ReaderDecideError(409, 'That payment was split between a gift card and a card, so it can’t be kept: a refund later couldn’t go back on one payment. Refund it, then charge them again with Pay on the iPad.')
  }
  if ((sale.refunds ?? []).some((r) => paymentIds.includes(r.paymentId))) throw new ReaderDecideError(409, 'A refund of this payment was already sent, so it can’t be kept. Tap Refund it to finish it.')
  const { paidCents, tipCents } = paidForSeat(order)
  if (paidCents <= 0) throw new ReaderDecideError(409, 'Square shows nothing paid on that payment, so there’s nothing to keep. Let the seat go instead.')
  const shortCents = Math.max(0, sale.amountCents - paidCents)
  if (shortCents > 0 && opts.confirmPaidCents !== paidCents) {
    throw new ReaderDecideError(409, `Square shows ${dollars(paidCents)} paid, ${dollars(shortCents)} less than the ${dollars(sale.amountCents)} seat. Keep it anyway?`, { short: { paidCents, askedCents: sale.amountCents, shortCents } })
  }
  const cls = await getClass(sale.classId)
  if (!cls) throw new ReaderDecideError(404, 'That class isn’t on file any more. Nothing changed.')
  const link = await linkReaderOrder({
    orderId: String(order.id), bookingId: sale.bookingId, classId: sale.classId,
    netCents: sale.quote.lines.reduce((s, l) => s + l.cents, 0), taxCents: sale.quote.lines.reduce((s, l) => s + l.taxCents, 0), at: now.toISOString(),
  })
  if (link === 'other') throw new ReaderDecideError(409, 'That payment already pays for another seat, so it can’t be kept here.')
  const r = await markReaderPaid(sale, cls, {
    orderId: String(order.id), paymentId: paymentIds[0], paymentIds, tipCents, chargedCents: paidCents, how: 'kept',
    kept: { by, at: now.toISOString(), why: why as NonNullable<ReaderSale['problem']>['why'], shortCents },
  }, opts.origin, now)
  const overCapacity = r.lines.some((l) => l.overCapacity) && !sale.overCapacity
  return { message: r.message, paidCents, overCapacity }
}

/**
 * R1 "Refund it and let the seat go": every payment on the order that didn't
 * match goes back (exactly what Square shows left on each, through the shared
 * refund runner), then the held seat is let go. Square is read first.
 */
export async function refundMismatchedReader(bookingId: string, by: By, opts: { origin: string; now?: Date }): Promise<{ cents: number; emailed: boolean; replayed?: true }> {
  const now = opts.now ?? new Date()
  const sale = await getReaderSale(bookingId)
  if (!sale) throw new ReaderDecideError(404, NOT_WAITING)
  if (sale.state === 'let-go' && sale.ended?.why === 'refunded') {
    return { cents: (sale.refunds ?? []).filter((r) => r.orderId === sale.problem?.orderId).reduce((s, r) => s + r.cents, 0), emailed: false, replayed: true }
  }
  if (sale.state !== 'waiting' || !sale.problem || !MONEY_REFUSALS.has(sale.problem.why)) throw new ReaderDecideError(409, NOT_WAITING)
  const { order } = await recheck(sale, opts.origin, now)
  const paymentIds = paymentIdsOf(order)
  if (!paymentIds.length) throw new ReaderDecideError(409, 'Square shows no payment on that order, so there’s nothing to refund. Let the seat go instead.')
  const out = await asDecide(() => refundReaderPayments(sale.bookingId, String(order.id), paymentIds, 'Reader payment didn’t match (To decide)', by))
  // The money is back: the held seat goes back on sale.
  await release(sale.classId, sale.bookingId).catch(() => undefined)
  let wrote = false
  await updateReaderSale(sale.bookingId, (cur) => {
    wrote = false
    if (cur.state !== 'waiting') return null
    wrote = true
    return {
      ...cur, state: 'let-go', ended: { at: now.toISOString(), why: 'refunded', by: { id: by.id, name: by.name } },
      answer: { message: `Refunded ${dollars(out.cents)} and the seat was let go.`, outcome: 'let-go' },
    }
  })
  if (wrote) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: 'seat.reader-refunded-let-go', target: { kind: 'workshop', id: sale.classId, label: sale.className },
      details: { bookingId, orderId: String(order.id), cents: out.cents, why: sale.problem.why, name: nameOf(sale) },
    })
  }
  return out
}

/** R2 "Refund it": a second reader payment goes back whole (Square read first). */
export async function refundExtraReader(bookingId: string, orderId: string, by: By, now = new Date()): Promise<{ cents: number; emailed: boolean; replayed?: true }> {
  const sale = await getReaderSale(bookingId)
  const extra = sale?.extraPayments?.find((x) => x.orderId === orderId)
  if (!sale || !extra) throw new ReaderDecideError(404, NOT_WAITING)
  if (extra.decided?.what === 'refunded') return { cents: (sale.refunds ?? []).filter((r) => r.orderId === orderId).reduce((s, r) => s + r.cents, 0), emailed: false, replayed: true }
  if (extra.decided) throw new ReaderDecideError(409, NOT_WAITING)
  // Square read first: the payments on the order as it is now.
  const order = await readOrder(orderId)
  if (sale.paid?.orderId === orderId) throw new ReaderDecideError(409, 'That payment pays for their seat, so it isn’t refunded here. Refund it from the class if it should go back.')
  const link = await getReaderOrderLink(orderId)
  if (link && link.bookingId !== bookingId) throw new ReaderDecideError(409, 'That payment pays for another seat, so it isn’t refunded here.')
  const paymentIds = paymentIdsOf(order).length ? paymentIdsOf(order) : extra.paymentIds
  if (!paymentIds.length) throw new ReaderDecideError(409, 'Square shows no payment on that order, so there’s nothing to refund. Tap It’s already sorted.')
  const out = await asDecide(() => refundReaderPayments(bookingId, orderId, paymentIds, 'Second reader payment (To decide)', by))
  await decideExtra(bookingId, orderId, 'refunded', by, now, out.cents)
  return out
}

/** R2 "It's already sorted": confirmed in the sheet first; nothing is refunded. */
export async function sortedExtraReader(bookingId: string, orderId: string, by: By, now = new Date()): Promise<void> {
  const sale = await getReaderSale(bookingId)
  const extra = sale?.extraPayments?.find((x) => x.orderId === orderId)
  if (!sale || !extra) throw new ReaderDecideError(404, NOT_WAITING)
  if (extra.decided?.what === 'sorted') return
  if (extra.decided) throw new ReaderDecideError(409, NOT_WAITING)
  // A refund already sent on it is finished with Refund it (the same request), never cleared half-way.
  if ((sale.refunds ?? []).some((r) => r.orderId === orderId)) throw new ReaderDecideError(409, 'A refund of this payment was already sent. Tap Refund it to finish it.')
  await decideExtra(bookingId, orderId, 'sorted', by, now, 0)
}

async function decideExtra(bookingId: string, orderId: string, what: 'refunded' | 'sorted', by: By, now: Date, cents: number): Promise<void> {
  let wrote = false
  const after = await updateReaderSale(bookingId, (cur) => {
    wrote = false
    const list = cur.extraPayments ?? []
    const i = list.findIndex((x) => x.orderId === orderId && !x.decided)
    if (i < 0) return null
    wrote = true
    const next = [...list]
    next[i] = { ...list[i], decided: { what, by: { id: by.id, name: by.name }, at: now.toISOString() } }
    return { ...cur, extraPayments: next }
  })
  if (wrote && after) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: what === 'refunded' ? 'seat.reader-extra-refunded' : 'seat.reader-extra-sorted',
      target: { kind: 'workshop', id: after.classId, label: after.className },
      details: { bookingId, orderId, cents, name: nameOf(after) },
    })
  }
}

/** R3 "Keep them": the late payment keeps its seat (over capacity if so). */
export async function keepLateReader(bookingId: string, by: By, now = new Date()): Promise<void> {
  const sale = await getReaderSale(bookingId)
  if (!sale?.late) throw new ReaderDecideError(404, NOT_WAITING)
  if (sale.late.decided) {
    if (sale.late.decided.what === 'kept') return
    throw new ReaderDecideError(409, NOT_WAITING)
  }
  await decideLate(sale, 'kept', by, now, 0)
}

/** R3 "Refund and free the seat": the class refund of the whole booking, freeing its seat (the shared runner, Square never twice). */
export async function refundLateReader(bookingId: string, by: By, now = new Date()): Promise<{ cents: number; already?: string }> {
  const sale = await getReaderSale(bookingId)
  if (!sale?.late || sale.state !== 'paid') throw new ReaderDecideError(404, NOT_WAITING)
  if (sale.late.decided?.what === 'kept') throw new ReaderDecideError(409, NOT_WAITING)
  const r = await asDecide(() => refundClassBooking({
    classId: sale.classId, bookingId, kind: 'booking', freeSeat: true, reason: 'Reader payment came in late (To decide)',
    attempt: `rdl${bookingId.replace(/[^A-Za-z0-9_-]/g, '')}`.slice(0, 80),
  }, { by, role: 'owner' }))
  await decideLate(sale, 'refunded', by, now, r.cents)
  return { cents: r.cents, ...(r.already ? { already: r.already.message } : {}) }
}

async function decideLate(sale: ReaderSale, what: 'kept' | 'refunded', by: By, now: Date, cents: number): Promise<void> {
  let wrote = false
  await updateReaderSale(sale.bookingId, (cur) => {
    wrote = false
    if (!cur.late || cur.late.decided) return null
    wrote = true
    return { ...cur, late: { ...cur.late, decided: { what, by: { id: by.id, name: by.name }, at: now.toISOString() } } }
  })
  if (wrote) {
    await recordAudit({
      by: { ...by, role: 'owner' }, action: what === 'kept' ? 'seat.reader-late-kept' : 'seat.reader-late-refunded',
      target: { kind: 'workshop', id: sale.classId, label: sale.className },
      details: { bookingId: sale.bookingId, cents, name: nameOf(sale), overCapacity: !!sale.late?.overCapacity },
    })
  }
}

// ---------------------------------------------------------------- the items (To decide and the warnings)

export type ReaderDecideKind = 'reader-waiting' | 'reader-extra' | 'reader-late'

export interface ReaderDecideItem {
  id: string
  kind: ReaderDecideKind
  title: string
  head: string
  hint: string
  /** the warnings line (/staff, the daily email) */
  warning: string
  at: string
  classId: string
  className: string
  detail: Record<string, unknown>
}

/** What an owner can do with a reader sale waiting on To decide (the sheet shows only these buttons). */
export function readerChoices(s: ReaderSale): ('check' | 'let-go' | 'keep' | 'refund')[] {
  const why = s.problem?.why
  if (why && MONEY_REFUSALS.has(why)) return why === 'split' ? ['refund', 'check'] : ['keep', 'refund', 'check']
  return ['check', 'let-go']
}

export function readerWaitingId(bookingId: string) { return tokenOf(`reader-${bookingId}`) }
export function readerExtraId(orderId: string) { return tokenOf(`reader-extra-${orderId}`) }
export function readerLateId(bookingId: string) { return tokenOf(`reader-late-${bookingId}`) }

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })

const PROBLEM_WORDS: Record<string, string> = {
  amount: 'doesn’t match the amount asked', tender: 'wasn’t by card or gift card', location: 'was taken at another Square location',
  old: 'is from before this sale started', late: 'finished more than a day after this sale started', split: 'was split between a gift card and a card',
  linked: 'already pays for another seat', 'not-ours': 'is for a different sale',
}

export async function readerDecideItems(skip: ReadonlySet<string>, now: Date): Promise<ReaderDecideItem[]> {
  const out: ReaderDecideItem[] = []
  for (const s of await listReaderSales()) {
    const name = nameOf(s)
    const when = formatSlotLabel(s.firstStartIso)
    const day = `${formatCalendarDay(studioDate(s.firstStartIso))} ${formatTime(s.firstStartIso)}`
    const base = { classId: s.classId, className: s.className }
    const contact = { bookingId: s.bookingId, name, email: s.customer.email, phone: s.customer.phone, by: s.by.name }
    if (readerNeedsDeciding(s, now)) {
      const id = readerWaitingId(s.bookingId)
      if (!skip.has(id)) {
        const money = !!s.problem && MONEY_REFUSALS.has(s.problem.why)
        const expired = now.getTime() > readerHoldEnds(s)
        const held = expired ? 'The seat was held for 30 minutes; if Square shows it paid, they get it back even if the class is full.' : 'The seat is held.'
        const paid = s.problem?.paidCents ?? null
        out.push({
          ...base, id, kind: 'reader-waiting', at: s.startedAt,
          title: s.problem ? 'Reader payment didn’t match' : 'Reader payment didn’t come back',
          head: s.problem
            ? money
              ? `${name}, ${s.seatsLabel} of ${s.className} on ${when}. Square shows a payment${paid !== null ? ` of ${dollars(paid)}` : ''} for this sale that ${PROBLEM_WORDS[s.problem.why]}, so the seat isn’t marked paid. ${expired ? held : 'The seat is held.'} Nothing was refunded.`
              : `${name}, ${s.seatsLabel} of ${s.className} on ${when}. Square showed a payment that ${PROBLEM_WORDS[s.problem.why]}, so it isn’t this sale’s. ${held}`
            : `${name}, ${s.seatsLabel} of ${s.className} on ${when}. ${dollars(s.amountCents)} was sent to the Square app at ${time(s.startedAt)} and the payment never came back here. ${held}`,
          hint: money ? (s.problem!.why === 'split' ? 'Refund it' : 'Keep it or refund it') : 'Ask Square, or let the seat go',
          warning: s.problem && money
            ? `${s.className} ${day}: Square shows a payment for ${name}’s reader sale that ${PROBLEM_WORDS[s.problem.why]}. The seat isn’t marked paid. Keep it or refund it.`
            : `${s.className} ${day}: ${name}’s ${dollars(s.amountCents)} reader payment never came back from the Square app.${expired ? '' : ' The seat is held.'}`,
          detail: {
            ...contact, cents: s.amountCents, startedAt: s.startedAt, problem: s.problem?.why ?? null, offline: !!s.offline,
            paidCents: paid, choices: readerChoices(s),
          },
        })
      }
    }
    for (const x of s.extraPayments ?? []) {
      if (x.decided) continue
      const id = readerExtraId(x.orderId)
      if (skip.has(id)) continue
      const seated = s.state === 'paid'
      out.push({
        ...base, id, kind: 'reader-extra', at: x.at,
        title: seated ? 'Second reader payment' : 'Reader payment with no seat',
        head: seated
          ? `${name} paid twice on the reader for ${s.seatsLabel} of ${s.className} on ${when}. Their seat is paid by the other payment; Square shows a second payment${x.cents ? ` of ${dollars(x.cents)}` : ''}. Nothing was refunded.`
          : `Square shows a payment${x.cents ? ` of ${dollars(x.cents)}` : ''} for ${name}’s reader sale (${s.className} on ${when}) after its seat was let go, and it doesn’t match. Nobody has a seat for it. Nothing was refunded.`,
        hint: 'Refund it, or say it’s already sorted',
        warning: `${s.className} ${day}: ${seated ? `a second reader payment for ${name}` : `a reader payment for ${name} with no seat`}${x.cents ? ` (${dollars(x.cents)})` : ''}. Nothing was refunded.`,
        detail: { ...contact, orderId: x.orderId, cents: x.cents, refundStarted: (s.refunds ?? []).some((r) => r.orderId === x.orderId) },
      })
    }
    if (s.late && !s.late.decided && s.state === 'paid') {
      const id = readerLateId(s.bookingId)
      if (!skip.has(id)) {
        out.push({
          ...base, id, kind: 'reader-late', at: s.late.at,
          title: 'Reader payment came in late',
          head: s.late.afterLetGo
            ? `${name}’s ${dollars(s.amountCents)} reader payment for ${s.seatsLabel} of ${s.className} on ${when} came in after the seat was let go. They have their seat${s.late.overCapacity ? ', over capacity' : ''}.`
            : `${name}’s ${dollars(s.amountCents)} reader payment for ${s.seatsLabel} of ${s.className} on ${when} came in after its 30-minute hold ran out, and the class had filled. They have their seat, over capacity.`,
          hint: 'Keep them, or refund it and free the seat',
          warning: `${s.className} ${day}: ${name}’s reader payment came in late; they have their seat${s.late.overCapacity ? ' (over capacity)' : ''}.`,
          detail: { ...contact, cents: s.amountCents, overCapacity: s.late.overCapacity },
        })
      }
    }
  }
  return out
}
