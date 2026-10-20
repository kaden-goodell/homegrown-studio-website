### Task 9: Pay the balance online — payment link page and sender

**Files:**
- Create: `src/pages/party/pay/[id].astro`, `src/components/party/PartyPayPanel.tsx` (unpaid items, a crafts reminder, `PaymentForm` with wallets and gift cards, a paid screen)
- Create: `src/pages/api/party/balance.json.ts` (GET `?id&k` → `{ when, hostFirstName, packageName, items, dueCents, state }`; a wrong key answers exactly like a missing party, 404)
- Create: `src/pages/api/party/pay.json.ts` (POST `{ id, k, attemptId, paymentToken, sourceKind }`)
- Create: `src/lib/parties/payment-link.ts` (`payLinkUrl(origin, rec)`, `sendPaymentLink(rec, origin, by)`: email via `sendEmail` and text via `sendQuoText`, both through the preview reroute; appends `linkSent`)
- Modify: `src/lib/email.ts` (`sendPartyPaymentLinkEmail`, `sendPartyPaidEmail`)
- Test: `tests/api/party-pay.test.ts`, `tests/lib/parties/payment-link.test.ts`, `tests/components/party/PartyPayPanel.test.tsx`

**Flow (`pay.json`)**: rate limit → constant-time key match on `payToken` → record ours, booked → `due > 0` (else 200 "Already paid" with the receipt) → **`claimPaying`** through `updatePartyRecord` (10 min; another attempt in flight → 409 "A payment for this party is already going through. Check back in a few minutes.") → order for exactly the unpaid items at that moment (`attemptKey(attemptId,'order')`, `referenceId` = party id; the item ids go on the charge) → `judgeDrift` → `chargeOrder` → `updatePartyRecord`: set those items' `chargeId`, add the charge, clear `paying` → payments index → paid email to the host + owner text ("Balance paid") → reply. Declined → clear `paying`, 402. Unknown → keep `paying` 24 h, alert owners, 502. A cancelled party → 410 "This party was cancelled. Nothing was charged." The bookings gate does not apply (S2-R16).

Draft customer copy (Kaden reviews): text "Hometown Studio here. Your party on Sat, Nov 8 at 1:30 PM is held for you. Pay $300 here to finish booking {link}". Page heading "Pay for your party". Crafts line "Crafts are paid at the studio for whoever comes."

- [ ] **Step 1: Failing tests:** wrong/missing key 404 (same body); the host token does **not** open the pay page; pays exactly the due items and marks them; **"two payers"**: two different attempts at once → one 409 before any order, one charge; the same attempt retried after success → "paid", no second charge; due 0 → no Square call; cancelled → 410; drift rules as Task 7; **"items added after the order stay due"**; gate closed still lets a link payment through; the sender writes `linkSent`, emails and texts the host, and on the preview both go to Kaden.
- [ ] **Step 2–4:** run, implement, run `npx vitest run tests/api/party-pay.test.ts tests/lib/parties tests/components/party` — PASS.
- [ ] **Step 5: Commit** `feat(parties): pay the balance online from a payment link`.

