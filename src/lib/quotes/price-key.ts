/**
 * A short fingerprint of what the customer is paying for. The customer page
 * sends it back with a payment; a different fingerprint means the owner
 * changed the price meanwhile, so nothing is charged. Notes and photos don't
 * count. Server only (node:crypto).
 */
import { createHash } from 'node:crypto'
import type { Quote } from './types'

export function priceKey(q: Pick<Quote, 'tiers' | 'guests' | 'depositPct' | 'startIso' | 'place'>): string {
  const visible = q.tiers
    .filter((t) => !t.hidden)
    .map((t) => [t.id, t.priceCents, t.lines.map((l) => [l.label, l.cents, l.per])])
  return createHash('sha256')
    .update(JSON.stringify([visible, q.guests, q.depositPct, q.startIso, q.place]))
    .digest('hex')
    .slice(0, 16)
}
