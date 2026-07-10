/**
 * Dev-only affordances.
 *
 * Every flag here is double-gated: it needs `import.meta.env.DEV` (true only
 * under `astro dev`, always false in a production `astro build`) AND an
 * explicit opt-in env var. These cannot activate on the deployed site even if
 * the env var is set there.
 */

const env: any = (typeof import.meta !== 'undefined' && (import.meta as any).env) || {}

/**
 * When on, the payment step is skipped end-to-end so booking flows can be
 * exercised locally without a real card or a live Square charge:
 *  - client-config serves a mock app id → PaymentForm renders its mock path
 *  - booking endpoints return a synthetic success without touching Square
 *
 * Enable by adding `DEV_BYPASS_PAYMENT=true` to `.env` and running `npm run dev`.
 */
export function paymentBypassEnabled(): boolean {
  return Boolean(env.DEV) && env.DEV_BYPASS_PAYMENT === 'true'
}
