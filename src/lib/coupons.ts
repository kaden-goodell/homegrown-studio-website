import couponsData from '@config/coupons.json'

interface CouponEntry {
  type: 'percent' | 'fixed'
  value: number
  description: string
  active: boolean
  expiresAt: string | null
}

type CouponResult =
  | { valid: true; description: string; discount: { name: string; type: 'percent' | 'fixed'; value: number; scope: 'order' } }
  | { valid: false; error: string }

const coupons = couponsData as Record<string, CouponEntry>

export function validateCoupon(code: string): CouponResult {
  const upper = code.toUpperCase()
  const entry = coupons[upper]

  if (!entry) {
    return { valid: false, error: 'Invalid coupon code' }
  }

  if (!entry.active) {
    return { valid: false, error: 'Coupon is no longer active' }
  }

  if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    return { valid: false, error: 'Coupon has expired' }
  }

  return {
    valid: true,
    description: entry.description,
    discount: {
      name: upper,
      type: entry.type,
      value: entry.value,
      scope: 'order',
    },
  }
}
