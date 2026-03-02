import { forwardRef, useImperativeHandle } from 'react'

export interface PaymentFormRef {
  tokenize: () => Promise<string>
}

interface PaymentFormProps {}

const PaymentForm = forwardRef<PaymentFormRef, PaymentFormProps>(function PaymentForm(_props, ref) {
  useImperativeHandle(ref, () => ({
    tokenize: () => Promise.resolve('mock-payment-token'),
  }))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-900">Payment</h3>
        <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
          Test Mode
        </span>
      </div>
      <div className="rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        Card number placeholder (Square Web Payments SDK)
      </div>
    </div>
  )
})

export default PaymentForm
