import type { LineItem } from '@providers/interfaces/payment'
import { formatMoney } from '@lib/money'

interface OrderSummaryProps {
  lineItems: LineItem[]
  total: number
  currency: string
}

export default function OrderSummary({ lineItems, total, currency }: OrderSummaryProps) {
  const money = (cents: number) => formatMoney(cents, currency || 'USD')

  return (
    <div className="rounded-lg bg-white p-4" style={{ border: '1px solid var(--color-line)' }}>
      <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--color-dark)' }}>Order summary</h3>
      <ul className="space-y-2">
        {lineItems.map((item, i) => (
          <li key={i} className="flex justify-between text-sm" style={{ color: 'var(--color-text)' }}>
            <span>
              {item.name} {item.quantity > 1 && `x${item.quantity}`}
            </span>
            <span>{money(item.pricePerUnit * item.quantity)}</span>
          </li>
        ))}
      </ul>
      <div
        className="mt-3 flex justify-between pt-3 text-base font-semibold"
        style={{ borderTop: '1px solid var(--color-line)', color: 'var(--color-dark)' }}
      >
        <span>Total</span>
        <span>{money(total)}</span>
      </div>
    </div>
  )
}
