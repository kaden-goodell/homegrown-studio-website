/**
 * R41 for parties. There is ONE test-site rule for every booking write,
 * classes and parties alike: `@lib/classes/test-site-guard`. A test site (a
 * Netlify deploy preview or branch deploy) with no STORE_NAMESPACE shares the
 * live site's stores; a party hold made there would take a real party time
 * from customers, so every party booking write (card, link or simulated),
 * party settings save and party book change is refused there.
 *
 * These names are kept so the party code reads naturally; they are the same
 * functions as the class guard, never a second copy of the rule.
 *
 * Server only.
 */
import { classWritesRefusal, NO_TEST_STORE, testSiteRefusal } from '@lib/classes/test-site-guard'

export { NO_TEST_STORE }

/** The rule, with its inputs passed in: the refusal, or null when writes may go ahead. */
export const partyTestSiteRefusal = testSiteRefusal

/** This deploy's refusal for party writes, or null. */
export const partyWritesRefusal = classWritesRefusal
