# Task 8 re-review 1 (fix round 1)

Fix diff e192106..1cfc79b (one commit). Scope: I1, I2 (ruling S2-R8a), concern 1 (ruling S2-R8b), the quirks, and anything new.

**Verdict: Approved** (no Important findings; three Minor notes below, none blocking)

## Checks run
- `npx vitest run tests/components/party tests/api/party* tests/lib/parties tests/lib/party-numbers-live.test.ts tests/config/site-copy.test.ts`: 22 files, 471 passed.
- `npx tsc --noEmit`: 0.
- No hands-on this round. The fixer's 390/1024 walk (mock provider, stubbed party APIs, POSTs blocked) and the new PartyModal tests cover the changed paths; code read below.

## Items
| Item | Verdict | Where |
|---|---|---|
| I1 package change keeps old times | Fixed. `choosePackage` clears the slot, `slotSettled`, `availableSlots`, `timesByDate`, offered counts, and refetches the chosen date's times for the new package; the date is dropped only if the new package's dates lack it. | PartyModal.tsx:722-758, 393-399 |
| I1 end time = start + package + extra | Fixed. `partyEndIso` = startAt + (pkg.minutes + extraMinutes); no longer the slot's `endAt`. Feeds the confirmation line and both calendar links. `extraMinutes` sums quote items whose `extraMinutes = a.extraMinutes × count` (pricing.ts:48), the same rule as the server's `partyMinutes`/`q.minutes` (open-times.ts:43, checkout.ts:226/239/468), and the emails/ics read the server's `durationMinutes`/`endIso`. Consistent everywhere. | PartyModal.tsx:520, 953-980 |
| I2 link-fixed time + extra time (S2-R8a) | Fixed. On the extras step with `slotSettled`, each time extra is checked alone against the fixed start; a non-fitting one is disabled, labelled "Doesn’t fit this time" and removed if on. Fetch failure leaves it offered (server re-checks). Combined-extras miss says "Leave it off to keep this time" (no "go back" when there is no date step). No dead end. | PartyModal.tsx:565-586, 636-641, 1517-1582 |
| Back on date step with extra time | Fixed. Times re-asked with add-ons; a chosen non-fitting start is cleared; removing extra time restores the package's times. New-date pick with extra time also asks with add-ons. | PartyModal.tsx:588-614, 698 |
| Concern 1 (S2-R8b) static pages | Fixed. index.astro and policies.astro are `prerender = true` again, no page headers, no settings read. | index.astro:2, policies.astro:2 |
| price-facts.json public-safe | Yes. Returns `{ copy: {feeCents, minutes, minGuests, maxGuests, bookingWindowDays}, from: {name, priceCents} }`; `from` only considers `who === 'everyone' && !archived` (link-only and archived packages never leak; test covers a $1 link package). No ids, add-ons, times or internal fields. | price-facts.json.ts:15-19; party-content.ts:66-71; tests/api/party-price-facts.test.ts |
| price-facts.json cached | Yes. `publicListHeaders`: browser 60 s, edge 60 s + 600 s SWR, vary on query + preview cookie (the client fetch has no query, so ad-click ids don't fragment it). | cache-headers.ts:24-36 |
| Swap can't show wrong numbers | Holds. HTML carries config numbers (`partyConfig.basePriceCents`, static `policySections`); with nothing saved the API answers the same (test asserts $300/"Whole studio"). `applyPartyNumbers` type-checks every field before touching the DOM; `!res.ok`, bad JSON or a throw leaves the page as built. Policy rule indices line up: `policySectionsFor` has a fixed rule list with no conditionals, and the swap only targets the `parties:` section. | party-numbers-live.ts:29-55; policy-content.ts:55-100 |
| Quirks | Done: "This package is N minutes." with a package choice; "…the most this package holds."; guest kept/clamped with a note; "N each" counter (also in the live region); package chip before time. | PartyModal.tsx:1287, 1408-1412, 1436-1439, 1485-1489, 1577-1579, 1821 |
| Tests asked for | Added: package length change → new times + 1–3 PM end; `?start=` + extra time → no dead end; plus clamp note, date-step filtering, "2 each", single-package copy; API (2) and live-swap (3) tests. | tests/components/party/PartyModal.test.tsx; tests/api/party-price-facts.test.ts; tests/lib/party-numbers-live.test.ts |

## Minor (not blocking)
1. **Unguarded slot fetches can land late.** `choosePackage`'s refetch (PartyModal.tsx:750-756) has no cancel/sequence check. On a slow network: switch package, Continue, tap a different date before the first answer returns, and the old date's times can overwrite the new date's list (chip and pay step would show the old day, so it is visible, and the server books what's shown). Same pattern already exists in `onSelectDate` (pre-existing). A shared request counter for `availableSlots` writes would close both.
2. **A settings-read blip is cached as config numbers.** `getPartySettings()` (non-strict) swallows the error and the route can't pass `failed`, so a blob hiccup is edge-cached as the config answer for up to ~11 min. Effect = the page shows the HTML's config numbers, the same as the documented fetch-failure fallback; acceptable, worth knowing.
3. **Owner save is not purged from the edge.** Up to ~1 min (plus one SWR hit) of the old "from"/fee after a save. Fine for this use.

## Customer copy
New strings are listed as DRAFTS for Kaden in task-8-report.md ("Fix round 1"). No colons or "birthday" framing added by this round.
