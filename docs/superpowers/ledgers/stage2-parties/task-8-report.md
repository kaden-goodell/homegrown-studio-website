# Task 8 report — /book reads party settings; extras step; party copy follows settings

Status: DONE. Base 6b1b19e, branch kaden/admin-d (not pushed).

## What changed
- `src/components/party/PartyModal.tsx`: everything about the party comes from `info.facts` (service-info) through `party-times.ts` + `pricing.ts`; `configPublicFacts()` (config) is only the first-paint default and the fallback for an answer with no facts. Package (`pkg`) = the one chosen, else the `?package=` link package, else the first everyone package. Guest limits, quick picks, default guests, length copy, window days, "minimum N", the policy line and the refund lines all follow the package. Offered count fallback = `partyStartsForDate(settings, ymd, now, facts.days, { minutes })`; "later months" and booked-date range use `facts.first/last`.
  - Steps: craft → **package** (only when > 1 package offered or a link package is named) → when → who → **extras** (online add-ons or themed tables) → pay. Config today = the same 4 steps.
  - Extras step: one card per online add-on (tap to add when at most 1; a − / + counter when more), per-guest extras priced for the current guest count; themed tables (unchanged logic) sit under it. Prices are worked out with `quoteParty` (the server's own function) from the facts.
  - Extra time: leaving the extras step re-asks availability with the add-ons; if the chosen start no longer fits, it says so and stays (server still checks).
  - Requests: available-dates `{ packageId }` (re-asked when the package changes; a changed length clears a picked time), availability `{ date, packageId, addOns? }`, service-info `?package=`. Book body: `attemptId, startTime, packageId, linkPackageId?, guests, addOns, craftId, attribution, posthogId, customer, theme?, paymentToken, sourceKind` — no prices, no craft object, no variation fields.
  - Attempt id: kept on unknown outcome **and on 409 `in_progress`**; new after any definite failure (decline, taken, "Something changed" 503, …) and when time, craft, guests, table, **package or add-ons** change.
  - Confirmation end time includes extra time; "…party, $X paid." when extras were bought (else "studio fee paid" as today).
- `src/lib/party-steps.ts`: `'theme'` → `'extras'`, new `'package'`; inputs `addOnCount`, `packageCount`, `linkPackage`.
- `src/lib/party-summary.ts`: `pkg { name?, priceCents, minGuests }` and `extras` (quote items). Pay today = package + extras (+ table); crafts stay "Pay at the studio". Package name replaces "Studio fee" only when there was a package choice. `PartyPriceSummary.tsx` needed no change (renders the lines generically).
- `src/config/party-content.ts`: `partyContentFor(facts)` (facts = settings/PublicPartyFacts or `PartyCopyFacts`), `partyCopyFacts`, `defaultPackageOf`, `lowestPackageCents`, `CONFIG_COPY_FACTS`; `partyContent` = `partyContentFor()` (identical to before, test-pinned).
- `src/config/policy-content.ts`: `policySectionsFor({ feeCents, minGuests })`, `partyCheckoutPolicySummary(minGuests)`; old constants kept (config).
- `src/lib/refund-lines.ts`: `partyRefundLine(startIso, now?, feeCents?)`. The modal passes what is paid today; the confirmation email (checkout.ts) passes the amount charged.
- `src/lib/parties/party-times.ts`: + `configPublicFacts(now)`, `settingsFromFacts(facts)` (pure, browser-safe).
- Pages: `book.astro` reads `getPartySettings()` once (non-strict) → `copy` to `PartyLanding`, `PartyPriceLine`, `PartyFaq`, hero/meta. `PartyLanding` takes `copy`, reads `?package=` (opens the panel, passes `linkPackageId` to every opening), sends `{ packageId }` for dates. `index.astro` and `policies.astro` switched from prerendered to SSR (as the plan says) with `publicPageHeaders` so Netlify keeps a cached copy (5 min fresh, SWR).

## Tests
- New `tests/lib/parties/party-content.test.ts` (config = today's copy exactly; $350 → hold line + FAQ; refund line $350; 120 min → value trio + FAQ; guest numbers; policy page + checkout line; default-package choice ignores link/admin/archived; fallback).
- PartyModal: config facts → same steps/quick picks/limits/Pay label; offline add-on → no extras step; online add-on → extras step + Pay $350; counter up to max; per-guest follows guests; $350 → Pay button + refund line; 120 min copy + `{ packageId }` dates request; package guest limits; `?package=pkg_test` (service-info param, package step, preselected, Pay $1, body packageId/linkPackageId); no link package without link; extra time no longer fits; body carries no prices; 402 → new id, 502 unknown → same; 409 in_progress → same; 503 "Something changed" → new; extras change → new; package change → new.
- PartyLanding: $350 copy (how it works, hold line, fee share, window days), price line, `?package=` handed to panel. party-steps, party-summary, refund-lines extended; site-copy homepage assertion updated to the settings read.
- Focused `npx vitest run tests/components/party tests/lib`: 134 files / 1818 pass. Full `npx vitest run`: 312 files / 4155 pass. `npx tsc --noEmit`: 0.

## Visual check
Dev server on this worktree with no .env (mock providers, no Square) and a scratch `BLOB_STORE_FS_DIR` seeded with 3 packages + 3 add-ons. Service-info/dates needed Square-free stubs, so the page's fetch was stubbed in the browser and every POST blocked (none sent). Checked package, extras and pay steps at 1210 px (the window would not resize to 1024) and at 390 px (in a 390-px iframe): layout holds, totals right ($300 + $120 bags + $75 time + $5 = Pay $500). Found and fixed: rapid taps on an extra's + used a stale count.

## Decisions (flag if wrong)
1. Package step sits after craft (craft links still open on the craft step, "Book this craft"), before the date (length decides times).
2. Copy numbers on /book, home and policies use the default package (first everyone package); home shows "from" the lowest everyone package.
3. Refund line amount = what is paid today (package + extras), not the package alone.
4. index/policies are now SSR (plan) — each cold request costs a function call; the CDN cache softens it. Revert to prerender if Kaden prefers zero SSR there.
5. The landing's own date list still asks for the default package only.

## Customer copy — DRAFTS for Kaden (new)
- Step label "Package"; step label "Extras".
- "Choose your party"
- Package card line "90 minutes · 10 to 30 guests"
- "Crafts are paid at the studio for whoever comes, whichever you choose."
- "Add extras?" / "Optional, and paid today with your booking."
- Extra card details "$8 a guest" · "30 more minutes" · "for each of your 15 guests"; buttons "Add" / "Added"
- Summary lines "Goodie bags, 15 guests × $8", "Goodie bags, 2 each for 15 guests × $8", "Balloon bunches × 2"; the package name in place of "Studio fee" when there was a choice ("Table party, holds Sat, Oct 31 at 1:30 PM")
- "That start time doesn’t leave room for the extra time. Go back and pick an earlier time, or leave the extra time off."
- Button while checking "Checking the time…"
- Confirmation with extras "Bubble Letter Keychains party, $500 paid."

## Fix round 1 (review task-8-review.md)

- **I1** `choosePackage`: the guest count stays when it fits the new package; otherwise it moves to the nearest end and says so ("Changed to N guests, the most this package holds." / "…the fewest this package takes."). The note shows on the package step and on the guest step until guests are changed. The chosen time always goes (and a link-fixed time, so the date step returns); the old times (`availableSlots`, `timesByDate`, offered counts) are dropped; the chosen date's times are asked for again with the new package; the date is dropped only if the new package's dates don't include it. The party end (confirmation, calendar entry) is now start + package minutes + extra minutes, never the slot's old `endAt`.
- **I2 (S2-R8a)** With a link-fixed time (no date step), each extra that adds time is checked against that start on the extras step; one that doesn't fit is shown disabled with "Doesn’t fit this time" (and taken off if it was on). The "Go back and pick an earlier time…" message appears only when a date step exists; otherwise (two time extras fitting alone but not together) "The extra time doesn’t fit this start time. Leave it off to keep this time." Back on the date step with extra time chosen, the date's times are asked for with the add-ons, so only starts that fit the full length are offered (a chosen one that no longer fits is cleared); taking the extra time off again restores the package's own times. Picking a new date with extra time chosen also asks with the add-ons.
- **Concern 1 (S2-R8b)** `index.astro` and `policies.astro` are prerendered again (no SSR, no page caching). They carry today's config numbers in the HTML; `src/lib/party-numbers-live.ts` fetches the new `GET /api/party/price-facts.json` (`{ copy, from }`, non-strict settings read, `publicListHeaders`: edge-cached 60 s) and swaps in the home "from" chip (`[data-party-from]`, cheapest everyone package's own name: "Table party · from $150") and the policy page's party intro and rule bodies (`[data-policy-text="parties:…"]`). With nothing saved the answer equals the HTML, so nothing changes on screen; a failed request leaves the page as built. `cheapestPackageOf` added to party-content.ts. The site-copy homepage test is back to its original assertion.
- **Quirks** Date step: "Every party is N minutes. The whole studio, just your group." with one package (today), "This package is N minutes." when there is a package choice. Guest limit: "N guests is the most this package holds." when there is a package choice (one package keeps "…the studio holds", today's words). Per-guest counter reads "N each" (also in the live region). Chips: package now before the time.
- Tests: PartyModal +6 (package length change → new times + 1–3 PM end + guests kept; guest clamp note; link-fixed time + extra time disabled, no dead end; back to date step offers only fitting starts; "2 each"; one package keeps today's words); new `tests/api/party-price-facts.test.ts` (2), `tests/lib/party-numbers-live.test.ts` (3).
- Visual re-check: dev server with PROVIDER_MODE=mock, dummy Square token/app id, Gmail/Quo/PostHog keys blanked, DEV_BYPASS_PAYMENT=true; `/api/party/*` stubbed in a 390-px and 1024-px iframe, every POST blocked (none sent). Seen: policies intro swaps to "$350", home chip to "Table party · from $200"; `?start=` link → extras shows "Doesn’t fit this time" on the extra half hour and Continue goes on; Table party switch → date step back, "This package is 120 minutes.", new times only. Found and fixed during it: offered counts ("1 of 2 times still open") kept the old package's numbers after a switch.
- **Correction to the first visual check**: this worktree does have a `.env` with real keys (my earlier `ls` check was wrong). That first run used it; only read requests reached the server (service-info's catalog read failed with "fetch failed", party times refused), and every POST was blocked in the page. Nothing was written to Square.
- Full `npx vitest run`: 314 files / 4166 pass. `npx tsc --noEmit`: 0.

### New customer copy — DRAFTS for Kaden (fix round 1)
- "Changed to 12 guests, the most this package holds."
- "Changed to 6 guests, the fewest this package takes."
- "This package is 120 minutes."
- "12 guests is the most this package holds."
- "Doesn’t fit this time"
- "The extra time doesn’t fit this start time. Leave it off to keep this time."
- Counter "2 each"
- Home chip "Table party · from $150" (the cheapest package's own name)
