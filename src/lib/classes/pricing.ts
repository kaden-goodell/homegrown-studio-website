// Pricing and quotes for our own classes. Pure and browser-safe (no server imports).
import { taxCents as taxOn } from '@lib/tax'
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
export interface QuoteLine {
  kind: 'seat' | 'addon'
  seat: number
  ticketTypeId: string
  label: string
  cents: Cents
  taxCents: Cents
  variationKey?: string
}
export interface Quote {
  sessionIds: string[]
  seats: number
  lines: QuoteLine[]
  subtotalCents: Cents
  taxCents: Cents
  totalCents: Cents
}

const fail = <T>(error: string, field?: string): Result<T> => (field ? { ok: false, error, field } : { ok: false, error })

/**
 * `door`: a sale by the crew at the door (/staff). A session still counts as
 * open until it has ended, so someone arriving a few minutes late can be sold
 * a seat; online, a session closes when it starts.
 */
export interface SaleOptions { door?: boolean }

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

export function quote(cls: ScheduledClass, req: BookingRequest, now: Date, taxPercent: number, opts: SaleOptions = {}): Result<Quote> {
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
  const lines: QuoteLine[] = []
  for (let i = 0; i < seatTypes.length; i++) {
    const seat = req.seats?.[i]
    for (const q of content.questions) {
      const a = seat?.answers?.[q.id]
      if (a === undefined || a === '') return fail(`Seat ${i + 1} needs a ${q.label.toLowerCase()}.`, 'seats')
      if (!q.choices.includes(a)) return fail(`Seat ${i + 1} has a ${q.label.toLowerCase()} we don't offer.`, 'seats')
    }
    const t = seatTypes[i]
    const cents = content.prices[req.passId][t.id]
    lines.push({ kind: 'seat', seat: i, ticketTypeId: t.id, label: t.label, cents, taxCents: taxOn(cents, pct), variationKey: `${req.passId}:${t.id}` })
    for (const [addId, qty] of Object.entries(seat?.addOns ?? {})) {
      if (!qty) continue
      const add = content.addOns.find((a) => a.id === addId)
      if (!add) return fail(`Seat ${i + 1} has an extra we don't offer.`, 'seats')
      if (!Number.isInteger(qty) || qty < 0 || qty > add.maxPerSeat) {
        return fail(`Seat ${i + 1} can have up to ${add.maxPerSeat} of ${add.label}.`, 'seats')
      }
      // One line per unit: Square is sent each as quantity 1 and taxes per line.
      for (let u = 0; u < qty; u++) {
        lines.push({
          kind: 'addon', seat: i, ticketTypeId: t.id, label: add.label,
          cents: add.priceCents, taxCents: taxOn(add.priceCents, pct), variationKey: `addon:${addId}`,
        })
      }
    }
  }
  const subtotalCents = lines.reduce((s, l) => s + l.cents, 0)
  const tax = lines.reduce((s, l) => s + l.taxCents, 0)
  return { ok: true, value: { sessionIds: sess.value, seats: seatTypes.length, lines, subtotalCents, taxCents: tax, totalCents: subtotalCents + tax } }
}
