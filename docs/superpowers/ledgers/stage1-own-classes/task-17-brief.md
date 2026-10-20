### Task 17: Sandbox end-to-end suite and the real-money checklist

**Files:**
- Create: `scripts/sandbox-e2e.ts` — runs against `https://kaden-own-booking-system--iridescent-croissant-494fc3.netlify.app` with `ADMIN_PASSCODE`/staff passcode from the branch env (never printed), using Square sandbox test nonces (`cnon:card-nonce-ok`, `cnon:card-nonce-declined`, `cnon:gift-card-nonce-ok`, `cnon:card-nonce-rejected-cvv`).
- Create: `docs/superpowers/plans/stage1-real-money-checklist.md`

E2E scenarios (each asserts the API result, the ledger via admin bookings API, and the Square sandbox order/payment via SearchOrders):
1. Create library class → schedule → appears in public list with right price label.
2. One-price booking of 3 → one payment, total = quote, tax per line, 3 ledger seats.
3. Adult+2 Kids → line prices 2000/1500/1500 + tax.
4. 4-session camp: full series and one-day pass; seats per session correct; choose-2 pass.
5. Join partway after session 1 (shift session times into the past via admin edit on a test class).
6. Sold out: capacity 2, book 2, third refused before charge.
7. Concurrent last seat: two bookings in parallel → one 200, one 409, one charge.
8. Declined card → nothing held afterwards, no order paid.
9. Gift card nonce pays.
10. Refund one seat freeing it → seats left +1, sandbox refund exists; goodwill refund keeps seat.
11. POS-style sale: create a sandbox order + payment for a class variation directly through the API (simulating the POS), run reconcile → counter seat appears; replay → no duplicate.
12. Cancel class → status cancelled, nobody refunded, Square item archived.
13. Clash: schedule over a blocked time and over a party slot → refused with message.
14. Link-only class: absent from list, bookable by link.
15. Edit with bookings: lowering capacity below sold refused.
16. Comp and door-counter from /staff → ledger lines, no Square charge.

- [ ] **Step 1:** write the script with a `--only N` flag and a summary table.
- [ ] **Step 2:** deploy the branch, run `npx tsx scripts/sandbox-e2e.ts`; every scenario PASS. Failures become new failing unit tests in the owning task, fixed, re-run.
- [ ] **Step 3:** write the real-money checklist (Apple Pay on prod, a real card, a POS sale, a refund) for Kaden.
- [ ] **Step 4: Commit** `test(e2e): sandbox end-to-end suite for our own classes`.

## Additions (binding, controller 2026-10-19)
- Secrets: the script reads ADMIN_PASSCODE and STAFF_PASSCODE from the process env ONLY (never prints, logs or writes them; refuses to run if missing with a one-line hint). Kaden runs it himself with:
  `! ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts`
  Put that exact line in the script's header comment and the checklist. The implementer does NOT fetch the passcodes and does NOT run the live E2E; it builds the script, a `--dry-run` that prints the plan, and unit tests for its helpers (assertions, cleanup, summary table) with mocked fetch.
- The script talks only to the preview URL (hard-coded allowlist; refuses any other host, incl. ourhometownstudio.com) and Square SANDBOX (connect.squareupsandbox.com) for its own order lookups using SQUARE_SANDBOX_ACCESS_TOKEN from env if present (else skips the Square-side assertions with a note).
- Every scenario names its test classes with a "E2E " prefix, link-only, and cleans up after itself (cancel class; nothing is ever refunded except in scenario 10 inside the sandbox).
- Scenarios also cover what landed since the plan: Refund again / already refunded (R29–R31), staff comp + door-counter + counter-sale naming (Task 14), import dry-run returns a shape (sandbox has no legacy classes), studio settings save → closure refuses scheduling there → restore (11b-C), To decide lists a seeded flag. Scenario 3 (Adult+2 Kids) uses ticket types on OUR classes (allowed now).
- Owed sandbox checks from Task 6 (progress.md): variation removal by omission in item upsert; cancel-hide by re-sending the full read object; create retry idempotency — each a scenario.
- Real-money checklist (docs/superpowers/plans/stage1-real-money-checklist.md): the spec's 6 tests + webhook subscription + the 4 live env vars (SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL, SQUARE_CLASSES_CATEGORY_ID, SQUARE_CLASS_TAX_ID) + "Bring in Square classes" dry run on prod + what to look at after each step. Plain words, numbered, for Kaden.
