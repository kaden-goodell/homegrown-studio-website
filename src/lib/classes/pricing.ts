// Pricing and quotes for our own classes. Pure and browser-safe (no server imports).
import { orderLineTaxes } from '@lib/tax'
import { promoRefusal } from '@lib/promos/rules'
import type { PromoCode } from '@lib/promos/types'
import { earlyBirdCents } from './early-bird'
import type { Cents, ScheduledClass } from './types'
import type { Result } from './validate'

export interface BookingRequest {
  passId: string
  /** session ids the buyer picked (for 'choose'); ignored otherwise */
  sessionIds?: string[]
  /** count per ticket type id */
  tickets: Record<string, number>
  /** per seat: answers and add-on counts, seat index = order of seats (ticket types in content order) */
  seats?: { answers?: Record<string, string>; addOns?: Record<string, number> }[]
  promoCode?: string // stage 4
}
/**
 * Stage 4: money off one line. `name` is what the Square receipt shows: "Early-bird", "Code FALLFRIENDS",
 * "Waitlist price" (D6: a waitlist joiner is charged the price they agreed to, never more).
 */
export interface LineDiscount {
  kind: 'early-bird' | 'promo' | 'waitlist'; name: string; cents: Cents
  /** Stage 4 fix 2 (I1): the code itself on a promo discount, so whoever confirms the seats (the request, Square's payment notice, the nightly catch-up) counts its use. */
  code?: string
}
export interface QuoteLine {
  kind: 'seat' | 'addon'
  seat: number
  ticketTypeId: string
  label: string
  /** The catalog price (what the POS item says). */
  listCents: Cents
  /** In the order they come off: early-bird first, then a code. */
  discounts: LineDiscount[]
  /** What is charged for the line before tax: list − discounts, never below 0. */
  cents: Cents
  /** Tax on the net (`cents`), rounded per line as Square does. */
  taxCents: Cents
  variationKey?: string
}
export interface Quote {
  sessionIds: string[]
  seats: number
  lines: QuoteLine[]
  /** Net of discounts. */
  subtotalCents: Cents
  taxCents: Cents
  totalCents: Cents
  /** Everything taken off (early-bird and code). */
  discountCents: Cents
  /** The code applied and what it took off in all; null when none. */
  promo: { code: string; cents: Cents } | null
}

const fail = <T>(error: string, field?: string): Result<T> => (field ? { ok: false, error, field } : { ok: false, error })

/**
 * `door`: a sale by the crew at the door (/staff). A session still counts as
 * open until it has ended, so someone arriving a few minutes late can be sold
 * a seat; online, a session closes when it starts.
 */
export interface SaleOptions { door?: boolean }
/**
 * `promo`: a code to apply. quote() applies it only when it works on this
 * class now (on, not ended, for this class); whether uses are left is the
 * checkout's to check (it needs the store).
 */
export interface QuoteOptions extends SaleOptions { promo?: PromoCode | null }

/**
 * Splits `totalCents` over lines in proportion to their size: largest
 * remainder, ties to the earlier line, never more than a line has. The total
 * is capped at the lines' sum.
 */
export function splitAmount(totalCents: Cents, lineCents: Cents[]): Cents[] {
  const sum = lineCents.reduce((s, c) => s + Math.max(0, c), 0)
  if (!lineCents.length || sum <= 0 || totalCents <= 0) return lineCents.map(() => 0)
  const total = Math.min(totalCents, sum)
  const parts = lineCents.map((c, i) => {
    const w = Math.max(0, c) * total
    return { i, base: Math.floor(w / sum), rem: w % sum }
  })
  let left = total - parts.reduce((s, p) => s + p.base, 0)
  const order = [...parts].sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const p of order) {
    if (left <= 0) break
    if (p.rem === 0) continue
    p.base += 1
    left -= 1
  }
  return parts.map((p) => p.base)
}

export function sessionsForPass(cls: ScheduledClass, passId: string, picked: string[] | undefined, now: Date, opts: SaleOptions = {}): Result<string[]> {
  const pass = cls.content.passes.find((p) => p.id === passId)
  if (!pass) return fail('That option is not available for this class.', 'passId')
  const sessions = [...cls.sessions].sort((a, b) => a.startIso.localeCompare(b.startIso))
  const nowMs = now.getTime()
  const closesAt = (s: { startIso: string; endIso: string }) => (opts.door ? s.endIso : s.startIso)
  const started = (s: { startIso: string; endIso: string }) => new Date(closesAt(s)).getTime() <= nowMs
  const c = pass.covers
  // R28: a class that doesn't take people partway closes every pass once its first session starts.
  if (c.kind !== 'remaining' && !cls.content.rules.joinPartway && sessions.length && started(sessions[0])) {
    return fail('Sign-ups for this have closed.')
  }

  if (c.kind === 'remaining') {
    if (sessions.length && started(sessions[0]) && !cls.content.rules.joinPartway) {
      return fail('This class has already started.')
    }
    const left = sessions.filter((s) => !started(s))
    if (!left.length) return fail('There are no sessions left to join.')
    return { ok: true, value: left.map((s) => s.id) }
  }
  if (c.kind === 'all' || c.kind === 'fixed') {
    const covered = c.kind === 'all' ? sessions : sessions.filter((s) => c.sessionIds.includes(s.id))
    if (!covered.length) return fail('This option has no sessions.')
    if (started(covered[0])) return fail('Sign-ups for this have closed.')
    return { ok: true, value: covered.map((s) => s.id) }
  }
  // choose
  const ids = picked ?? []
  if (new Set(ids).size !== ids.length || ids.length !== c.count) {
    return fail(`Pick exactly ${c.count} different ${c.count === 1 ? 'day' : 'days'}.`, 'sessionIds')
  }
  const chosen = []
  for (const id of ids) {
    const s = sessions.find((x) => x.id === id)
    if (!s) return fail('One of the days you picked is not part of this class.', 'sessionIds')
    if (started(s)) return fail('One of the days you picked has already started.', 'sessionIds')
    chosen.push(s)
  }
  chosen.sort((a, b) => a.startIso.localeCompare(b.startIso))
  return { ok: true, value: chosen.map((s) => s.id) }
}

export function quote(cls: ScheduledClass, req: BookingRequest, now: Date, taxPercent: number, opts: QuoteOptions = {}): Result<Quote> {
  const content = cls.content
  const pass = content.passes.find((p) => p.id === req.passId)
  if (!pass) return fail('That option is not available for this class.', 'passId')

  for (const id of Object.keys(req.tickets ?? {})) {
    if (!content.ticketTypes.some((t) => t.id === id)) return fail('That ticket type is not part of this class.', 'tickets')
  }
  // Seat order: ticket types in content order, each repeated by its count.
  const seatTypes: { id: string; label: string }[] = []
  for (const t of content.ticketTypes) {
    const n = req.tickets?.[t.id] ?? 0
    if (!Number.isInteger(n) || n < 0) return fail('Ticket counts must be whole numbers.', 'tickets')
    for (let i = 0; i < n; i++) seatTypes.push(t)
  }
  if (seatTypes.length === 0) return fail('Choose at least one person.', 'tickets')
  if (seatTypes.length > content.rules.maxPerBooking) {
    return fail(`You can book up to ${content.rules.maxPerBooking} at a time.`, 'tickets')
  }

  const sess = sessionsForPass(cls, req.passId, req.sessionIds, now, opts)
  if (!sess.ok) return sess

  for (const t of content.ticketTypes) {
    if ((req.tickets?.[t.id] ?? 0) > 0 && content.prices[req.passId]?.[t.id] === undefined) {
      return fail(`${t.label} tickets aren't sold for this pass.`, 'tickets')
    }
  }

  const needsSeats = content.questions.length > 0 || content.addOns.length > 0
  if (needsSeats && (req.seats?.length ?? 0) !== seatTypes.length) {
    return fail('Details are needed for every seat.', 'seats')
  }

  const pct = content.rules.taxable ? taxPercent : 0
  type Draft = Omit<QuoteLine, 'cents' | 'taxCents'> & { net: Cents }
  const drafts: Draft[] = []
  for (let i = 0; i < seatTypes.length; i++) {
    const seat = req.seats?.[i]
    for (const q of content.questions) {
      const a = seat?.answers?.[q.id]
      if (a === undefined || a === '') return fail(`Seat ${i + 1} needs a ${q.label.toLowerCase()}.`, 'seats')
      if (!q.choices.includes(a)) return fail(`Seat ${i + 1} has a ${q.label.toLowerCase()} we don't offer.`, 'seats')
    }
    const t = seatTypes[i]
    const list = content.prices[req.passId][t.id]
    // Early-bird (OWNER-S4-7): the cell's early-bird price while it runs.
    const eb = earlyBirdCents(content, req.passId, t.id, now)
    const discounts: LineDiscount[] = eb !== null && eb < list ? [{ kind: 'early-bird', name: 'Early-bird', cents: list - eb }] : []
    drafts.push({ kind: 'seat', seat: i, ticketTypeId: t.id, label: t.label, listCents: list, discounts, net: list - (discounts[0]?.cents ?? 0), variationKey: `${req.passId}:${t.id}` })
    for (const [addId, qty] of Object.entries(seat?.addOns ?? {})) {
      if (!qty) continue
      const add = content.addOns.find((a) => a.id === addId)
      if (!add) return fail(`Seat ${i + 1} has an extra we don't offer.`, 'seats')
      if (!Number.isInteger(qty) || qty < 0 || qty > add.maxPerSeat) {
        return fail(`Seat ${i + 1} can have up to ${add.maxPerSeat} of ${add.label}.`, 'seats')
      }
      // One line per unit: Square is sent each as quantity 1 and taxes per line.
      for (let u = 0; u < qty; u++) {
        drafts.push({
          kind: 'addon', seat: i, ticketTypeId: t.id, label: add.label,
          listCents: add.priceCents, discounts: [], net: add.priceCents, variationKey: `addon:${addId}`,
        })
      }
    }
  }

  // The code (S4-R1: per line, to the cent, so Square never apportions anything).
  const p = opts.promo && promoRefusal(opts.promo, cls, now, null) === null ? opts.promo : null
  let promoCents = 0
  if (p) {
    const name = `Code ${p.code}`
    const eligible = drafts.filter((d) => d.kind === 'seat' || p.includeExtras)
    const take = (d: Draft, cents: Cents) => {
      const c = Math.min(Math.max(0, cents), d.net)
      if (c <= 0) return
      d.discounts.push({ kind: 'promo', name, cents: c, code: p.code })
      d.net -= c
      promoCents += c
    }
    if (p.off.kind === 'percent') {
      const pc = p.off.percent
      for (const d of eligible) take(d, Math.round((d.net * pc) / 100))
    } else if (p.per === 'booking') {
      const shares = splitAmount(p.off.cents, eligible.map((d) => d.net))
      eligible.forEach((d, i) => take(d, shares[i]))
    } else {
      // Each person: the amount off their seat (and their extras, when the code covers extras).
      for (let i = 0; i < seatTypes.length; i++) {
        const mine = eligible.filter((d) => d.seat === i)
        const shares = splitAmount(p.off.cents, mine.map((d) => d.net))
        mine.forEach((d, k) => take(d, shares[k]))
      }
    }
  }

  // One Square order: its tax is rounded once on the order (half to even) and shared over the lines, as Square does.
  const lineTax = orderLineTaxes(drafts.map((d) => d.net), pct)
  const lines: QuoteLine[] = drafts.map(({ net, ...d }, i) => ({ ...d, cents: net, taxCents: lineTax[i] }))
  const subtotalCents = lines.reduce((s, l) => s + l.cents, 0)
  const tax = lines.reduce((s, l) => s + l.taxCents, 0)
  const discountCents = lines.reduce((s, l) => s + l.discounts.reduce((t, d) => t + d.cents, 0), 0)
  return {
    ok: true,
    value: {
      sessionIds: sess.value, seats: seatTypes.length, lines, subtotalCents, taxCents: tax, totalCents: subtotalCents + tax,
      discountCents, promo: p ? { code: p.code, cents: promoCents } : null,
    },
  }
}

/** What a waitlist joiner agreed to for one line (net, before tax), in quote line order. */
export interface AgreedLine { key: string; seat: number; cents: Cents }

export const agreedLinesOf = (q: Quote): AgreedLine[] => q.lines.map((l) => ({ key: l.variationKey ?? l.label, seat: l.seat, cents: l.cents }))

/**
 * D6 (Kaden 2 Nov): a waitlist joiner is charged the price they agreed to,
 * never more, even after the early-bird ends or the price rises. Each line is
 * charged min(today's net, agreed net); the difference comes off as a
 * "Waitlist price" line discount (so Square's order total matches) and tax is
 * worked out on what is charged. `agreed` must line up with `q.lines` (same
 * count, key and seat); otherwise `q` comes back unchanged.
 */
export function atAgreedPrices(cls: ScheduledClass, q: Quote, agreed: AgreedLine[] | null | undefined, taxPercent: number): Quote {
  if (!agreed || agreed.length !== q.lines.length) return q
  if (q.lines.some((l, i) => (l.variationKey ?? l.label) !== agreed[i].key || l.seat !== agreed[i].seat)) return q
  const pct = cls.content.rules.taxable ? taxPercent : 0
  let changed = false
  const lines: QuoteLine[] = q.lines.map((l, i) => {
    const off = l.cents - Math.max(0, Math.min(l.cents, agreed[i].cents))
    if (off <= 0) return l
    changed = true
    const cents = l.cents - off
    return { ...l, discounts: [...l.discounts, { kind: 'waitlist', name: 'Waitlist price', cents: off }], cents }
  })
  if (!changed) return q
  const lineTax = orderLineTaxes(lines.map((l) => l.cents), pct)
  lines.forEach((l, i) => { lines[i] = { ...l, taxCents: lineTax[i] } })
  const subtotalCents = lines.reduce((s, l) => s + l.cents, 0)
  const tax = lines.reduce((s, l) => s + l.taxCents, 0)
  const discountCents = lines.reduce((s, l) => s + l.discounts.reduce((t, d) => t + d.cents, 0), 0)
  return { ...q, lines, subtotalCents, taxCents: tax, totalCents: subtotalCents + tax, discountCents }
}
