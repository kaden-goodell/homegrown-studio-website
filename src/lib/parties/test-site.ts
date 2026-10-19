/**
 * R41 for parties: a test site (a Netlify deploy preview or branch deploy)
 * with no STORE_NAMESPACE shares the live site's stores. A party hold made
 * there would take a real party time from customers, so every party booking
 * write (card, link or simulated) is refused there.
 *
 * Allowed: production, local dev (not on Netlify), and any deploy with its
 * own STORE_NAMESPACE. On Netlify, a deploy whose context can't be told is
 * treated as a test site (fail safe). Same rule as the class guard (stage 1).
 *
 * Server only.
 */
import { deployContext, type DeployContext } from '@lib/deploy-context'

export const NO_TEST_STORE = 'This test site has no store of its own. Set STORE_NAMESPACE first.'

/** The rule, with its inputs passed in: the refusal, or null when writes may go ahead. */
export function partyTestSiteRefusal(input: { context: DeployContext; namespace?: string | null; onNetlify?: boolean }): string | null {
  if ((input.namespace ?? '').trim()) return null
  if (input.context === 'production' || input.context === 'dev') return null
  if (input.context === 'deploy-preview' || input.context === 'branch-deploy') return NO_TEST_STORE
  return input.onNetlify ? NO_TEST_STORE : null
}

/** This deploy's refusal for party writes, or null. */
export function partyWritesRefusal(request?: Request): string | null {
  return partyTestSiteRefusal({
    context: deployContext(request),
    namespace: process.env.STORE_NAMESPACE,
    onNetlify: process.env.NETLIFY === 'true',
  })
}
