/**
 * Simulated-payment affordance.
 *
 * Never active in production. It needs an explicit opt-in (`DEV_BYPASS_PAYMENT=true`)
 * AND a non-production runtime:
 *  - `astro dev` (`import.meta.env.DEV`), or
 *  - a Netlify deploy preview / branch deploy (`CONTEXT` = 'deploy-preview' | 'branch-deploy').
 * `CONTEXT=production` always wins, and an unknown runtime (no CONTEXT, not DEV)
 * never simulates: it fails safe to real payments.
 */

function read(name: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined
  if (fromProcess !== undefined) return fromProcess
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  const fromMeta = metaEnv[name]
  return fromMeta === undefined ? undefined : String(fromMeta)
}

function isDevServer(): boolean {
  const metaEnv: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}
  // Astro exposes a boolean; some runners expose the string form.
  return metaEnv.DEV === true || metaEnv.DEV === 'true'
}

/**
 * When on, the payment step is skipped end-to-end so booking flows can be
 * exercised without a real card or a live Square charge:
 *  - client-config serves a mock app id → PaymentForm renders its mock path
 *  - booking endpoints return a synthetic success without touching Square
 *
 * Locally: add `DEV_BYPASS_PAYMENT=true` to `.env` and run `npm run dev`.
 * On the `dev` branch preview: set `DEV_BYPASS_PAYMENT=true` for the
 * deploy-preview / branch-deploy contexts only (never the production context).
 */
export function paymentBypassEnabled(): boolean {
  return bypassDecision({
    flag: read('DEV_BYPASS_PAYMENT'),
    context: read('CONTEXT'),
    dev: isDevServer(),
  })
}

/** The rule itself, with its inputs passed in so it can be tested exhaustively. */
export function bypassDecision(input: { flag?: string; context?: string; dev: boolean }): boolean {
  if (input.flag !== 'true') return false
  if (input.context === 'production') return false
  return input.dev || input.context === 'deploy-preview' || input.context === 'branch-deploy'
}
