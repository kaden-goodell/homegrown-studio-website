// src/lib/magnet-status.ts
/** Client-safe pieces of magnet orders (no node imports): the admin UI imports this. */
import type { Delivery, ShopProduct } from '@config/shop.config'

export const STATUSES = ['new', 'made', 'ready', 'shipped', 'picked_up', 'cancelled'] as const
export type MagnetStatus = (typeof STATUSES)[number]
export const STATUS_LABEL: Record<MagnetStatus, string> = {
  new: 'New', made: 'Made', ready: 'Ready for pickup', shipped: 'Shipped', picked_up: 'Picked up', cancelled: 'Cancelled',
}
export const DONE_STATUSES: MagnetStatus[] = ['shipped', 'picked_up', 'cancelled']
export const PICKUP_STATUSES: MagnetStatus[] = ['new', 'made', 'ready', 'picked_up', 'cancelled']
export const SHIP_STATUSES: MagnetStatus[] = ['new', 'made', 'shipped', 'cancelled']

export interface MagnetOrder {
  id: string
  createdAt: string
  status: MagnetStatus
  /** Missing on orders from before silhouettes (2026-11-10): those are magnets. */
  product?: ShopProduct
  draftId: string
  /** Magnets: sets of 6. Silhouettes: how many silhouettes. */
  sets: number
  /** One finished image id per item, in print order (a magnet photo, or a whole 2×3 silhouette print); repeats allowed for magnets. */
  magnets: string[]
  delivery: Delivery
  address: string | null
  contact: { name: string; email: string; phone: string }
  amounts: { subtotalCents: number; taxCents: number; shippingCents: number; totalCents: number }
  squareOrderId: string
  paymentId: string
  receiptUrl: string | null
  simulated?: boolean
  doneAt: string | null
  photosDeletedAt: string | null
  /** Customer emails already sent, by status → ISO time. */
  emailed: Partial<Record<'ready' | 'shipped', string>>
}

export const productOf = (o: Pick<MagnetOrder, 'product'>): ShopProduct => o.product ?? 'magnets'
/** "6 magnets", "1 silhouette", "2 silhouettes". */
export function itemsLabel(o: Pick<MagnetOrder, 'product' | 'magnets'>): string {
  const n = o.magnets.length
  return productOf(o) === 'silhouettes' ? `${n} silhouette${n === 1 ? '' : 's'}` : `${n} magnets`
}
