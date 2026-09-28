import { PAYMENT_FORM_UNAVAILABLE } from '@lib/checkout-messages'
import {
  createElement,
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
  /** When set, offer Apple Pay / Google Pay for this amount (dollars, e.g. "200.00").
   *  Wallets render only where the browser/device/domain supports them.
   *  `bnpl: true` additionally offers Afterpay (pay-in-4) — big-ticket flows
   *  (parties, kits); skip it for small amounts where pay-in-4 is noise. */
  wallet?: { amount: string; label: string; bnpl?: boolean }
  /** Called with the payment token when a wallet (Apple/Google Pay) tokenizes. */
  onWalletToken?: (token: string) => void
  /** Pre-flight check before opening a wallet sheet. Return an error message to
   *  block (shown to the user), or null to proceed — prevents "approve in the
   *  wallet, then hit a form validation error" whiplash. */
  canPayWithWallet?: () => string | null
  /** Told when the card field becomes usable (or stops being), so the panel
   *  never offers Pay before there is a card field to pay with. */
  onReadyChange?: (ready: boolean) => void
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

/**
 * Apple's Apple Pay JS SDK does two jobs: it provides ApplePaySession in
 * NON-Safari browsers (desktop Chrome/Edge get a "scan with iPhone" QR flow,
 * iOS 18+ third-party browsers get the native sheet), and it registers the
 * <apple-pay-button> custom element — the only way the button renders
 * correctly across ALL browsers (Blink ignores -webkit-appearance:
 * -apple-pay-button, leaving a hand-rolled button invisible). Load it always.
 */
const APPLE_PAY_JS_SDK = 'https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js'

function loadApplePaySdk(): Promise<void> {
  const existing = document.querySelector(`script[src="${APPLE_PAY_JS_SDK}"]`)
  if (existing) return Promise.resolve()
  return new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = APPLE_PAY_JS_SDK
    script.crossOrigin = 'anonymous'
    // Resolve either way — a failed load just means Apple Pay stays unavailable.
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
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

type WalletInstance = {
  tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>
  attach?: (container: string | HTMLElement) => Promise<void>
  destroy?: () => Promise<void>
}

const PaymentForm = forwardRef<PaymentFormRef, PaymentFormProps>(
  function PaymentForm({ applicationIdOverride, environmentOverride, wallet, onWalletToken, canPayWithWallet, onReadyChange }: PaymentFormProps, ref) {
    const [config, setConfig] = useState<ClientConfig | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [sdkReady, setSdkReady] = useState(false)
    const [applePayReady, setApplePayReady] = useState(false)
    const [googlePayReady, setGooglePayReady] = useState(false)
    const [afterpayReady, setAfterpayReady] = useState(false)
    const [walletError, setWalletError] = useState<string | null>(null)
    // Bumped by "Try again" to run the whole set-up once more.
    const [attempt, setAttempt] = useState(0)

    const cardRef = useRef<CardInstance | null>(null)
    const applePayRef = useRef<WalletInstance | null>(null)
    const googlePayRef = useRef<WalletInstance | null>(null)
    const afterpayRef = useRef<WalletInstance | null>(null)
    const googlePayContainerRef = useRef<HTMLDivElement>(null)
    const afterpayContainerRef = useRef<HTMLDivElement>(null)
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
    }, [attempt])

    // Load Square SDK and initialize card when config is available and not mock
    const effectiveEnvironment = environmentOverride || config?.environment || 'sandbox'

    useEffect(() => {
      if (!config || isMockMode) return

      let cancelled = false

      async function initSquare() {
        try {
          await loadSquareScript(effectiveEnvironment)

          if (cancelled) return

          const Square = (window as any).Square
          if (!Square) {
            throw new Error('Square SDK not available after script load')
          }

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

          // Wallets are strictly additive — any failure (unsupported browser,
          // unregistered domain, http localhost) silently leaves card-only.
          if (wallet) {
            let paymentRequest: any = null
            try {
              paymentRequest = payments.paymentRequest({
                countryCode: 'US',
                currencyCode: 'USD',
                total: { amount: wallet.amount, label: wallet.label },
              })
            } catch (err) {
            }

            if (paymentRequest) {
              try {
                await loadApplePaySdk()
                const applePay = await payments.applePay(paymentRequest)
                if (cancelled) {
                  applePay.destroy?.().catch?.(() => {})
                } else {
                  applePayRef.current = applePay
                  setApplePayReady(true)
                }
              } catch (err) {
              }

              try {
                const googlePay = await payments.googlePay(paymentRequest)
                if (cancelled) {
                  googlePay.destroy?.().catch?.(() => {})
                } else if (googlePayContainerRef.current) {
                  await googlePay.attach(googlePayContainerRef.current, { buttonSizeMode: 'fill' })
                  googlePayRef.current = googlePay
                  setGooglePayReady(true)
                }
              } catch (err) {
              }
            }

            // Afterpay (pay-in-4) — needs its own paymentRequest and an
            // Afterpay-enabled Square account; failures just hide the button.
            if (wallet.bnpl) {
              try {
                const afterpayRequest = payments.paymentRequest({
                  countryCode: 'US',
                  currencyCode: 'USD',
                  total: { amount: wallet.amount, label: wallet.label },
                  requestShippingContact: false,
                })
                const afterpay = await payments.afterpayClearpay(afterpayRequest)
                if (cancelled) {
                  afterpay.destroy?.().catch?.(() => {})
                } else if (afterpayContainerRef.current) {
                  await afterpay.attach(afterpayContainerRef.current)
                  afterpayRef.current = afterpay
                  setAfterpayReady(true)
                }
              } catch (err) {
              }
            }
          }
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
        for (const walletRef of [applePayRef, googlePayRef, afterpayRef]) {
          if (walletRef.current) {
            walletRef.current.destroy?.()?.catch?.(() => {})
            walletRef.current = null
          }
        }
      }
    }, [config, isMockMode, effectiveEnvironment, attempt])

    // The panel's Pay button waits on this. The stand-in form used in local
    // development has no card field to wait for.
    const ready = !loading && !error && (isMockMode ? !!config || !!applicationIdOverride : sdkReady)
    useEffect(() => {
      onReadyChange?.(ready)
    }, [ready])

    async function tokenizeWallet(instance: WalletInstance | null, name: string) {
      if (!instance || !onWalletToken) return
      const blocker = canPayWithWallet?.()
      if (blocker) {
        setWalletError(blocker)
        return
      }
      setWalletError(null)
      try {
        const result = await instance.tokenize()
        if (result.status === 'OK' && result.token) {
          onWalletToken(result.token)
          return
        }
        // "Cancel" means the user closed the wallet sheet — not an error worth showing.
        if (result.status !== 'CANCEL') {
          setWalletError(result.errors?.map((e) => e.message).join(', ') ?? `${name} payment failed.`)
        }
      } catch (err) {
        setWalletError(err instanceof Error ? err.message : `${name} payment failed.`)
      }
    }

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

    const tokenizeAndVerify = useCallback(async (buyerDetails: VerifyBuyerDetails): Promise<TokenizeResult> => {
      const token = await tokenize()

      if (isMockMode || !paymentsRef.current) {
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
      try {
        const verificationResult = await paymentsRef.current.verifyBuyer(token, verifyDetails)

        if (!verificationResult?.token) {
          throw new Error('Card verification failed. Please try again.')
        }

        return { token, verificationToken: verificationResult.token }
      } catch (err) {
        throw err
      }
    }, [tokenize, isMockMode])

    useImperativeHandle(ref, () => ({ tokenize, tokenizeAndVerify }), [tokenize, tokenizeAndVerify])

    if (loading) {
      return (
        <div className="space-y-3" role="group" aria-label="Payment">
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-400">
            Loading payment form...
          </div>
        </div>
      )
    }

    if (error) {
      // `error` holds the technical reason; the customer gets a plain sentence
      // and a way to try again.
      return (
        <div role="alert" style={{ borderRadius: '0.75rem', border: '1px solid var(--color-error)', background: 'var(--color-surface)', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
          <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-dark)' }}>{PAYMENT_FORM_UNAVAILABLE}</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setError(null)
              setLoading(true)
              setSdkReady(false)
              setAttempt((n) => n + 1)
            }}
          >
            Try again
          </button>
        </div>
      )
    }

    if (isMockMode) {
      return (
        <div className="space-y-3" role="group" aria-label="Payment">
          {/* Local development only. The badge sits inside the stand-in card
              field it describes; the step around it is already titled Payment. */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            <span>Card number placeholder (Square Web Payments SDK)</span>
            <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
              Test mode
            </span>
          </div>
        </div>
      )
    }

    const anyWalletReady = applePayReady || googlePayReady || afterpayReady

    return (
      <div className="space-y-3" role="group" aria-label="Payment">
        {applePayReady && (
          <>
            {/* Apple's <apple-pay-button> custom element (registered by
                apple-pay-sdk.js) renders the official button in EVERY browser —
                including Blink, where -webkit-appearance is ignored. */}
            <style>{`
              apple-pay-button {
                --apple-pay-button-width: 100%;
                --apple-pay-button-height: 44px;
                --apple-pay-button-border-radius: 0.5rem;
                --apple-pay-button-padding: 0px;
                --apple-pay-button-box-sizing: border-box;
                display: block;
                width: 100%;
                cursor: pointer;
              }
            `}</style>
            {createElement('apple-pay-button', {
              buttonstyle: 'black',
              type: 'pay',
              locale: 'en-US',
              role: 'button',
              'aria-label': 'Pay with Apple Pay',
              onClick: () => tokenizeWallet(applePayRef.current, 'Apple Pay'),
            })}
          </>
        )}
        {/* Google Pay / Afterpay attach into these divs during init — they must always exist. */}
        <div
          ref={googlePayContainerRef}
          onClick={() => googlePayReady && tokenizeWallet(googlePayRef.current, 'Google Pay')}
          style={{ display: googlePayReady ? 'block' : 'none', minHeight: googlePayReady ? '44px' : 0, cursor: 'pointer' }}
        />
        <div
          ref={afterpayContainerRef}
          onClick={() => afterpayReady && tokenizeWallet(afterpayRef.current, 'Afterpay')}
          style={{ display: afterpayReady ? 'block' : 'none', minHeight: afterpayReady ? '44px' : 0, cursor: 'pointer', marginTop: afterpayReady ? '0.5rem' : 0 }}
        />
        {walletError && <div className="text-sm text-red-700">{walletError}</div>}
        {anyWalletReady && (
          <div className="flex items-center gap-3" aria-hidden="true">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-400">or pay with card</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>
        )}

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
