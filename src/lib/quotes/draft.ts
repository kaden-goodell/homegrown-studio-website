/**
 * The first draft of a quote: a target price per person from the budget, and
 * up to three packages around it (Simple 80%, Our pick 100%, All out 130%),
 * each filled with as much normal value as the discount cap allows.
 */
import {
  BUDGET_MIDPOINT_CENTS, TIER_FACTORS, TIER_NAMES,
  type Crafters, type MenuItem, type QuoteLine, type QuoteSettings, type Tier,
} from './types'
import { normalPerPerson } from './money'

const toDollar = (c: number) => Math.round(c / 100) * 100

/** Budget midpoint ÷ guests, rounded to the dollar; null with no budget. */
export function targetFor(budget: string, guests: number): number | null {
  const mid = BUDGET_MIDPOINT_CENTS[budget]
  return mid && guests > 0 ? toDollar(mid / guests) : null
}

export function tierPrices(target: number): { simple: number; pick: number; all: number } {
  return {
    simple: toDollar(target * TIER_FACTORS.simple),
    pick: toDollar(target * TIER_FACTORS.pick),
    all: toDollar(target * TIER_FACTORS.all),
  }
}

export interface DraftInput {
  menu: MenuItem[]
  targetCents: number
  guests: number
  crafters: Crafters
  /** 1..12 */
  month: number
  theme: string
}

function score(i: MenuItem, d: DraftInput): number {
  let s = 0
  if (d.crafters !== 'both' && i.tags.includes(d.crafters)) s += 3
  if (d.crafters === 'both' && (i.tags.includes('kids') || i.tags.includes('adults'))) s += 1
  if ((d.month === 11 || d.month === 12) && i.tags.includes('holiday')) s += 2
  const words = d.theme.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  if (words.some((w) => i.name.toLowerCase().includes(w) || i.tags.includes(w))) s += 2
  if (d.crafters === 'adults' && i.tags.includes('kids') && !i.tags.includes('adults')) s -= 3
  if (d.crafters === 'kids' && i.tags.includes('adults') && !i.tags.includes('kids')) s -= 3
  return s
}

export const lineOf = (i: MenuItem): QuoteLine => ({
  itemId: i.id, label: i.name, photoUrl: i.photoUrl, cents: i.cents, per: i.per, costCents: i.costCents,
})

/** Best-matching items while normal per person stays within price ÷ (1 − cap). */
export function fillTier(price: number, d: DraftInput, s: Pick<QuoteSettings, 'capPct'>): QuoteLine[] {
  const ceiling = Math.floor(price / (1 - s.capPct / 100))
  const pool = d.menu
    .filter((i) => !i.hidden && !i.gone && i.cents > 0)
    .sort((a, b) => score(b, d) - score(a, d) || b.cents - a.cents)
  const lines: QuoteLine[] = []
  for (const i of pool) {
    if (normalPerPerson({ lines: [...lines, lineOf(i)] }, d.guests) <= ceiling) lines.push(lineOf(i))
  }
  return lines
}

let seq = 0
const tierId = (key: string) => `tier_${key}_${Date.now().toString(36)}${(seq++).toString(36)}`

export function draftTiers(d: DraftInput, s: Pick<QuoteSettings, 'capPct'>): Tier[] {
  const prices = tierPrices(d.targetCents)
  return (['simple', 'pick', 'all'] as const).flatMap((key) => {
    const lines = fillTier(prices[key], d, s)
    if (!lines.length) return []
    const tier: Tier = {
      id: tierId(key), key, name: TIER_NAMES[key],
      photoUrl: lines.find((l) => l.photoUrl)?.photoUrl ?? null,
      hidden: false, lines, priceCents: prices[key],
    }
    return [tier]
  })
}
