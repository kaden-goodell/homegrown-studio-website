# Task 9 report: pay the balance by link

Status: DONE. Base 1cfc79b on kaden/admin-d. One commit (`feat(parties): pay the balance online from a payment link`).
Full suite: 317 files / 4201 tests pass; `npx tsc --noEmit` clean.

## What was built

- `src/lib/parties/pay-balance.ts` (new; the money path, kept in lib so Square's payment event can use it):
  `payBalance` (key → booked → due → claim → order → drift → charge → record), `partyForLink` /
  `payKeyMatches` (constant-time `timingSafeEqual` on `payToken`; wrong key = missing party),
  `recordLinkCharge` (idempotent on paymentId; marks only the order's items; clears `paying`; files
  the payment index; never fails for money taken), `tellLinkPaid` (host email + owners' "Balance paid"
  text), `linkOrderPaid` (webhook hook), `settleEarlier` (R15 for a timed-out earlier attempt).
- `src/lib/parties/payment-link.ts`: `payLinkUrl(origin, rec)` → `/party/pay/<id>?k=<payToken>`;
  `sendPaymentLink(rec, origin, by)` emails (`sendPartyPaymentLinkEmail`) and texts (`sendQuoText`),
  both through the preview reroute, each channel independent, appends `linkSent` + history;
  refuses (PaymentLinkError) a party that isn't ours/booked, has no key, or owes nothing.
- `src/pages/api/party/balance.json.ts` (GET; rate-limited 30/min) → `{ when, hostFirstName,
  packageName, items (unpaid), dueCents, state, receiptUrl }`; 404 identical for missing / wrong / host key.
- `src/pages/api/party/pay.json.ts` (POST; 5/min; no bookings gate, S2-R16; payment bypass → simulated charge).
- `src/pages/party/pay/[id].astro` (noindex) + `src/components/party/PartyPayPanel.tsx` (unpaid items,
  total, crafts line, `PaymentForm` with wallets + gift cards, paid screen with receipt; attempt id kept
  on unknown/in_progress, renewed after any plain answer, as /book).
- `src/lib/email.ts`: `sendPartyPaymentLinkEmail`, `sendPartyPaidEmail` (shared small shell).
- `src/lib/party-store.ts`: `paying` is now `PartyPaying` (adds optional `via`, `state`
  charging|unclear, the exact `order` request, `orderId`, `itemIds`, `quotedCents`, `at`);
  `PartyCharge.attemptId?` (a retry of the same attempt after success answers "paid", no second charge).
- `src/lib/parties/money.ts` `claimPaying`: the same attempt keeps the fields it already wrote (its order
  request), a new attempt starts clean. Existing money tests unchanged and green.
- `src/lib/parties/checkout.ts`: `giftCardRefusal` exported (whole-amount gift-card pre-check reused).
- `src/lib/parties/square-orders.ts`: link-payment orders handled **before** the "paid by another order"
  check (Task 7 review note): the order in `paying` → `in-flight` while its own request may run (5 min,
  unless unclear), else recorded from Square + host/owners told. Mutation-checked: removing the hook fails 2 tests.

## Flow decisions (for the reviewer)

- Claim through `updatePartyRecord` (CAS): a second attempt inside the 10-min claim → 409 "A payment for this
  party is already going through…" before any order. Tested with an in-memory etag store for `parties`
  (fs store is last-write-wins on updates), `Promise.all` of two payers → [200, 409], one order, one charge.
- The order request is built inside the claim from the items unpaid at that moment and stored on `paying`
  (`attemptKey(attemptId,'order')`, `referenceId` = party id, `customerId` null, lines via
  `orderLineItems(items, pkgName, rec.packageId)` — packageId passed as required). A same-attempt retry reuses
  that exact request (same Square order) and first asks `findOrderPayment`.
- Unknown → `paying.until` = now + 24 h, `state: 'unclear'`, owners texted, 502. After 24 h a new attempt
  first asks Square about the old order (`paidOnOrder`): paid → recorded, "already paid"; can't ask → 409;
  unpaid → proceeds. Declined / order failed / drift > +100 → `paying` cleared, nothing charged.
- Record write failing after payment: retried once, then owners alerted; `paying` (with orderId) stays so
  Square's payment event records it later. Index write failure → owners alerted (as Task 7).
- Test-site guard (R41) applies to link payments too (writes to live stores).
- Party holds untouched: a link party's hold was made with no expiry by Task 7 (`ttlMinutes: null`); paying by
  link doesn't change the hold (already `held` with no expiry; confirmTime not needed for a booked record).

## Tests

- `tests/api/party-pay.test.ts` (22): wrong/missing key 404 same body on both routes; host token never opens;
  balance contents; pays exactly the due items + marks + index + emails/owner text; **two payers**; second
  payer during the charge; same attempt after success → replayed, no charge; due 0 → "Already paid", no Square;
  cancelled → 410; **items added after the order stay due** (and the next payment pays just the extra);
  gate closed still pays; declined; gift card short before anything; drift +50/−50/+150; unknown → 24 h,
  409 for others, webhook records it (not flagged), replayed event ignored; same-attempt retry finds payment;
  after 24 h unpaid → pays / paid → recorded with no new charge; webhook during in-flight → ignored, no
  paid-elsewhere; simulated.
- `tests/lib/parties/payment-link.test.ts` (6): URL uses payToken; sender emails + texts + `linkSent`; preview
  reroutes both to Kaden (real sendEmail/sendQuoText, nodemailer and fetch faked); text failure still emails;
  refusals send nothing.
- `tests/components/party/PartyPayPanel.test.tsx` (7).

## DRAFT customer copy for Kaden (no colons, no timelines, never "birthday")

- Text: "Hometown Studio here. Your party on Sat, Nov 8 at 1:30 PM is held for you. Pay $300 here to finish booking {link}" (brief's draft, verbatim).
- Page heading "Pay for your party". Crafts line "Crafts are paid at the studio for whoever comes." (brief's drafts).
- Link email: subject "Pay for your party at Hometown Studio"; "Your party on {when} is held for you." / "Pay {amount} here to finish booking." / crafts line / button "Pay {amount}" / "Questions? Text us at (256) 464-1710."
- Paid email: subject "Your party is paid"; "Thank you! We got your payment of {amount} for your party on {when}." / "Your party is all paid." or "There is still {amount} to pay for extras added since." / crafts line / "See your receipt".
- Page: "Hi {name}! Your party on {when} is held for you." / "To pay now" / "Pay {amount}" / paid "Thank you! You paid {amount}." / "Your party is paid." / "Your party on {when} is booked." / "There is still {amount} to pay for extras added since. Refresh this page to pay it." / "See your receipt" / "This party was cancelled. Nothing is due." / "We couldn’t load this payment. Please try again."
- Refusals: "This payment link doesn’t work. Please text us at (256) 464-1710 and we’ll send a new one." / "A payment for this party is already going through. Check back in a few minutes." (brief) / "This party was cancelled. Nothing was charged." (brief) / "Something’s off with the price, so nothing was charged. Please text us at (256) 464-1710." / "We couldn’t start the payment. Nothing was charged. Please try again." Declined uses the existing "Your card was declined. Nothing was charged. Try another card."

## Concerns / handoffs

1. To decide doesn't list an unclear link payment (owners get a text naming the party; a later attempt or Square's event settles it). Task 13 could show `paying.state === 'unclear'` parties.
2. "Party hold with no party" warning for cancelled parties not touched (left for Task 13 as noted).
3. The pay page URL carries `?k=` like the host page's `?key=`; nothing strips query strings before GA/PostHog page views. Worth a check (same exposure as the host page today).
4. Task 11 (admin card on a booked party) should use the same `paying` claim; `recordLinkCharge` is link-specific (`via: 'link'`), easy to generalise.
5. Sandbox (Task 14): a link order is an ad hoc order with `customer_id` unset and `reference_id`/line notes as in Task 7; no new Square call shapes.

## Fix round 1

- I1: the panel sends `expectedCents` (the amount shown, also what the wallet sheet approved); `pay.json` requires it (400 without). `payBalance` refuses 409 `amount_changed` before the claim when the due differs, and again inside the claim on the record as written (and a same-attempt retry against its stored quote), so nothing starts unless the charge equals the shown amount. The panel reloads the balance and shows "The amount changed. Refresh to see what’s due. Nothing was charged."; the next try is a new attempt. Tests: extra added between look and pay → 409, no order; extra added between first look and claim → 409; missing amount → 400; panel reload + new amount + new attempt id.
- I2 (S2-R9a): `src/lib/page-key.ts` — `isPrivatePartyPage` (/party and below); `PAGE_KEY_SCRIPT`, inline and first in `<head>` (before SeoHead/PostHog), moves `?k=` / `?key=` into sessionStorage (`hs-page-key:<path>`) and replaces the URL with the bare path (+hash); it also marks any link into /party/* `data-astro-reload` (capture-phase click), so a key never rides a view-transition page change that GA4/PostHog on the previous page would report. Layout on /party/*: no `<Analytics />` (GA4, Meta Pixel, analytics-auto), PostHog `noRecording` (pageviews only, URL already stripped), `<meta name="referrer" content="same-origin">`. Meta Pixel PRIVATE_PATHS also gains `party`. PartyDashboard and PartyPayPanel fall back to the remembered key after a refresh. Tests: tests/lib/page-key.test.ts (script strip/store/refresh/other pages/link guard, Layout wiring by source), meta-pixel /party cases, panel refresh case.
- Minors: `claimPaying` never shortens the same attempt's time (unclear keeps 24 h through a retry); extras-only wording for text/email/page; paid email subject "We got your payment" when extras are still due; host/owner messages claimed once per charge via `charge.toldAt` (CAS; sent anyway if the mark can't be written) — the `threw` heuristic is gone; balance returns `paying` and the page shows the busy line with "Check again" instead of the form; a payment landing on a party cancelled meanwhile → owners get "Paid after it was cancelled. Check it. …" and the host gets no "paid" email.
- Note: /waiver still loads GA4 (only the pixel and recording are off there); not changed here. The prod host-page leak fix lives on this branch; it reaches prod only with the stage merge or a cherry-pick to dev on Kaden's go.
- New DRAFT copy for Kaden: "The amount changed. Refresh to see what’s due. Nothing was charged." / "A payment for this party is already going through. Check back in a few minutes." + "Check again" (page) / text "Hometown Studio here. Pay $25 here for the extras added to your party on Sat, Nov 8 at 1:30 PM {link}" / email subject "Pay for the extras on your party", "We added extras to your party on {when}." "Pay {amount} here for them." / page "Your party on {when} is paid. These extras were added since." / paid subject "We got your payment" / owners "Paid after it was cancelled. Check it. {host} paid {amount} by payment link for the cancelled party on {when}. Party {id}. Nothing was refunded."
- Tests: full suite 318 files, 4220 pass + 1 unrelated flake (admin-classes link-library concurrency; passes 3/3 alone, untouched code); tsc 0.

## Fix round 2

- Important (host key in PostHog autocapture): `ph-no-capture` on the only two in-site links that carry a party key, PartyModal "Open your party page" and RecentPartyBanner "View your party →" (grep of src/components and pages found no others; payment links are only sent by email/text). PostHog `before_send` now runs `window.__hsScrubKeys` (defined by PAGE_KEY_SCRIPT, first in `<head>` on every page), which removes any `key=` / `k=` query parameter from every string in an event (`$current_url`, `$referrer`, `$elements[].attr__href`, `$elements_chain`, …), keeping other params. Meta Pixel `fbq('set','autoConfig',false,PIXEL_ID)` was already set in `start()` and stays.
- Minor: the early amount check is skipped when the in-progress payment is this same attempt with its items; the claim then checks against that order's own quote, so the original order is retried (extra added meanwhile stays due).
- Tests: scrubber on a sample autocapture event + PostHog wiring by source (tests/lib/page-key.test.ts); PartyModal link has `ph-no-capture`; new tests/components/party/RecentPartyBanner.test.tsx (stubs localStorage: Node's built-in one shadows jsdom's); same-attempt retry after an extra → 200, same order request, extra still due. Focused: 20 files / 392 pass; tsc 0.
