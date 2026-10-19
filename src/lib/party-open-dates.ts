/**
 * The party times a customer could book right now, across the whole booking
 * window (`@lib/parties/open-times`). Used where an answer is sent to someone
 * rather than shown on a page, so it never guesses: if anything can't be
 * read, it throws, and the caller says nothing about party dates this time.
 *
 * The Square helpers moved to `@lib/parties/legacy-square`; re-exported here
 * for older imports.
 */
export { openPartyStartsInWindow } from '@lib/parties/open-times'
export { isNotFound, onSandbox, loadPartyVariationId } from '@lib/parties/legacy-square'
