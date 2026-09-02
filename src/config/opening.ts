/**
 * Single source of truth for the studio's opening date.
 *
 * Everything gated off "the day we open" reads this one constant:
 *   - site.config `openingDate`      → homepage banner + /about copy
 *   - party.config `bookingOpensDate`→ no party dates are offered/accepted before we open
 *
 * Format: YYYY-MM-DD, studio-local (America/Chicago). Change it here only.
 * (The narrative sentence in src/content/about/story.md is hand-written prose
 *  and is the one spot that still needs a manual edit — markdown can't import.)
 */
export const OPENING_DATE = '2026-10-15'
