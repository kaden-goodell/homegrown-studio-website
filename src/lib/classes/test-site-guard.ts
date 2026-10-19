/**
 * R41: a test site (a Netlify deploy preview or branch deploy) with no
 * STORE_NAMESPACE shares the live site's stores and its Square. On such a
 * site, class booking writes (seats, classes), simulated payments and class
 * POS sync are refused, so a test booking can never take a live seat and a
 * test class can never land on the live POS or the live class list.
 *
 * Production, unknown runtimes (treated as production) and local dev are
 * allowed; a preview with its own STORE_NAMESPACE is allowed.
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
export function testSiteRefusal(input: { context: DeployContext; namespace?: string | null }): string | null {
  const testSite = input.context === 'deploy-preview' || input.context === 'branch-deploy'
  return testSite && !(input.namespace ?? '').trim() ? NO_TEST_STORE : null
}

/** This deploy's refusal, or null. */
export function classWritesRefusal(request?: Request): string | null {
  return testSiteRefusal({ context: deployContext(request), namespace: process.env.STORE_NAMESPACE })
}

/** Throws TestSiteStoreError on a test site with no store of its own. */
export function assertClassWritesAllowed(request?: Request): void {
  if (classWritesRefusal(request)) throw new TestSiteStoreError()
}
