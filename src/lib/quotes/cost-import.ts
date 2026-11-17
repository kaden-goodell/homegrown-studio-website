/**
 * Café material costs onto the quote menu (S-45): names in
 * `scripts/data/cafe-costs.json` (exported from the café pricing artifact)
 * matched to menu items by normalized name. Fills only unknown costs; never
 * overwrites one an owner set. Pure.
 */
import type { MenuItem } from './types'

export interface CafeCosts { items: { name: string; costCents: number }[] }

/** Lowercase, punctuation gone, spaces collapsed: "Terrarium · .5 Gallon" = "Terrarium (.5 Gallon)". */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function applyCafeCosts(items: MenuItem[], costs: CafeCosts): MenuItem[] {
  const byName = new Map<string, number>()
  for (const c of costs.items) {
    if (typeof c.costCents === 'number' && Number.isFinite(c.costCents)) byName.set(normalizeName(c.name), c.costCents)
  }
  return items.map((i) => {
    if (i.costCents != null) return i
    const cost = byName.get(normalizeName(i.name))
    return cost === undefined ? i : { ...i, costCents: cost }
  })
}
