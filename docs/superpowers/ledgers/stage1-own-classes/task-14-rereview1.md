# Task 14 re-review 1 (fix round 1)

Range ef669cf..7bf0de5 (6 commits), branch kaden/own-booking-system. Reviewed 19 Oct 2026.

**Verdict: Needs fixes.** 2 Important (both are small fixes), 7 quirks, 4 minor. Of the original findings, I2, Q1–Q12, M2–M7 and M9 are fixed. I1 is fixed except for passes that cover more than one day. M8 was left on purpose, and that is fine.

Checks:
- `npx vitest run`: 277 files, 3490 passed, 0 failed.
- `npx tsc --noEmit`: 0 errors.
- I wrote some throwaway adversarial tests under `tests/zz-rereview/`, ran them, then deleted them. The tree is clean apart from the untracked plan file that was already there.

Hands-on setup:
- Seeded `.netlify/blobs-serve/entries/0/site:*` with "REVIEW Pumpkin Camp". Sessions: Sun 18 Oct (already ended, capacity 6), Tue 20 Oct (capacity 4), Thu 22 Oct, and Mon 2 Nov (after the clocks change). Ticket types Adult and Kid. Passes "All four days" and "One day". One question.
- Ledger lines: one online booking with 2 seats, one comp over capacity, an unpaid door seat on the ended Sunday (Dora), an unpaid door seat on Tuesday (Ed), an unnamed 2-seat counter sale over capacity, and a door seat paid at the counter on Thursday (Paula).
- Also seeded: one plain-refund flag and one cancelled class.
- Ran `astro dev` on :4335 and signed in as Catherine (crew).
- Screens were checked in a 1024 frame and a 390 frame, because the Chrome window would not resize.
- Writes I made, all to the local store only:
  - one comp over capacity on Tue, plus a replay of that same request
  - one pay-at-the-counter sale on Thu
- Nothing was charged, refunded, emailed or texted. The only Square calls were read-only booking lists and the team list at sign-in.
- All seeded and created files are removed (including 3 audit entries), the server is stopped and the tab is closed.

## Original findings

| # | Status | Evidence |
|---|---|---|
| I1 counter sale pays the wrong door seat | **Partly fixed, see N1.** Fixed for one-day passes: a sale on another day becomes its own seat. Still broken for multi-day passes. | `seat-ledger.ts:448-466`; `door-unpaid.ts` |
| I1(b) warning for an unpaid door seat | Fixed. Seen live: "Dora Door · REVIEW Pumpkin Camp · Sun Oct 18: not paid at the counter yet." Open goes to Sunday's roster. | `warnings.ts:327-331`; `door-unpaid.ts:33-52` |
| I2 refund reason box can't be seen, disabled button looks enabled | Fixed. Seen live: 1.5px border, 44px tall, 16px text. Confirm refund is dimmed (opacity .5, not-allowed cursor) with the hints "Add a reason to refund." and "Add an amount to refund.". Too large an amount shows "That is more than is left to refund." Free the seat hints "Add a reason to free the seat." | `RefundPanel.tsx:17-25,156-161,236-244,263-266,342-352` |
| Q1 unpaid seat says "refund in Square" | Fixed. Now says "Nothing was paid for this seat. Free the seat instead." | `RefundPanel.tsx:276-280` |
| Q2 crew over-capacity reads as an error | Fixed. Now says "Added over capacity on purpose." in muted text. A counter sale over capacity keeps the red owner line. | `booking-words.ts:31-34` |
| Q3 full day pre-ticked, nothing said until submit | Fixed. A full day is never pre-ticked. Ticking it shows "Add over capacity", Add is disabled, and the hint shows. | `CompSeatSheet.tsx:100-102,207-210,338-343,609-615` |
| Q4 success screen hides over capacity | Fixed. Seen live: "Added over capacity (7 of 4). Added, no charge. No email sent." | `CompSeatSheet.tsx:405` |
| Q5 no way back from a pay choice | Fixed. Back on the counter form. Back on the iPad first step returns to "How are they paying?". | `CompSeatSheet.tsx:607-609`; `ClassBookingPanel.tsx:915` |
| Q6 iPad checkout has no day and can't go over capacity | Fixed. Tue is pre-selected. Continue refuses without the tick ("That day is full…"). With the tick it goes to step 2. Server: `book.json.ts:312-313`. | `ClassBookingPanel.tsx:185-188,240-242,376-379` |
| Q7 seats not tied to tickets or people | Fixed. Seats now read "Adult 1 · Pumpkin color" and "Kid 1 · …", and each person in a household gets a ticket picker. | `CompSeatSheet.tsx:185-206` |
| Q8 no counter total before adding | Fixed. Seen live: "Ring up $49.05 at the counter, tax included." for 1 Adult + 1 Kid ($45 + 9%). | `CompSeatSheet.tsx:211-218,345-349` |
| Q9 print header shows the next session's time | Fixed. Shows "Tue, Oct 20, 5:00 PM". | `print.astro:32-35` |
| Q10 print hides unpaid seats and overselling | Fixed. Shows "7 of 4 seats booked · OVER CAPACITY" and "Ed Unpaid · 1 seat · Not paid yet · Over capacity", both in red. | `print.astro:189-193,260-269` |
| Q11 closed days read "12–12 AM" | Fixed. Seen live: Halloween weekend reads "All day". | `StaffCalendar.tsx:103` |
| Q12 oversold stat not red | Fixed. "7 of 4 sold" now shows in red. | `Roster.tsx:369-379` |
| M2 comp retry adds a second seat | Fixed for the normal lost-reply retry. Seen live: replaying the same body returned `replayed:true` with the same booking id, and the count stayed at 7. A new sheet uses a new attempt id, so a deliberate second comp still works (checked live). **See N2** for the hold-then-fail gap. | `staff-seats.ts:56-92`; `comp-seat.json.ts:294-302` |
| M3 / M4 naming a counter sale | Fixed in code: "Names all N seats on this sale."; families already booked are filtered out. Not seen live, because no waiver was seeded. | `Roster.tsx:53-54,94-95` |
| M5 counter-sale refunds | Fixed for source `pos`. **See Q-B** for door seats later paid at the counter. | `RefundPanel.tsx:127` |
| M6 analytics from door sales | Fixed. Client calls are silenced and the server skips reportBooking. | `ClassBookingPanel.tsx:151-171`; `book.json.ts:435` |
| M7 one bad store hides every warning | Fixed. Now one line, "Our classes couldn’t be checked for problems.", and the other warnings stay. | `warnings.ts:351-361` |
| M9 ICS uid prefix | Fixed: `class-`. | `party-share.ts`; `ClassBookingPanel.tsx:609` |
| Cancelled class waiver link (old M1.5) | Fixed, but see Q-F. | `waiver-event.ts:23-26` |

## R32, checked adversarially (scratch tests against the real ledger)

- **Sale after midnight for an evening class:** a 7–9 PM session on 22 Oct, rung up at 12:10 AM on 23 Oct (Chicago). The door seat is not claimed, so the sale becomes its own counter seat: two seats for one person, and Dora's warning stays. This fails safe, because an owner sees it. The studio closes at 9 PM, so this is unlikely. Minor (N4).
- **Daylight saving:** a 6–8 PM session on Sun 1 Nov (CST), rung up at 11:30 PM CST (05:30Z on 2 Nov). Claimed correctly; `studioDate` handles the change.
- **Two unpaid door seats on the same day:** the sale pays the oldest one in ledger order (`kept.find`). This is deterministic. Dora (first) shows "Paid at the counter", and Eve shows "Not paid yet", even if it was Eve who paid. The seat counts are right. Only the money is pinned to the wrong person. It shows on the roster and in the door-unpaid warning, but the wrong person is named. Accepted under R32, which rules on same day only. Minor (N4).
- **Multi-day pass: Important, see N1.**

## Important

**N1. A multi-day door seat can still be paid by a different person's counter sale on a later day.**
- Where: `seat-ledger.ts:449,465`.
- What it checks: a seat qualifies when *any* of its sessions falls on the sale's day. It does not check that the seat was *taken* on that day.
- Proven with a scratch test:
  - Dora takes "All four days" on Thu 22 as pay-at-the-counter and leaves without paying.
  - Wendy walks in on Fri 23, buys the same pass at the register, and the sale claims Dora's seat. The ledger is left with one line, `bkg_dora:door-counter:W`.
- What goes wrong:
  - Wendy has no seat, so the class is under-counted and can be oversold.
  - Dora's door-unpaid warning, raised after day 1, quietly disappears.
- This is the original I1 failure for every pass that covers more than one session ("all", "fixed", "remaining", and choose-N with N > 1).
- It also misreads R32 ("on the sale's own Chicago day"), which means the seat was taken that day.
- Fix: also require `studioDate(l.at) === saleDay`, the day the door seat was taken. Keep the session check if wanted. Add a test for this case.

**N2. A retried comp or counter add can say "Added" when no seat was kept.**
- Where: `staff-seats.ts:66-75`.
- What it does: `replay()` returns any line on the attempt's booking that isn't `released`, and that includes `held` lines.
- Proven with a scratch test, by making `confirm` fail once after `hold` succeeded (a blob write error or function timeout):
  - The sheet shows an error. The crew taps Add again (same attempt), and the replay answers `ok, replayed`, with the line still `held`.
  - Ten minutes later the hold runs out. `seatsTaken` = 0, but a retry still answers `ok, replayed`.
- What goes wrong: the comped person or counter seat silently vanishes from the roster. For pay-at-the-counter, the crew rings up a sale that then has no door seat to pay. This breaks "a retry must never add a second seat — and must never claim a seat that isn't there."
- Fix: in `replay`, when the lines are `held` and not expired, call `confirm(...)` (same fallback). When they have expired, treat it as no replay and hold afresh. Only `confirmed` (or `refunded`) lines count as already added. Add a test that fails `confirm` once.

## UX quirks (hands-on)

- **Q-A.** On a class with join partway off, once day 1 has ended:
  - The door view (`/api/staff/class.json`) still shows "One day" as open, with later days selectable (`public-view.ts:36` uses only the session end for door mode).
  - But `sessionsForPass` refuses every non-"remaining" pass (`pricing.ts:51-53`, R28, door included).
  - Comp, Sell at the counter and the iPad checkout all let the crew fill everything in, then answer "Sign-ups for this have closed." No money is at risk, but the crew is led into a dead end. This is from Task 14 itself, not this round.
  - Fix: make the door view use the same R28 rule (close the pass), or say up front "No joining partway: this class closed when it started."
  - Needs a ruling: may the crew comp a day-2 seat on such a class?
- **Q-B.** A door seat later paid at the counter still shows **Refund**, which goes through the Refunds API, possibly on a cash sale. Seen live on Paula, Thu. Only `source === 'pos'` gets "Refund this at the register" (`RefundPanel.tsx:127`). Extend that to `door-counter` seats with a Square order.
- **Q-C.** "Paid or comped, not signed in yet" lists Ed and Dora, whose seats were never paid, with a "pay at register" tag. The Bookings list right above says "Not paid yet". Use the same words in both places (`Roster.tsx:573`, `print.astro:251`).
- **Q-D.** The door-unpaid warning repeats itself on the screen: "Sun Oct 18 · Dora Door · REVIEW Pumpkin Camp · Sun Oct 18: not paid…". The line already starts with the day, and the title is the class (`warnings.ts:330`). Suggest: "Dora Door: not paid at the counter yet."
- **Q-E.** The "Now take $X at the counter" note says "ring up REVIEW Pumpkin Camp, One day":
  - It doesn't say which tickets (1 Adult, 1 Kid).
  - It doesn't say the sale must be rung up **today** for it to pay this seat (R32).
  - Where: `CompSeatSheet.tsx:413`.
- **Q-F.** The cancelled-class waiver page says "This class was cancelled. Nothing to sign." and then shows the full sign-in and new-agreement form underneath, which contradicts it. Say "You can still sign the general agreement below," or hide the form (`waiver-event.ts:25`).
- **Q-G.** At 390 in the refund panel, the "Free the seat so someone else can book it" checkbox sits on its own line above its text. Minor alignment issue.

## Minor

- **N3.** After a lost reply, if the crew edits the sheet (a different person or day) and taps Add, the same attempt replays the *first* booking. The success screen then shows the newly typed name (`CompSeatSheet.tsx:266`). Unlikely; consider a new attempt whenever the request body changes, or use the server's name.
- **N4.** Two R32 edges that were accepted: a sale after midnight becomes its own seat (fails safe, and a warning stays). On a busy day, the same-day claim is oldest-first, so the money can be pinned to the wrong person, though the seat count stays right.
- **N5.** The iPad "Add over capacity" tick (`ClassBookingPanel.tsx:188`) isn't cleared when the day or option changes. It is harmless, because the server marks overCapacity only when the seat really goes over, but it is stale state.
- **N6.** The iPad panel shows "Add over capacity" with no "Tue is full (7 of 4)" line until Continue is pressed. The comp sheet shows its hint straight away, so the two differ slightly.

## Counts

Important 2 (N1, N2). Quirks 7 (Q-A…Q-G). Minor 4 (N3–N6). Original findings: everything fixed except I1, which is partly fixed (N1); M8 deferred by design.
