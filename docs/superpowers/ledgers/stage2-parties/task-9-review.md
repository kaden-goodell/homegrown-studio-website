# Task 9 review: pay the balance by link (1cfc79b..4e657df)

Verdict: **Needs fixes** (2 Important, both small). The money path itself is sound: one charge per party under concurrency, prices only from the record, every payment recorded, unclear outcomes settled by asking Square.

Verification run at 4e657df: `npx vitest run tests/api/party* tests/lib/parties tests/components/party` → 23 files / 430 tests pass. `npx tsc --noEmit` clean. No dev server or 390px look (optional; skipped, no Square calls made).

## Requirements

| Requirement | Status | Where |
|---|---|---|
| Pay page + panel (unpaid items, crafts line, PaymentForm with wallets + gift cards, paid screen) | Met | src/pages/party/pay/[id].astro:13, src/components/party/PartyPayPanel.tsx:129-217 |
| GET balance `{when, hostFirstName, packageName, items, dueCents, state}`; wrong key = missing (404, same body) | Met (+receiptUrl) | src/pages/api/party/balance.json.ts:14-44 |
| POST pay `{id,k,attemptId,paymentToken,sourceKind}` | Met | src/pages/api/party/pay.json.ts:15-64 |
| Rate limit → constant-time key on payToken | Met | pay.json.ts:16; pay-balance.ts:87-92 (timingSafeEqual, length-guarded) |
| Ours + not cancelled; due 0 → 200 "Already paid" with receipt | Met | pay-balance.ts:99-104, 123-129 |
| `claimPaying` via CAS `updatePartyRecord`, 10 min, other attempt → 409 before any order | Met | pay-balance.ts:163-201; money.ts:43-51; party-store.ts:233-259 (Netlify Blobs onlyIfMatch, strong consistency) |
| Order of exactly the items unpaid at claim time, `attemptKey(attemptId,'order')`, referenceId = party id | Met | pay-balance.ts:171-188 |
| judgeDrift → chargeOrder → mark those items, add charge, clear paying, index, host email + owner "Balance paid" | Met | pay-balance.ts:241-261, 304-378 |
| Declined → clear paying, 402; unknown → paying 24 h, alert, 502; cancelled → 410; no bookings gate | Met | pay-balance.ts:255-260, 275-289, 124/165; pay.json has no gate |
| `payLinkUrl`, `sendPaymentLink` (email + text through preview reroute, `linkSent`) | Met | src/lib/parties/payment-link.ts:25-90 |
| `sendPartyPaymentLinkEmail`, `sendPartyPaidEmail` | Met | src/lib/email.ts (end of file) |
| Tests from Step 1 (wrong key, host token, exact items, two payers, replay, due 0, cancelled, drift, items added later, gate closed, sender, preview) | Met | tests/api/party-pay.test.ts (22), tests/lib/parties/payment-link.test.ts (6), tests/components/party/PartyPayPanel.test.tsx (7). Two-payers test uses a real etag CAS mock with a yield between read and write: genuinely concurrent. |
| "Record ours, **booked**" | Partly (harmless) | status is only `booked`/`cancelled` (party-store.ts:71), so "not cancelled" = booked today |

## Link key security

- Unguessable: `payToken` = randomUUID without dashes (~122 bits), checkout.ts:245 / party-store.ts:190. Good.
- Separate from host key (S2-R6): only `payToken` is compared; host key test exists (party-pay.test.ts:173). payToken is not returned by any public API (only hostToken in book.json). Good.
- Constant-time compare: yes. (Pre-existing `hostTokenValid` at party-store.ts:262 uses `===`; minor, not this task.)
- Can't pay another party: the record is loaded by id and the key checked against that record; the order's referenceId and the record write use the same id. Good.
- Works only while something is due: pay is a no-op at due 0 ("Already paid"); cancelled → 410. The key itself never expires and there is no revoke/rotate. Acceptable for this business (the key only lets someone see the first name, date and amount and pay it); note for Task 11/13 if an owner ever needs to kill a link.

## Concurrency

- Two different attempts at once: CAS claim, one wins, the other re-reads and sees `busy` → 409 before any order. Tested.
- Same attempt retried after success: `charges[].attemptId` replay, no Square call. Tested.
- Same attempt in parallel (double submit is blocked client-side by `processing`): both reach Square with the same order key (same order) and the same payment key `attemptId:pay`; a second token under that key gives IDEMPOTENCY_KEY_REUSED → treated as unknown, never declined (checkout-attempt.ts:82). Safe.
- New attempt after an earlier one ran out: `settleEarlier` asks Square about the old order first; can't ask → 409; paid → recorded, no new charge. Tested. This, not the 24 h timer, is the real guard.
- Host pays while an owner charges a card later: Task 11 is not built. `PartyPaying.via` has `'admin-card'` and the claim is shared; Task 11 must go through `claimPaying` and `recordLinkCharge` needs generalising (report concern 4). Handoff, not a defect here.
- Owner cancels while a link payment is in flight: the money is still recorded on the cancelled party and the owners get "Balance paid". No auto refund (correct per rule), but nothing warns that a cancelled party just took money. Minor handoff to Task 13 (To decide).

## Amounts

- Server-side only: the order is built from `r.items` inside the claim; the client sends no amount. Items added after the order stay due and are paid by the next link payment. Tested (party-pay.test.ts:270).
- **But see Important 1**: the amount the host sees is not checked against what is charged.

## Unclear outcome and webhook ordering

- Unknown charge → `paying.state='unclear'`, `until` +24 h, owners texted with party id and order, 502; client keeps the attempt id. A same-attempt retry re-creates the same order and asks `findOrderPayment` first. Good.
- Small gap: a same-attempt retry during the 24 h block runs `claimPaying`, which resets `until` to now+10 min and `state` to `charging`; a decline on that retry then clears `paying` entirely. Safe in practice (the shared payment idempotency key means a charge that already landed comes back as KEY_REUSED, and any later attempt asks Square via `settleEarlier`), but the "24 h" promise in the owner text is not literal. Minor: keep `until = max(old, new)` for the same attempt in `claimPaying`.
- Webhook ordering: square-orders.ts checks the link order before "paid by another order", so a link payment never lands in To decide as paid-elsewhere. While the request is inside 5 min the event is ignored ('in-flight') and returns without recording; if the request then dies after charging, the payment is picked up by the nightly reconcile, by `settleEarlier` on the next attempt, or by the event only if Square re-sends. Fine; worth a one-line note in the To decide / Task 13 handoff that an unclear link payment is not listed there (report concern 1 — agree, Task 13 should list `paying.state==='unclear'`).
- After a new attempt replaces `paying`, a very late payment on the old order falls through to paid-elsewhere (To decide). Correct.

## Important

1. **The host can be charged a different amount from the one on the button.** The panel shows `dueCents` from page load and sends no amount (PartyPayPanel.tsx:97); the server charges whatever is due at claim time (pay-balance.ts:171-188). If an owner adds an extra after the host opened the page (exactly the "extras added later" case this task is built for), the button says "Pay $300" and the card is charged $325; with Apple/Google Pay the wallet sheet was approved for $300 (PartyPayPanel.tsx:201). Drift checks don't catch it because the quote and Square agree. Fix: send `expectedCents` (the shown `dueCents`) and, inside the claim, refuse with 409 when `quotedCents !== expectedCents` before any order ("The amount changed. Refresh to see what’s due. Nothing was charged."), and reload the balance in the panel on that code. Test: add an item between `balance` and `pay` → 409, no order.

2. **The payment key (and the host page key) go to GA4, PostHog and Meta.** Layout.astro:52/107 load PostHog and Analytics.astro (gtag + `@lib/meta-pixel`) on `/party/pay/[id]?k=…` and `/party/[id]?key=…`. GA4 `page_location`, PostHog `$current_url` (and `$referrer` on the next in-site page), and the Meta Pixel `dl` all carry the full query string; the pixel only skips /waiver and /staff (meta-pixel.ts:18). Session recording is also on for both pages (host name, party date; the host page shows other families' children). Anyone with GA/PostHog/Meta Ads access (including the ads contractor) could open the pages. Fix, either or both:
   - Treat `/party/` like `/waiver`: no GA4/Meta on it (add to `PRIVATE_PATHS` and gate `<Analytics />` on the path) and `noRecording` for PostHog; and/or
   - Strip the key from the address bar before analytics loads: an inline script first in `<head>` doing `history.replaceState(null, '', location.pathname)`. The key already reaches the panel as a server-rendered prop, so the page keeps working; but a refresh then loses it, and the paid screen says "Refresh this page to pay it", so keep it in `sessionStorage` (try/catch) or change that line. PostHog's `before_send` can also drop query strings from `$current_url`/`$referrer`.
   - Referer: no explicit Referrer-Policy is set (nothing in netlify.toml/_headers/Layout). Browsers default to `strict-origin-when-cross-origin`, so third parties get the origin only today; add `<meta name="referrer" content="same-origin">` (or a `/party/*` header) on these pages so that stays true. The receipt link already has `rel="noreferrer"`.
   The host page exposure is pre-existing; one fix covers both.

## Minor

- Copy for an extras-only link: the text and email always say "is held for you … to finish booking" (payment-link.ts:37, email.ts) even when the package is already paid; the page says the same for `state: 'partly'`. Suggest a second variant when something is already paid, e.g. "Pay $25 here for the extras added to your party on Sat, Nov 8 at 1:30 PM {link}".
- Paid email subject "Your party is paid" when `stillDueCents > 0`; use "We got your payment" in that case.
- `claimPaying` same-attempt retry shortens the 24 h unclear block (see above).
- `recordLinkCharge` `created` heuristic after a thrown-but-landed write (pay-balance.ts:344) can, in a race with the webhook path, send the host email twice. Rare and harmless.
- Balance page doesn't reflect an in-flight/unclear `paying`; the host sees the form and gets the 409 message on submit. Could show the busy line directly.
- `pkgName` lookup failure silently falls back to the item label on the order lines; fine.

## Copy drafts (checked: no colons in customer copy, no "birthday")

Text "Hometown Studio here. Your party on Sat, Nov 8 at 1:30 PM is held for you. Pay $300 here to finish booking {link}". Page heading "Pay for your party". Crafts line "Crafts are paid at the studio for whoever comes." Email subjects "Pay for your party at Hometown Studio" / "Your party is paid". Refusals as listed in the report. Proposed new line for Important 1: "The amount changed. Refresh to see what’s due. Nothing was charged."
