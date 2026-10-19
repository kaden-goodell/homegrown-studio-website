/**
 * R41: a test site (a Netlify deploy preview or branch deploy) with no
 * STORE_NAMESPACE shares the live site's stores and its Square. On such a
 * site these writes are refused: class bookings (seats), simulated payments,
 * classes and their POS sync, the class library, blocked time, studio
 * settings (café hours, closed days) and To decide decisions. So nothing a
 * test does can land in the live records or the live POS.
 *
 * Allowed: production, local dev (not on Netlify), and any deploy with its
 * own STORE_NAMESPACE. On Netlify, a deploy whose context can't be told is
 * treated as NOT production for writes (fail safe).
 */
import { deployContext, type DeployContext } from '@lib/deploy-context'

export const NO_TEST_STORE = 'This test site has no store of its own. Set STORE_NAMESPACE first.'

export class TestSiteStoreError extends Error {
  constructor() {
    super(NO_TEST_STORE)
    this.name = 'TestSiteStoreError'
  }
}

/** The rule, with its inputs passed in: the refusal, or null when writes may go ahead. */
export function testSiteRefusal(input: { context: DeployContext; namespace?: string | null; onNetlify?: boolean }): string | null {
  if ((input.namespace ?? '').trim()) return null
  if (input.context === 'production' || input.context === 'dev') return null
  // A preview or branch deploy; or on Netlify with no way to tell which deploy this is.
  if (input.context === 'deploy-preview' || input.context === 'branch-deploy') return NO_TEST_STORE
  return input.onNetlify ? NO_TEST_STORE : null
}

/** This deploy's refusal, or null. */
export function classWritesRefusal(request?: Request): string | null {
  return testSiteRefusal({
    context: deployContext(request),
    namespace: process.env.STORE_NAMESPACE,
    onNetlify: process.env.NETLIFY === 'true',
  })
}

/** Throws TestSiteStoreError on a test site with no store of its own. */
export function assertClassWritesAllowed(request?: Request): void {
  if (classWritesRefusal(request)) throw new TestSiteStoreError()
}
