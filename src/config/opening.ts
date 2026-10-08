/**
 * Single source of truth for the studio's opening date.
 *
 * Everything gated off "the day we open" reads this one constant:
 *   - site.config `openingDate`      → homepage banner + /about copy
 *   - party.config `bookingOpensDate`→ PARTY_START_DATE below (the weekend after)
 *
 * Format: YYYY-MM-DD, studio-local (America/Chicago). Change it here only.
 * (The narrative sentence in src/content/about/story.md is hand-written prose
 *  and is the one spot that still needs a manual edit — markdown can't import.)
 */
export const OPENING_DATE = '2026-10-16'

/**
 * Private parties and the Craft Café both start the weekend after the
 * Halloween break (Sat 7 Nov 2026); until then the studio runs workshops
 * only (Kaden, 8 Oct 2026). No party date before this is offered or
 * accepted. Change it here only.
 */
export const PARTY_START_DATE = '2026-11-07'

/**
 * Craft Café (walk-in) starts the same weekend as parties. Before this date
 * /craft-cafe and the homepage say walk-in hours haven't started. Same rule:
 * change it here only. The label is what the copy says.
 */
export const OPEN_STUDIO_START_DATE = PARTY_START_DATE
export const OPEN_STUDIO_START_LABEL = 'Saturday, November 7'
