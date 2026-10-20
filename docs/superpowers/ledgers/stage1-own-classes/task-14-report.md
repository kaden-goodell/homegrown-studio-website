# Task 14 report: staff console on the seat ledger

Status: DONE. Branch kaden/own-booking-system, BASE 5e4b167 → HEAD ef669cf (19 commits, not pushed).
Tests: full suite 276 files, 3474 passed, 0 failed (the 3 clock-dependent events tests are fixed). `npx tsc --noEmit` 0 errors.

## Commits
- 0db83b7 R28: no joining partway closes every pass (incl. choose-N/fixed) at the first session; cutoff counts from the class's first session. Door sales (`{door:true}`) keep a session open until it ends.
- 0b30e59 + 4928c78 Refund again id bound to inputHash (reused {of, token} with another amount/seats → 409 AGAIN_IS_STALE before Square); half-finished "It went through" flagged nightly (`refund-unfinished`, 10 min after the check); R27 setters `setPosDays`, `decideRefundFlag` (square-events) and `moveLines` (seat-ledger).
- 4a931cd M6 calendar invite: one VEVENT per session (email; panel offers "Add every date to your calendar").
- f7ca18a M7 sitemap: open, non-link-only `/classes/<id>` (sitemap now SSR, cached 1 h).
- 99c2685 M8 content-only edits never re-check clashes on ended, unchanged sessions.
- 2265911 events.ts: our classes (cls_) are StudioEvents (days from sessions, seats per session from the ledger, `own: true`, `sessions[]`); `eventOnDay`; `classes` source in listEvents; This week `byDay` (each day's time/seats/prep); Today uses that day's session; prep from ledger answers; events tests on a fixed injected clock.
- 12a1724 B1: `/waiver?workshop=cls_…` resolves (new `src/lib/waiver-event.ts`); signature files under ('workshop', cls_id). Print day waiver status now fills in.
- 3ebc80d / 4051aa5 roster.json for our classes (seats, family seat summary, day's bookings with waiting refunds, ticket labels); comp-seat.json own path (hold+confirm, source comp at $0 or door-counter at the class price, "squeeze one more" = overCapacity); `/api/staff/class-names.json` names a counter sale from a signed family's waiver (setNames); recordPos lets a counter POS sale pay a waiting door-counter seat instead of adding a second seat.
- e69088b Pay on the iPad: `/api/classes/book.json?door=1` (staff only, source door-card, `by` = crew member, running session sellable, no cutoff, no gate/rate limit); `/api/staff/class.json` (door view of the class); refund `already.askedId`.
- b7e32fb / a337395 shared RefundPanel (`src/components/shared/RefundPanel.tsx`): crew reason, again:{of, token} reused across retries, a retried repeat Square already finished shows "Refunded $X." and calls onDone, "A refund is waiting on Square" with It went through / It didn't go through + "What you saw in Square" (also opens from a 409 `pending`).
- d88789c Roster: Bookings section (name or "Counter sale, no name yet", seats today, how paid, over capacity), "Who is it?" naming, crew refund; Event settings hidden for our classes.
- 6a3168a CompSeatSheet own mode (option, day(s), ticket counts, picks; full day → "Add anyway, over capacity"; Sell asks "Pay on the iPad" / "Pay at the counter"); ClassBookingPanel `door` mode (never pre-fills or remembers the last customer on the shared iPad).
- 4f5a6c7 warnings: oversold "41 of 40 booked", below minimum before the first session, unmatched counter sales, pos-needs-days, refund flags (all "An owner decides on /admin."); panel hides Open when there's nothing to open.
- 70afa02 read-only Calendar tab (`/api/staff/calendar.json`, same shape as the admin calendar, drafts left out; class/party opens the roster on that day).
- ef669cf printed roster uses ledger seats; event-meta refuses our classes ("Change this class on /admin.").

## Shared with /admin (nothing under src/components/admin or admin.css was touched)
- `src/components/shared/RefundPanel.tsx` is a copy of the admin one plus the (b)/(d) fixes. /admin should import it and delete `src/components/admin/classes/RefundPanel.tsx`; tests copied to `tests/components/shared/RefundPanel.test.tsx`.
- For 11b-C "To decide": use `setPosDays(id, sessionIds, {by, role})`, `decideRefundFlag(id, action, {by, role}, lineIds?)` (refuses "Pick which seat to free." when more than one seat is held), and handle the new flag kind `refund-unfinished`.

## Concerns
1. A counter POS sale pays the oldest unpaid door-counter seat with the same class, pass and ticket. At a busy door the payment could land on the wrong person's seat (money attribution only, seats stay right). A door-counter seat that's never rung up just shows "Pay at the counter". No warning for it yet.
2. The daily warnings email now has our-class lines. Counter sales and refund flags don't depend on the date window, so they repeat every day until an owner decides (Task 15 may want to tune this).
3. Drafts and cancelled classes are off the staff console, so a waiver link for a cancelled class now says "not recognized".
4. Visual check was limited to dev-server route probes: sitemap, 401s on staff routes, and an unknown cls_ waiver link showing its notice. I did no browser walkthrough, because one would mean logging in and creating classes against the real local .env services.

## Fix round 1 (review task-14-review.md; rulings R32 and the coordinator's list)

Commits fad694c, 33b758c, b7fe88f, 3a99e90, dd40c8c, 7bf0de5. Full suite 277 files, 3490 passed, 0 failed; tsc 0.

- **I1 / R32.** A counter POS sale only pays an unpaid "pay at the counter" seat on the same class, pass and ticket, and only when that seat has a session on the sale's own Chicago day (`saleIso` = the order's closed/updated/created time). Otherwise the sale is its own counter seat. New `src/lib/classes/door-unpaid.ts` `listDoorUnpaid(now)` (kind `'door-unpaid'`, one per booking, once its first session has ended, 60-day lookback). /staff warnings show "<name> · <class> · <day>: not paid at the counter yet." **11b-C:** add these to To decide through `listDoorUnpaid`. The to-decide route lives on the admin branch.
- **Paper roster** shows the printed day's own time and seats ("6 of 4 seats booked · OVER CAPACITY" in red). There is a Bookings list ("Dora Door · 1 seat · Not paid yet · Over capacity"). The wording is shared with the screen through `src/lib/classes/booking-words.ts`.
- **I2.** RefundPanel fields use the site field style: visible 1.5px border, 16px text, 44px tall, bold labels. Disabled actions are dimmed (opacity .5, not-allowed cursor). Each one gets a one-line hint: "Add a reason to refund.", "Add an amount to refund.", "Pick a seat to refund.", "Add a reason to free the seat.", "Add what you saw in Square."
- **Unpaid door seat:** "Nothing was paid for this seat. Free the seat instead." with Free their seat. Crew over-capacity seats (comp, door-counter, door-card) show "Added over capacity on purpose." in muted text; other over-capacity seats keep the owner line. On /staff a counter (POS) sale says "Refund this at the register, where it was rung up." (M5), with no Refund button.
- **Comp and Sell:**
  - A full day is never pre-ticked and is labelled "Full".
  - A full selection shows an "Add over capacity" checkbox. The Add button is disabled until it is ticked, with a hint.
  - A server "full" answer leaves only Cancel and "Add over capacity".
  - The success screen says "Added over capacity (5 of 4)." The server now returns `over: {sold, capacity}`.
  - Seats are named by ticket and person, e.g. "Kid 1 · Glaze" or "Byron (Kid) · Glaze". A waiver household picks a ticket per person, and seats are ordered by ticket type, as priced (Q7).
  - The counter total is shown before adding (Q8).
  - Both pay choices have Back.
- **Pay on the iPad** starts on the roster's day. A full day or option can be picked at the door. "Add over capacity" must be ticked before Continue, and then book.json?door=1 accepts `overCapacity` (`allowOverCapacity`, seat marked overCapacity). Back on the first step returns to "How are they paying?".
- **Smaller fixes:**
  - The roster's sold stat turns red when oversold (Q12).
  - The crew calendar shows closed days as "All day" (Q11).
  - A cancelled class's waiver link says "This class was cancelled. Nothing to sign."
- **Minors:**
  - M2: door seats take an `attempt` token per sheet; a retry returns the same booking with no second seat, email or audit.
  - M3: "Names all N seats on this sale."
  - M4: families already on a booking aren't offered in "Who is it?".
  - M6: door mode sends no client analytics and no server reportBooking.
  - M7: a class-store outage shows one "Our classes couldn't be checked for problems." line and keeps the Square and party warnings.
  - M9: class ICS UIDs start with `class-`.
- **Not changed:** M8 (reading every class key per poll) is fine at today's scale. An index belongs with the archive/pruning work (Task 15/16). The RefundPanel duplication (M1.2) is still 11b-B's to remove on /admin.

## Fix round 2 (task-14-rereview1.md; rulings R33, R34 and the coordinator's list)

Commits da85148, 6ff58ff, c286aae, 58d509c, baf00fb, 68a8514. Full suite 277 files, 3502 passed, 0 failed; tsc 0.

- **N1.** A counter sale pays an unpaid door seat only when that seat was *taken* on the sale's Chicago day (`studioDate(l.at) === saleDay`), covers a session that day, and matches class, pass and ticket. A multi-day door seat from day 1 is never paid by a different person's sale on day 2 (tested).
- **R34.** If more than one unpaid door seat could have been the sale, the oldest is paid and the line carries `counterMatch {orderId, candidates, at, checked: null}`.
  - Warning: "Counter sale on <day> was matched to <name>. Check it was them."
  - For To decide: `listCounterMatchChecks(now)` (kind `counter-match-check`) and the resolver `markCounterMatchChecked(classId, lineId, by)` in seat-ledger. **11b-C wires these.**
- **N2.** A retry of the same attempt counts only confirmed or refunded seats as added. A live hold left by a try that failed before confirming is confirmed on the retry. An expired hold is held again from scratch under the same booking id. Both cases are tested: confirm failing once, and the hold running out.
- **R33 / Q-A.** When a class doesn't take people partway, the door view closes every pass once its first session has ended. The comp/sell sheet then shows "Sign-ups for this class closed when it started. Turn on joining partway in /admin to add people now." with Close only, so neither pay choice and no pass the server would refuse is offered.
- **Q-B.** On /staff, a door seat paid at the counter says "Paid at the counter. Refund it at the register, then free the seat here." It offers only Free their seat, no Square refund.
- **Q-C.** An unpaid door seat reads "Not paid yet" in Bookings, in "Paid or comped, not signed in yet", on the family card and on paper. A door seat already rung up no longer counts as unpaid.
- **Q-D.** The warning line is "Dora Door · Pumpkin Camp · Sun Oct 18 · not paid at the counter yet. An owner decides on /admin." with no repeated day.
- **Q-E.** The counter note says "Ring up 1 × Adult, 1 × Kid at the register today to pay for this seat."
- **Q-F.** A cancelled class's waiver page shows only "This class was cancelled. Nothing to sign.", with no form.
- **Q-G.** Refund panel checkboxes and radios stay on one line with their text.
- **N3.** Any change to the ask (person, option, days, seats, picks) makes a new attempt, so a replay can never show a different person.
- **N5.** The iPad "Add over capacity" tick clears when the day or option changes.
- **N6.** The iPad shows "That day is full." as soon as a full day is picked.
- **Accepted, unchanged (N4):** a sale rung up after midnight becomes its own seat (fails safe, and the warning stays). Several candidates are matched oldest first, now with the R34 check.

## Fix round 3 (task-14-rereview2.md)

Commits b0f1a87, 055437d, ba1b7e1, 96cd073. Full suite 277 files, 3508 passed, 0 failed; tsc 0.

- **I1.** A counter-match check (R34) is raised only when unpaid door seats from more than one booking could have been the sale, and only once per booking per sale. A multi-unit sale pays the oldest booking first, then that booking's seats in order, and keeps filling it. A family paying its 2 seats with one 2-unit sale raises no check. Both cases are tested.
- **m1.** The check names the class: "Counter sale of <class> on <day> was matched to <name>. Check it was them."
- **m8.** A matched seat that was since freed (refunded with the seat freed) or released drops off the list.
- **m2.** The add attempt changes with option, days, tickets, picks, the waiver people and the found customer. Typos in name, email or phone keep the same attempt.
- **m3.** On a retry, a hold is confirmed only while it is still running. `confirm(..., { requireLiveHold: true })` writes nothing when the hold has gone. A lapsed hold is held afresh, so capacity is checked again: the normal full message, unless Add over capacity was ticked. Tested.
- **m4.** A retry of an add that was already confirmed answers "Added" (replayed) before any price or closed check, even after the session ended. Tested.
- **m6.** The iPad's "That day is full." shows only once a day is picked. Tested.
- **m7.** The server refuses a Square refund on a counter (pos) sale or a door seat paid at the counter, from both /admin and /staff: 409 "Refund this at the register, then free the seat." Freeing the seat with no money still works. Tested.
- **m5:** accepted as fail-safe, unchanged.
- **Commit labels:** the `requireLiveHold` option on `confirm` (for m3) went into b0f1a87 with the seat-ledger changes, so b0f1a87 and 055437d together make the m3 fix.
