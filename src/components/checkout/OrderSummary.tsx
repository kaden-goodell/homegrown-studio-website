import type { LineItem, Discount } from '@providers/interfaces/payment'

interface OrderSummaryProps {
  lineItems: LineItem[]
  discount: Discount | null
  total: number
  currency: string
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function computeDiscountAmount(discount: Discount, subtotal: number): number {
  if (discount.type === 'percent') {
    return Math.round((subtotal * discount.value) / 100)
  }
  return discount.value
}

export default function OrderSummary({ lineItems, discount, total, currency }: OrderSummaryProps) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.pricePerUnit * item.quantity, 0)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-lg font-semibold text-gray-900">Order Summary</h3>
      <ul className="space-y-2">
        {lineItems.map((item, i) => (
          <li key={i} className="flex justify-between text-sm text-gray-700">
            <span>
              {item.name} {item.quantity > 1 && `x${item.quantity}`}
            </span>
            <span>{formatCents(item.pricePerUnit * item.quantity)}</span>
          </li>
        ))}
      </ul>
      {discount && (
        <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-sm text-green-700">
          <span>{discount.name} ({discount.type === 'percent' ? `${discount.value}%` : formatCents(discount.value)})</span>
          <span>-{formatCents(computeDiscountAmount(discount, subtotal))}</span>
        </div>
      )}
      <div className="mt-3 flex justify-between border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
        <span>Total</span>
        <span>{formatCents(total)}</span>
      </div>
    </div>
  )
}
