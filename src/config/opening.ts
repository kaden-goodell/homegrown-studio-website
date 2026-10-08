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
export const OPENING_DATE = '2026-10-16'

/**
 * Open Studio (walk-in) starts later than the grand opening — the first weeks
 * are parties, workshops, and events only. Before this date /craft-cafe and
 * the homepage say walk-in hours haven't started. Same rule: change it here only.
 * Label is what the copy says until the exact day is confirmed.
 */
export const OPEN_STUDIO_START_DATE = '2026-12-03'
export const OPEN_STUDIO_START_LABEL = 'the first week of December'
