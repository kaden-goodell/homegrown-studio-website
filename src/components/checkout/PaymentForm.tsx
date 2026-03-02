import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

export interface PaymentFormRef {
  tokenize: () => Promise<string>
}

interface PaymentFormProps {}

interface ClientConfig {
  appId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

type CardInstance = {
  attach: (container: string | HTMLElement) => Promise<void>
  tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>
  destroy: () => Promise<void>
}

const SQUARE_CDN: Record<string, string> = {
  sandbox: 'https://sandbox.web.squarecdn.com/v1/square.js',
  production: 'https://web.squarecdn.com/v1/square.js',
}

function loadSquareScript(environment: string): Promise<void> {
  const url = SQUARE_CDN[environment] ?? SQUARE_CDN.sandbox

  // Already loaded
  if (document.querySelector(`script[src="${url}"]`)) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load Square SDK from ${url}`))
    document.head.appendChild(script)
  })
}

const PaymentForm = forwardRef<PaymentFormRef, PaymentFormProps>(
  function PaymentForm(_props, ref) {
    const [config, setConfig] = useState<ClientConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [sdkReady, setSdkReady] = useState(false)

    const cardRef = useRef<CardInstance | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const isMockMode = !config?.appId || config.appId === '' || config.appId.startsWith('mock-')

    // Fetch client config on mount
    useEffect(() => {
      let cancelled = false

      async function fetchConfig() {
        try {
          const res = await fetch('/api/checkout/client-config.json')
          if (!res.ok) {
            throw new Error(`Config fetch failed: ${res.status}`)
          }
          const json = await res.json()
          if (!cancelled) {
            setConfig(json.data as ClientConfig)
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to load payment config')
          }
        } finally {
          if (!cancelled) {
            setLoading(false)
          }
        }
      }

      fetchConfig()
      return () => {
        cancelled = true
      }
    }, [])

    // Load Square SDK and initialize card when config is available and not mock
    useEffect(() => {
      if (!config || isMockMode) return

      let cancelled = false

      async function initSquare() {
        try {
          await loadSquareScript(config!.environment)

          if (cancelled) return

          const Square = (window as any).Square
          if (!Square) {
            throw new Error('Square SDK not available after script load')
          }

          const payments = Square.payments(config!.appId, config!.locationId)
          const card = await payments.card()

          if (cancelled) {
            await card.destroy()
            return
          }

          if (containerRef.current) {
            await card.attach(containerRef.current)
          }

          cardRef.current = card
          setSdkReady(true)
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to initialize payment SDK')
          }
        }
      }

      initSquare()

      return () => {
        cancelled = true
        if (cardRef.current) {
          cardRef.current.destroy().catch(() => {})
          cardRef.current = null
        }
      }
    }, [config, isMockMode])

    const tokenize = useCallback(async (): Promise<string> => {
      if (isMockMode) {
        return 'mock-payment-token'
      }

      const card = cardRef.current
      if (!card) {
        throw new Error('Payment card not initialized')
      }

      const result = await card.tokenize()

      if (result.status === 'OK' && result.token) {
        return result.token
      }

      const messages = result.errors?.map((e) => e.message).join(', ') ?? 'Tokenization failed'
      throw new Error(messages)
    }, [isMockMode])

    useImperativeHandle(ref, () => ({ tokenize }), [tokenize])

    if (loading) {
      return (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">Payment</h3>
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-400">
            Loading payment form...
          </div>
        </div>
      )
    }

    if (error) {
      return (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">Payment</h3>
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        </div>
      )
    }

    if (isMockMode) {
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
    }

    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Payment</h3>
        <div
          ref={containerRef}
          id="card-container"
          className="min-h-[44px] rounded-md border border-gray-300"
        />
        {!sdkReady && (
          <div className="text-sm text-gray-400">Initializing payment form...</div>
        )}
      </div>
    )
  },
)

export default PaymentForm
