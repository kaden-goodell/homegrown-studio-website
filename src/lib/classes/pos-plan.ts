/**
 * What a class's POS item should carry (D4): one option per sold seat price
 * and per extra, at its CURRENT price, and whether the register is behind.
 * Pure and browser-safe, so /admin can show "the register still rings the
 * early-bird price" next to its Fix button.
 */
import { sellableCells } from './validate'
import { earlyBirdCents } from './early-bird'
import type { Cents, ScheduledClass } from './types'

export interface PlannedVariation { key: string; name: string; cents: Cents }

/** Added to a seat option's POS name while its early-bird price is on. */
export const EARLY_BIRD_SUFFIX = ' (early-bird)'
export const plainName = (n: unknown): string => (typeof n === 'string' && n.endsWith(EARLY_BIRD_SUFFIX) ? n.slice(0, -EARLY_BIRD_SUFFIX.length) : String(n ?? ''))

/**
 * Every variation the POS item should carry, in a stable order. A seat cell
 * carries its CURRENT price (D4): the early-bird price while the early-bird
 * runs at `now`, the regular price otherwise, so the register rings what a
 * customer at the door is owed with nothing for the crew to adjust.
 */
export function variationPlan(cls: ScheduledClass, now: Date | null = new Date()): PlannedVariation[] {
  const c = cls.content
  const singlePass = c.passes.length === 1
  const plan: PlannedVariation[] = []
  for (const cell of sellableCells(c)) {
    const pass = c.passes.find((p) => p.id === cell.passId)!
    const ticket = c.ticketTypes.find((t) => t.id === cell.ticketTypeId)!
    // now = null: the regular prices (what a class put on the POS before D4 carries).
    const eb = now ? earlyBirdCents(c, cell.passId, cell.ticketTypeId, now) : null
    const early = eb !== null && eb < cell.cents
    const base = singlePass ? ticket.label : `${pass.label} · ${ticket.label}`
    plan.push({
      key: `${cell.passId}:${cell.ticketTypeId}`,
      // While the early-bird runs the register and the receipt read "Adult (early-bird)"; back to "Adult" after.
      name: early ? `${base}${EARLY_BIRD_SUFFIX}` : base,
      cents: early ? eb : cell.cents,
    })
  }
  for (const a of c.addOns) plan.push({ key: `addon:${a.id}`, name: `${a.label} (add-on)`, cents: a.priceCents })
  return plan
}

/**
 * D4: what each POS variation carries now, by key: the prices last sent
 * (`square.prices`), or the regular prices for a class put on the POS before
 * prices were recorded.
 */
export function posPricesNow(cls: ScheduledClass): Record<string, Cents> {
  return cls.square.prices ?? Object.fromEntries(variationPlan(cls, null).map((p) => [p.key, p.cents]))
}

/**
 * D4: the class is on the POS (open or closed, not over) and a variation's
 * price there isn't its current price: the early-bird has started (saved
 * while the POS was down) or ended since the last sync.
 */
export function posPricesStale(cls: ScheduledClass, now: Date): boolean {
  if (!cls.square.itemId || (cls.status !== 'open' && cls.status !== 'closed')) return false
  if (!cls.sessions.some((s) => Date.parse(s.endIso) > now.getTime())) return false
  const have = posPricesNow(cls)
  return variationPlan(cls, now).some((p) => have[p.key] !== p.cents)
}

