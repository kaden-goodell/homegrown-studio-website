/**
 * Quote money: normal value, how far off normal, the meter, totals, deposit.
 * Pure; safe in the browser (the quote sheet's meter uses it).
 */
import type { Meter, QuoteSettings, Tier } from './types'

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

/** Normal price per person: per-person lines plus per-event lines spread over the guests (rounded up). */
export function normalPerPerson(t: Pick<Tier, 'lines'>, guests: number): number {
  const person = sum(t.lines.filter((l) => l.per === 'person').map((l) => l.cents))
  const event = sum(t.lines.filter((l) => l.per === 'event').map((l) => l.cents))
  return person + (event > 0 ? Math.ceil(event / Math.max(1, guests)) : 0)
}

/** How far the customer's price is below normal, 0..1 (negative when above normal). */
export function offPct(t: Pick<Tier, 'lines' | 'priceCents'>, guests: number): number {
  const n = normalPerPerson(t, guests)
  return n <= 0 ? 0 : 1 - t.priceCents / n
}

export function meterOf(off: number, s: Pick<QuoteSettings, 'capPct' | 'yellowFromPct'>): Meter {
  const pct = Math.round(off * 10000) / 100
  if (pct > s.capPct) return 'red'
  if (pct >= s.yellowFromPct) return 'yellow'
  return 'green'
}

export const totalCents = (pricePerPerson: number, guests: number): number => pricePerPerson * guests
export const depositCents = (total: number, depositPct: number): number => Math.round((total * depositPct) / 100)

/** Material cost per person, or null when any line's cost is unknown. Owners only. */
export function costPerPerson(t: Pick<Tier, 'lines'>, guests: number): number | null {
  if (t.lines.some((l) => l.costCents == null)) return null
  const person = sum(t.lines.filter((l) => l.per === 'person').map((l) => l.costCents ?? 0))
  const event = sum(t.lines.filter((l) => l.per === 'event').map((l) => l.costCents ?? 0))
  return person + (event > 0 ? Math.ceil(event / Math.max(1, guests)) : 0)
}
