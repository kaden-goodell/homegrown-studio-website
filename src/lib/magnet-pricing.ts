import { shopConfig, type Delivery } from '@config/shop.config'
import { taxCents } from '@lib/tax'

export interface MagnetQuote {
  sets: number
  magnets: number
  subtotalCents: number
  taxCents: number
  shippingCents: number
  totalCents: number
}

export function isValidSets(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= shopConfig.magnets.maxSets
}

/** The only place an order's price comes from. Tax on magnets only. */
export function quoteMagnets(sets: number, delivery: Delivery): MagnetQuote {
  const m = shopConfig.magnets
  const subtotalCents = sets * m.setPriceCents
  const tax = taxCents(subtotalCents, m.taxPercent)
  const shippingCents = delivery === 'ship' ? m.shippingCents : 0
  return { sets, magnets: sets * m.setSize, subtotalCents, taxCents: tax, shippingCents, totalCents: subtotalCents + tax + shippingCents }
}
