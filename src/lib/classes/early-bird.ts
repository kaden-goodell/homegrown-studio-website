/**
 * Early-bird prices (stage 4, OWNER-S4-7): one last day per class, a lower
 * price per price cell, working to the end of that Chicago day. Codes stack
 * on top (pricing.ts).
 *
 * Pure and browser-safe.
 */
import { formatMoney } from '@lib/money'
import { onOrBeforeDay, shortDay } from './chicago-day'
import type { Cents, ClassContent, EarlyBird } from './types'

/** Said when Run it again (or Schedule it) copies details whose early-bird has passed. */
export const EARLY_BIRD_ENDED = 'Early-bird ended, so it was left off.'

export function earlyBirdRunning(c: Pick<ClassContent, 'earlyBird'>, now: Date): boolean {
  return !!c.earlyBird && onOrBeforeDay(c.earlyBird.untilYmd, now)
}

/** The early-bird price of one cell while it runs; null when there is none. */
export function earlyBirdCents(c: Pick<ClassContent, 'earlyBird'>, passId: string, ticketTypeId: string, now: Date): Cents | null {
  if (!earlyBirdRunning(c, now)) return null
  return c.earlyBird!.prices[passId]?.[ticketTypeId] ?? null
}

/**
 * "Early-bird $15 until Fri Oct 30"; "Early-bird $16 adult · $12 kid until
 * Fri Oct 30" (a class with one pass, up to three cells); "Early-bird from
 * $7 until Fri Oct 30" otherwise. '' when there is none (whether it still runs is the
 * caller's: the public view only sends a running one).
 */
export function earlyBirdLabel(
  c: { earlyBird?: EarlyBird | null; ticketTypes: { id: string; label: string }[]; passes?: { id: string }[] }, currency = 'USD',
): string {
  const eb = c.earlyBird
  if (!eb) return ''
  const cells = Object.entries(eb.prices).flatMap(([passId, row]) => Object.entries(row).map(([tid, cents]) => ({ passId, tid, cents })))
  if (!cells.length) return ''
  const until = `until ${shortDay(eb.untilYmd)}`
  // A class with several passes reads "from": its other passes have prices of their own.
  const passes = new Set([...cells.map((x) => x.passId), ...((c.passes?.length ?? 0) > 1 ? ['*'] : [])])
  const distinct = new Set(cells.map((x) => x.cents))
  if (passes.size === 1 && distinct.size === 1) return `Early-bird ${formatMoney(cells[0].cents, currency)} ${until}`
  if (passes.size === 1 && cells.length <= 3) {
    const order = (tid: string) => c.ticketTypes.findIndex((t) => t.id === tid)
    const each = [...cells].sort((a, b) => order(a.tid) - order(b.tid))
      .map((x) => `${formatMoney(x.cents, currency)} ${(c.ticketTypes.find((t) => t.id === x.tid)?.label ?? x.tid).toLowerCase()}`)
    return `Early-bird ${each.join(' · ')} ${until}`
  }
  return `Early-bird from ${formatMoney(Math.min(...distinct), currency)} ${until}`
}

/** Copying details for a new date: an early-bird whose last day has passed is left off, with the note to show. */
export function dropEndedEarlyBird(content: ClassContent, now: Date): { content: ClassContent; note: string | null } {
  if (!content.earlyBird || onOrBeforeDay(content.earlyBird.untilYmd, now)) return { content, note: null }
  const { earlyBird: _gone, ...rest } = content
  return { content: rest, note: EARLY_BIRD_ENDED }
}
