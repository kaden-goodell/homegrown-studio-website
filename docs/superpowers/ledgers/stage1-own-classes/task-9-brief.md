### Task 9: Public list and booking panel for our classes

**Files:**
- Create: `src/lib/classes/public-view.ts` (ScheduledClass → `WorkshopData` + new optional fields)
- Modify: `src/pages/api/workshops.json.ts` (merge legacy + ours; ours excluded when draft/cancelled/linkOnly; sorted by first session)
- Modify: `src/components/workshops/WorkshopExplorer.tsx` (`WorkshopData` gains `own?: { classId: string; sessions: {id,startIso,endIso,left}[]; passes; ticketTypes; prices; questions; addOns; rules }`)
- Create: `src/components/classes/ClassBookingPanel.tsx` (used when `own` is present; legacy `WorkshopBookingModal` stays for Square classes)
- Create: `src/pages/classes/[id].astro` (direct link page, works for link-only)
- Modify: `src/components/workshops/workshop-status.tsx` (`priceLabel` from cells: "From $15" when several prices, "$20 adult · $15 kid" when one pass and ≤ 3 tickets)
- Test: `tests/lib/classes/public-view.test.ts`, `tests/components/classes/ClassBookingPanel.test.tsx`, extend `tests/api/workshops-list.test.ts`

Panel steps: (1) pass picker (only when > 1 pass) and session picker for `choose`; (2) ticket counters per type (min 0 each, total ≥ 1, ≤ maxPerBooking and ≤ seats left on every picked session); (3) per-seat questions and add-ons; (4) contact + payment with `PaymentForm` (merchant app id, **no** `environmentOverride`, wallet for any seat count) and a summary listing lines and tax, total only on the Pay button; (5) booked screen. Calls `/api/classes/book.json` with one token.

- [ ] **Step 1: Failing tests:** public view hides drafts/link-only, sold-out per session, `left` per session; panel: pass switch resets sessions; choose-N requires N; counters cap at seats left; Pay shows `quote` total (client uses the same `quote` function from Task 2 for display); body sends `{ classId, passId, sessionIds, tickets, seats, attemptId, paymentToken, customer }`.
- [ ] **Step 2–4:** run, implement, pass.
- [ ] **Step 5: Commit** `feat(classes): public list and booking panel for our own classes`.

