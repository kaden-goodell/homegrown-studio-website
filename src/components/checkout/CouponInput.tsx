import { useState } from 'react'
import type { Discount } from '@providers/interfaces/payment'

interface CouponInputProps {
  onApply: (code: string, discount: Discount) => void
}

export default function CouponInput({ onApply }: CouponInputProps) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleApply() {
    if (!code.trim()) return
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/checkout/validate-coupon.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const json = await res.json()

      if (json.data?.valid) {
        setSuccess(json.data.description)
        onApply(code.trim(), json.data.discount)
      } else {
        setError(json.data?.error ?? 'Invalid coupon code')
      }
    } catch {
      setError('Failed to validate coupon')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Coupon code"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={loading || !code.trim()}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Applying...' : 'Apply'}
        </button>
      </div>
      {success && <p className="text-sm text-green-600">{success}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
