/**
 * Ticket types on one class (Kaden, 18 Oct 2026: "Adult $20, Kid $15" on a
 * family potholder class). Square classes carry one price, so the class keeps
 * the first type's price and every other type's seats are re-priced on their
 * held order before the charge (proven 18 Oct 2026, see the square class
 * bookings notes). The price always comes from these settings on our server,
 * never from the browser.
 */
import { formatMoney } from '@lib/money'

export const MAX_TICKET_TYPES = 4
export const MAX_TICKET_LABEL = 20
export const MAX_TICKET_PRICE_CENTS = 100_000

export interface TicketType {
  /** Stable key ('adult', 'kid'), from the label. */
  id: string
  label: string
  /** null = the class's own Square price (the first type always is). */
  priceCents: number | null
  /** Each booking needs at least this many of this type. */
  min: number
}

/** One seat of a booking, in the order seats are held and charged. */
export interface PlannedSeat {
  typeId: string
  label: string
  priceCents: number
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const idFrom = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** null clears them (a plain one-price class). */
export function validateTicketTypes(raw: unknown): Result<TicketType[] | null> {
  if (raw === null) return { ok: true, value: null }
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_TICKET_TYPES) {
    return { ok: false, error: `Ticket types come in 2 to ${MAX_TICKET_TYPES}, or none.` }
  }
  const out: TicketType[] = []
  for (const [i, t] of raw.entries()) {
    const label = String((t as any)?.label ?? '').trim()
    if (!label || label.length > MAX_TICKET_LABEL) return { ok: false, error: `Each ticket needs a name of ${MAX_TICKET_LABEL} characters or fewer.` }
    const id = idFrom(label)
    if (!id || out.some((o) => o.id === id)) return { ok: false, error: 'Each ticket needs its own name.' }
    const price = (t as any)?.priceCents ?? null
    if (i === 0 && price !== null) return { ok: false, error: `${label} uses the class’s own price in Square.` }
    if (i > 0 && !(Number.isInteger(price) && price >= 0 && price <= MAX_TICKET_PRICE_CENTS)) {
      return { ok: false, error: `${label} needs a price in whole cents.` }
    }
    const min = (t as any)?.min ?? 0
    if (!(Number.isInteger(min) && min >= 0 && min <= 10)) return { ok: false, error: `${label}’s minimum is 0 to 10.` }
    out.push({ id, label, priceCents: i === 0 ? null : price, min })
  }
  return { ok: true, value: out }
}

/** Each type's real price, the class price filling in for the first. */
export function resolvedPrice(t: TicketType, classPriceCents: number): number {
  return t.priceCents ?? classPriceCents
}

/**
 * The seats a booking asks for, in type order (so seat 1 is the first type,
 * the one booked in the booker's name). Refuses counts that aren't whole,
 * miss a type's minimum, name an unknown type, or come to nothing.
 */
export function seatPlan(types: TicketType[], counts: unknown, classPriceCents: number, maxSeats: number): Result<PlannedSeat[]> {
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return { ok: false, error: 'Choose how many of each ticket.' }
  const c = counts as Record<string, unknown>
  if (Object.keys(c).some((k) => !types.some((t) => t.id === k))) return { ok: false, error: 'This page is out of date. Reload it and book again.' }
  const seats: PlannedSeat[] = []
  for (const t of types) {
    const n = c[t.id] ?? 0
    if (!Number.isInteger(n) || (n as number) < 0) return { ok: false, error: 'Choose how many of each ticket.' }
    if ((n as number) < t.min) return { ok: false, error: `Each booking needs at least ${t.min} ${pluralLabel(t.label, t.min).toLowerCase()}.` }
    for (let i = 0; i < (n as number); i++) seats.push({ typeId: t.id, label: t.label, priceCents: resolvedPrice(t, classPriceCents) })
  }
  if (seats.length === 0) return { ok: false, error: 'Choose how many of each ticket.' }
  if (seats.length > maxSeats) return { ok: false, error: `One booking can hold up to ${maxSeats} people. For a bigger group, book a private party.` }
  return { ok: true, value: seats }
}

export const pluralLabel = (label: string, n: number) => (n === 1 ? label : `${label}s`)

/** "1 Adult, 2 Kids" for the seats given. */
export function ticketSummary(seats: Pick<PlannedSeat, 'typeId' | 'label'>[]): string {
  const order: string[] = []
  const counts = new Map<string, { label: string; n: number }>()
  for (const s of seats) {
    if (!counts.has(s.typeId)) { order.push(s.typeId); counts.set(s.typeId, { label: s.label, n: 0 }) }
    counts.get(s.typeId)!.n++
  }
  return order.map((id) => { const { label, n } = counts.get(id)!; return `${n} ${pluralLabel(label, n)}` }).join(', ')
}

/** "$20 adult · $15 kid" for a class card. */
export function ticketPriceLine(types: TicketType[], classPriceCents: number, currency = 'USD'): string {
  return types.map((t) => `${formatMoney(resolvedPrice(t, classPriceCents), currency)} ${t.label.toLowerCase()}`).join(' · ')
}
