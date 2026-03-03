import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

export interface VerifyBuyerDetails {
  givenName?: string
  familyName?: string
  email?: string
  phone?: string
  /** Total in dollars (e.g. "25.00") — required for CHARGE intent */
  amount?: string
  currencyCode?: string
}

export interface TokenizeResult {
  token: string
  verificationToken?: string
}

export interface PaymentFormRef {
  tokenize: () => Promise<string>
  tokenizeAndVerify: (buyerDetails: VerifyBuyerDetails) => Promise<TokenizeResult>
}

interface PaymentFormProps {
  /** Override the application ID used for the Web Payments SDK */
  applicationIdOverride?: string
  /** Override the SDK environment (forces production/sandbox SDK script). Useful when
   *  the payment endpoint lives on a different environment than your merchant config. */
  environmentOverride?: 'sandbox' | 'production'
}

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
  function PaymentForm({ applicationIdOverride, environmentOverride }: PaymentFormProps, ref) {
    const [config, setConfig] = useState<ClientConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [sdkReady, setSdkReady] = useState(false)

    const cardRef = useRef<CardInstance | null>(null)
    const paymentsRef = useRef<any>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    const effectiveAppId = applicationIdOverride || config?.appId
    const isMockMode = !effectiveAppId || effectiveAppId === '' || effectiveAppId.startsWith('mock-')

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
    const effectiveEnvironment = environmentOverride || config?.environment || 'sandbox'

    useEffect(() => {
      if (!config || isMockMode) return

      let cancelled = false

      async function initSquare() {
        try {
          console.log('[PaymentForm] initSquare', { effectiveAppId, locationId: config!.locationId, environment: effectiveEnvironment })
          await loadSquareScript(effectiveEnvironment)

          if (cancelled) return

          const Square = (window as any).Square
          if (!Square) {
            throw new Error('Square SDK not available after script load')
          }

          console.log('[PaymentForm] Square.payments()', { appId: effectiveAppId, locationId: config!.locationId })
          const payments = Square.payments(effectiveAppId, config!.locationId)
          paymentsRef.current = payments
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
    }, [config, isMockMode, effectiveEnvironment])

    const tokenize = useCallback(async (): Promise<string> => {
      if (isMockMode) {
        return 'mock-payment-token'
      }

      const card = cardRef.current
      if (!card) {
        throw new Error('Payment card not initialized')
      }

      console.log('[PaymentForm] tokenize() calling card.tokenize()')
      const result = await card.tokenize()
      console.log('[PaymentForm] tokenize() result:', { status: result.status, hasToken: !!result.token, tokenPrefix: result.token?.substring(0, 20), errors: result.errors })

      if (result.status === 'OK' && result.token) {
        return result.token
      }

      const messages = result.errors?.map((e) => e.message).join(', ') ?? 'Tokenization failed'
      throw new Error(messages)
    }, [isMockMode])

    const tokenizeAndVerify = useCallback(async (buyerDetails: VerifyBuyerDetails): Promise<TokenizeResult> => {
      const token = await tokenize()

      if (isMockMode || !paymentsRef.current) {
        console.log('[PaymentForm] skipping verifyBuyer (mock or no payments)', { isMockMode, hasPayments: !!paymentsRef.current })
        return { token }
      }

      const verifyDetails: any = {
        intent: 'CHARGE',
        amount: buyerDetails.amount || '0.00',
        currencyCode: buyerDetails.currencyCode || 'USD',
        billingContact: {
          givenName: buyerDetails.givenName,
          familyName: buyerDetails.familyName,
          email: buyerDetails.email,
          phone: buyerDetails.phone,
        },
      }
      console.log('[PaymentForm] verifyBuyer() calling with:', { tokenPrefix: token.substring(0, 20), ...verifyDetails })
      try {
        const verificationResult = await paymentsRef.current.verifyBuyer(token, verifyDetails)
        console.log('[PaymentForm] verifyBuyer() result:', { hasToken: !!verificationResult?.token, tokenPrefix: verificationResult?.token?.substring(0, 20) })

        if (!verificationResult?.token) {
          throw new Error('Card verification failed. Please try again.')
        }

        return { token, verificationToken: verificationResult.token }
      } catch (err) {
        console.error('[PaymentForm] verifyBuyer() error:', err)
        throw err
      }
    }, [tokenize, isMockMode])

    useImperativeHandle(ref, () => ({ tokenize, tokenizeAndVerify }), [tokenize, tokenizeAndVerify])

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
