/**
 * Simulated-payment affordance.
 *
 * Never active in production. It needs an explicit opt-in (`DEV_BYPASS_PAYMENT=true`)
 * AND `isPreviewOrDev()` (local dev, or a Netlify deploy preview / branch deploy;
 * see deploy-context.ts). Production and unknown runtimes never simulate.
 */
import { isPreviewOrDev } from '@lib/deploy-context'

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
  return bypassDecision({ flag: process.env.DEV_BYPASS_PAYMENT ?? (import.meta as any).env?.DEV_BYPASS_PAYMENT, simulatedAllowed: isPreviewOrDev() })
}

/** The rule itself, with its inputs passed in so it can be tested exhaustively. */
export function bypassDecision(input: { flag?: string; simulatedAllowed: boolean }): boolean {
  return input.flag === 'true' && input.simulatedAllowed
}
