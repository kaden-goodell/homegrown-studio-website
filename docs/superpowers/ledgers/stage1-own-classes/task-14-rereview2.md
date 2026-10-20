# Task 14 re-review 2 (fix round 2)

Range 7bf0de5..68a8514 (6 commits), branch kaden/own-booking-system. Reviewed 19 Oct 2026.

**Verdict: Needs fixes.** 1 Important (small fix). Everything from re-review 1 is fixed. R33 and Q-F are right. N2 is right.

Checks:
- `npx vitest run`: 277 files, 3502 passed, 0 failed.
- `npx tsc --noEmit`: 0 errors.
- I wrote one throwaway test under `tests/zz-rereview2/` against the real ledger, ran it, then deleted it. The tree is clean apart from the untracked plan file that was already there.
- I did not do a hands-on this time. Code reading plus the scratch test covered the questions.

## Re-review 1 items

| # | Status | Evidence |
|---|---|---|
| N1 multi-day door seat paid by someone else's later sale | Fixed. A door seat is a candidate only if it was taken on the sale's Chicago day and also covers a session that day. There is a test for the day-1 seat and day-2 sale case. | `seat-ledger.ts:469-472`; test `seat-ledger.test.ts:518` |
| N2 retry says "Added" with no seat | Fixed. See "N2 adversarial" below. | `staff-seats.ts:77-88` |
| Q-A / R33 dead end on a no-join-partway class | Fixed, and it matches the server. See "R33" below. | `public-view.ts:33,39`; `CompSeatSheet.tsx:444-453` |
| Q-B door seat paid at the counter offers a Square refund | Fixed in the UI: it shows "Paid at the counter. Refund it at the register, then free the seat here." and offers only Free their seat. | `RefundPanel.tsx:129,280-281` |
| Q-C "pay at register" vs "Not paid yet" | Fixed on the roster, family card and print. A rung-up door seat no longer counts as unpaid. | `Roster.tsx:578`; `HouseholdCard.tsx:274`; `print.astro:254`; `staff-view.ts:91` |
| Q-D warning repeats the day | Fixed. | `warnings.ts:62-63,333` |
| Q-E counter note has no tickets and no "today" | Fixed: "Ring up 1 × Adult, 1 × Kid at the register today to pay for this seat." | `CompSeatSheet.tsx:275,420` |
| Q-F cancelled-class waiver page shows the form | Fixed. Kind `cancelled` sets `showForm:false`, so the page shows the notice only. The form can't post a signature for that class: `flowPropsFor` passes no `workshopId` for a non-live outcome, and `sign.json` re-validates any id it gets (`getEvent` returns null, so 404). | `waiver-page.ts:25-27`; `waiver.astro:73`; `sign.json.ts:300-320` |
| Q-G checkbox wrap | Fixed (`checkRow` nowrap). | `RefundPanel.tsx:26,291,315,332` |
| N3 an edited retry replays the first booking | Fixed. Any change to the ask gives a new attempt. See Minor m2 for the trade-off. | `CompSeatSheet.tsx:221-223` |
| N5 iPad over-capacity tick goes stale | Fixed: it clears when the option or day changes. | `ClassBookingPanel.tsx:324,343` |
| N6 iPad shows no "full" line until Continue | Fixed: "That day is full." shows as soon as the day is picked. | `ClassBookingPanel.tsx:735-739` |
| R34 several candidates: pay the oldest and flag it | Done, deterministic: ledger order, `candidates[0]`. The warning id is stable (`counter-match-<class>-<line>`). `markCounterMatchChecked` resolves it and the item drops from `listCounterMatchChecks`. **But see I1: it flags one family's own seats.** | `seat-ledger.ts:470-479,553-560`; `door-unpaid.ts:70-85`; `warnings.ts:336-341` |

## N2 adversarial

- **Never "Added" without a confirmed seat.** Replay counts only `confirmed` or `refunded` lines.
  - A live `held` line is confirmed first, inside one CAS mutate.
  - If the hold has expired, replay returns null, and the add goes through a fresh `hold()`.
  - `hold()` drops expired lines before its "already has seats" check, so the same booking id can hold again.
- **Never two seats for one attempt.**
  - Two retries at once: both see the live hold and both call `confirm`. The second one finds no held line plus paid lines and returns them unchanged (`seat-ledger.ts:213`).
  - Two fresh holds at once: the second hits "already has seats", and its replay returns the first.
  - A re-hold after expiry replaces the expired line. It never sits beside it.
- **Expired re-hold respects capacity.** It is a normal `hold()`, so it checks capacity unless the crew's request carries `overCapacity`. That is `allowOverCapacity` only when ticked (`staff-seats.ts:69`). A full session answers `sold_out`, and the sheet shows the over-capacity choice.
- Residual edges are Minors m3 and m4.

## R33

- **Single-session classes are unchanged.** The first session ending is the same moment the only session closes.
- **Join partway ON is unchanged.** `wholeClassClosed` requires `!joinPartway`.
- **The door view matches the server exactly.** In door mode, `sessionsForPass` (`pricing.ts:47-52`) closes every pass, `remaining` included, once `sessions[0].endIso` has passed. `public-view` uses the same moment, so no pass is offered that the server would refuse, and none is hidden that it would accept.
- **Door-card checkout (iPad) is consistent.** It is reachable only through CompSeatSheet, which stops at the "closed" block before "How are they paying?". The panel prices with `quote(..., { door: true })` (`ClassBookingPanel.tsx:251`), the same function and options the server uses.

## Important

**I1. R34 flags one family's own seats as an ambiguous match.**
- What happens:
  - A family takes 2 seats at the door, pay at the counter. That is one booking with 2 lines.
  - Then they pay with one 2-unit sale at the register.
  - On the first unit, both of their own lines are "candidates" (`candidates.length === 2`), so line 1 gets `counterMatch {candidates: 2}`.
  - Owners then see "Counter sale on Thu Oct 22 was matched to Ann Lee. Check it was them."
- Proven with a scratch test against the real ledger. Result: `[{b:"bkg_fam", o:"F", cm:{candidates:2, checked:null}}, {b:"bkg_fam", o:"F", cm:null}]`.
- Why it matters: this is the most common door-counter case (a parent and a kid). Every one of them puts a false "check it was them" item in the warnings panel, the daily owner email and To decide. The real R34 signal gets buried.
- Where: `seat-ledger.ts:470-478`.
- Fix, two parts:
  - Count distinct `bookingId`s among the candidates, and flag only when there is more than one.
  - Better still, once a unit of this sale has claimed a booking's seat, prefer that booking's remaining seats for the next units.
- Optionally: also don't flag when the sale's remaining units cover every candidate. Two walk-ins, one sale for both, is not ambiguous.
- Add a test for one booking with 2 seats and one 2-unit sale: expect no `counterMatch`.

## Minor

- m1. The counter-match warning line doesn't name the class. The panel and the email render only `w.line`, which for this code skips the day and title prefix. Two classes on one day would read the same. Fix: add the class name to the detail. `warnings.ts:339`
- m2. N3 trade-off. After a lost reply where the seat *was* added, a crew member who fixes a typo (for example the phone) and taps Add gets a new attempt, so a second seat. It fails visibly, because the roster shows 2, but it reverses the old behaviour. Acceptable. Optionally leave contact fields out of `askShape`. `CompSeatSheet.tsx:222`
- m3. A narrow race in replay. `live` is judged at the request's `now`. If another request with a later `now` sweeps that hold in the sub-second gap before `confirm` runs, `confirm` falls back to rebuilding confirmed lines with capacity ignored, even without the over-capacity tick. The lines are marked `overCapacity`, so it is visible. `staff-seats.ts:81-83`
- m4. `quote()` runs before replay. So a retry of an add that *was* confirmed, coming after the session ended (or after R33 closed the class), answers "Sign-ups for this have closed" even though the seat exists. It is safe, but the message is misleading. This predates this round. `staff-seats.ts:50-51,89`
- m5. N1 kept the "covers a session on the sale's day" check. A door seat sold ahead on a day with no session, then rung up that same day, isn't claimed, so you get 2 seats plus a door-unpaid warning. It fails safe. The taken-day check alone would cover it. `seat-ledger.ts:472`
- m6. On the iPad, with a pick-a-day option, "That day is full." can show before any day is picked: `roomLeft = pass.left` when nothing is picked. `ClassBookingPanel.tsx:236-240,737`
- m7. The Q-B register-only refund is a UI guard only. `class-refund.json` doesn't refuse a Refunds-API refund on a door seat paid at the counter (the same as for `pos` in M5). Pre-existing, and noted here only.
- m8. `listCounterMatchChecks` still lists a flagged line after that seat is refunded or freed, until someone marks it checked. It is resolvable, so this is fine. If wanted, skip lines whose seat is `released`, or `refunded` with the seat freed. `door-unpaid.ts:75`

## Counts

Important 1 (I1). Minor 8. Every item from re-review 1 is fixed. R33, R34 (apart from I1), N2 and Q-F were checked adversarially.
