/**
 * Single source of truth for party pricing: $300 flat base + per-head craft cost,
 * with tiered volume discounts on the craft portion (see partyConfig.priceBreakTiers).
 * Used by the booking modal (live total), the calendar, and the server (order line items)
 * so they can never disagree.
 */
import { partyConfig } from '../config/party.config'

/** Discount % for a single guest at 1-based index `i` (guest 1, 2, 3, ...). */
function discountPctForGuestIndex(i: number): number {
  let pct = 0
  for (const tier of partyConfig.priceBreakTiers) {
    if (i >= tier.fromGuest) pct = tier.discountPct
  }
  return pct
}

export interface CraftLine {
  /** Human label, e.g. "Pottery Painting × 5" or "Pottery Painting × 10 (group rate)". */
  label: string
  qty: number
  unitCents: number
}

/**
 * Groups guests by their discounted unit price into clean line items
 * (e.g. 12 guests → "× 10 @ $35" + "× 2 @ $29.75 (group rate)").
 */
export function craftBreakdown(craftName: string, perHeadCents: number, people: number): CraftLine[] {
  const n = Math.max(0, Math.floor(people))
  const byUnit = new Map<number, number>()
  for (let i = 1; i <= n; i++) {
    const unit = Math.round(perHeadCents * (1 - discountPctForGuestIndex(i) / 100))
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + 1)
  }
  return [...byUnit.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([unitCents, qty]) => ({
      label: `${craftName} × ${qty}${unitCents < perHeadCents ? ' (group rate)' : ''}`,
      qty,
      unitCents,
    }))
}

export function craftTotalCents(perHeadCents: number, people: number): number {
  return craftBreakdown('', perHeadCents, people).reduce((s, l) => s + l.unitCents * l.qty, 0)
}

export function partyTotalCents(perHeadCents: number, people: number): number {
  return partyConfig.basePriceCents + craftTotalCents(perHeadCents, people)
}
