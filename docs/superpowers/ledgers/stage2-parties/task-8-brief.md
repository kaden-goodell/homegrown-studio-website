### Task 8: /book reads our settings; extras step; copy follows settings

**Files:**
- Modify: `src/components/party/PartyModal.tsx` (every `partyConfig.*` and the direct `bookableDates()`/`partyStartsForDate()` calls read `info.facts` through `party-times.ts`, with `partyConfig` only as the first-paint default; a package step only when > 1 package is offered or `?package=` names a link package; the `'theme'` step becomes `'extras'`, shown when `facts.addOns.length > 0` or themes exist; body sends `packageId`, `guests`, `addOns`, `craftId`, `startTime`, no prices; a new attempt id after any definite failure, 409 `in_progress` treated as known)
- Modify: `src/lib/party-steps.ts` (`extras`), `src/lib/party-summary.ts` (package + extras; "Pay today" = package + extras; crafts stay "Pay at the studio"), `src/components/party/PartyPriceSummary.tsx`
- Modify: `src/config/party-content.ts`, `src/config/policy-content.ts`, `src/lib/refund-lines.ts` (fee, length, guest numbers become inputs: `partyContentFor(facts)`, `partyRefundLine(startIso, now?, feeCents?)`), `src/pages/book.astro`, `src/pages/index.astro`, `src/components/party/PartyLanding.tsx`, `src/pages/policies.astro` (SSR loads settings once, non-strict, and passes facts)
- Test: `tests/lib/party-steps.test.ts`, `tests/lib/party-summary.test.ts`, `tests/components/party/PartyModal.test.tsx`, `tests/components/party/PartyLanding.test.tsx`, `tests/lib/refund-lines.test.ts`, new `tests/lib/parties/party-content.test.ts`

- [ ] **Step 1: Failing tests:** with config fallback the modal shows the same steps, quick picks, guest limits and Pay label as today (labels, not markup); no add-ons → no extras step; an online add-on → extras step and the Pay label includes it; a per-guest add-on follows the guest count; **"price change reaches the Pay button"**: a saved $350 package reaches the Pay button, `/book` copy, the FAQ answer and the refund line; a 120-minute package changes the length copy; `?package=pkg_test` shows the test package; the request body carries no prices; after a 402 the next submit uses a new attempt id, after a 502 `unknown_outcome` the same one.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/components/party tests/lib` — PASS. Check at 400 px width.
- [ ] **Step 5: Commit** `feat(parties): /book reads party settings; extras step; party copy follows settings`.

