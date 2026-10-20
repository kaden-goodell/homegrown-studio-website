# Task 8 review: /book reads party settings, package and extras steps, copy follows settings

Commit 6b1b19e..e192106 (one commit). Reviewer ran the targeted tests, tsc and a hands-on walk.

**Verdict: Needs fixes** (2 Important, both small and in PartyModal.tsx)

## Checks run
- `npx vitest run tests/components/party tests/api/party* tests/lib/parties`: 19 files, 387 passed.
- `npx tsc --noEmit`: clean.
- Hands-on: `astro dev --port 4350` in the worktree. A `.env` with real keys **does** exist there (the brief said none), so the server ran with env overrides (PROVIDER_MODE=mock, dummy Square token, Gmail/Quo keys blanked, DEV_BYPASS_PAYMENT=true). Every `/api/party/*` call was stubbed in the page with seeded settings: $350 Whole studio, $200 / 120-min Table party (6–12), $1 link-only Test party, per-guest goodie bags (max 2), a $75 +30-min extra half hour and balloons (max 4). `book.json` was answered by the stub, so no booking POST reached the server and Square was never called. Walked at 500 px (the window can't go narrower) and in 390 px and 1024 px iframes: every step, forward and back, package switches, extras, the extra-time refusal, pay, confirmation, 402/502/409 retries and an extras change. Afterwards the server was stopped, the tab closed, the test "recent party" removed from localStorage, and the tree is clean.
- SSR copy with saved settings could not be seen live: Netlify's dev blob emulation ignores `BLOB_STORE_FS_DIR`. The unit tests cover it (party-content.test.ts, PartyLanding.test.tsx).

## Requirements
| Requirement | Status | Where |
|---|---|---|
| Modal reads `info.facts`, config only as first paint | Met | PartyModal.tsx:116-136 |
| Package step only when >1 package or link package | Met | party-steps.ts:44-50; PartyModal.tsx:322-330 |
| `theme` becomes `extras`, shown for add-ons or themes | Met | party-steps.ts; PartyModal.tsx:609-625 |
| Body sends packageId/guests/addOns/craftId/startTime, no prices | Met (seen live) | PartyModal.tsx:752-779 |
| New attempt id after a definite failure; same id on unknown or `in_progress` | Met (seen live: 402 new, 502 same, 409 same) | PartyModal.tsx:785-792 |
| New attempt id when package or add-ons change | Met (seen live) | PartyModal.tsx:147-151 |
| party-summary: package + extras today, crafts at the studio | Met | party-summary.ts:79-101 |
| partyContentFor / policySectionsFor / partyRefundLine(feeCents) | Met | party-content.ts, policy-content.ts, refund-lines.ts:27 |
| book/index/policies load settings once, non-strict | Met | book.astro:21, index.astro:22, policies.astro:14 |
| Fallback = today exactly when nothing is saved | Met (equivalence tests; config facts give 4 steps, same picks, limits and Pay label) | tests/lib/parties/party-content.test.ts; PartyModal.test.tsx |
| Step 1 named tests ($350 to Pay/copy/FAQ/refund, 120 min, ?package, no prices, 402/502) | Met | tests listed in report |

The price on Pay is the server's quote: the browser runs the server's own `quoteParty` on the same facts. Seen: $200 + $96 (12 × $8) + $75 + $5 = Pay $376. With 2 bags each it showed "2 each for 8 guests × $8" = $128. The per-guest extra follows the guest count. `pricing.ts` and `party-times.ts` are safe to run in the browser (config imports only).

## Important
1. **Changing to a package of a different length leaves the old times on screen.** It happens when a date is already chosen. `choosePackage` clears the chosen time and `timesByDate`, but not `availableSlots` or `selectedDate` (PartyModal.tsx:325-339). The date step goes on showing the times fetched for the old length, and their `endAt` is the old length's. Seen: Test party (90 min), Nov 15, then Table party (120 min). The 1:00 PM picked from the stale list carried a 90-min end, and the confirmation read "Sun, Nov 15 · 1:00–2:30 PM" (should be 1:00–3:00). The Google/Apple calendar entry gets the same wrong end. A start that fits 90 minutes but not 120 can also be offered; the server then refuses it at Pay. Fix: when the length changes, also clear `availableSlots` (and either refetch the selected date or clear `selectedDate`). Add a test: package change with a date picked shows the new length's times and end.
2. **Extra time with a `?start=` link can trap the customer.** A calendar link settles the time and removes the date step (`slotSettled`). When the extra time doesn't fit that start, leaving extras says "Go back and pick an earlier time…", but there is no date step to go back to. `slotSettled` is only cleared by a package change or a lost-time recovery (PartyModal.tsx:661, 691). Fix: when `extraTimeFits()` fails, `setSlotSettled(false)` so the date step comes back (or send them straight to it, as `recoverFromLostTime` does). Add a test.

## Concern 1: SSR on index and policies
SSR isn't needed for one number. As built, it works and is cached (`publicPageHeaders`: 5 min fresh, 7-day SWR), and the keep-warm ping covers the shared function. The cost is that the home page (the most-visited page, and a likely ad landing page) is no longer free static HTML. Also, `Netlify-Vary: query` keys the cache on the whole query string, so every `fbclid`/`gclid`/`utm_*` click misses the cache and runs the function cold. Recommended, in order:
- (a) Keep both pages `prerender = true`. Render the config number in the HTML, and have a tiny island (or the existing service-info `facts`) fetch the live "from $X" price after load. Policies can do the same for its fee and minimum, or just link to /book for the current price.
- (b) If SSR stays, narrow the vary to `query=w|preview` for these pages, so ad-click ids share one cached copy.

Not blocking the branch, but decide before prod. Kaden's credit budget counts web requests and function time.

## Minor / UX quirks (one line each)
- Date step says "Every party is 120 minutes. The whole studio, just your group." With several packages it should be "Your party is N minutes", and "whole studio" may be wrong for a table package.
- At the package's max the guest step says "12 guests is the most the studio holds." It should say the package ("this party holds").
- Going back to the date step after adding extra time still lists the starts that don't fit (`timesByDate` came without add-ons, so 3:30 PM stays offered and selected). The customer can loop: pick it, then be refused again at extras.
- Changing package silently resets the guest count (20 → 8) and clears the picked time, with no line saying so.
- Per-guest counter shows a bare "2" with no "each". The summary makes it clear, but the card doesn't. The aria-live region also announces only the number.
- Chip order is craft, time, package, guests (package was chosen before time). At 390 px, four chips wrap onto 2–3 rows above the step.
- No chip or summary hint for extras on the pay step header (the summary below lists them, so this is minor).
- The home card reads "Whole studio · from $200" when the lowest package is a table party.
- The landing's own date strip asks for the default package only (decision 5), even with `?package=`. Acceptable.
- Pre-existing (not this task): copy with colons ("It’s for our prep only: you pay…", "Keep this link: it’s also…"); "Birthdays" in hero occasions, the FAQ and the home card.
- Accessibility: package and extra cards are buttons with `aria-pressed`, in labelled groups. Measured targets: counters 44×44, cards ≥ 44 high, Back 44 high. No horizontal scroll at 390.

## Tests to add with the fixes
- Package length change with a date picked: refreshed times and correct end in the confirmation.
- `?start=` link plus extra time that doesn't fit: the date step returns.
