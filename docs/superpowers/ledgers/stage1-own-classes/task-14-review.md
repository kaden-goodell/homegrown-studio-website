# Task 14 review: /staff console on the seat ledger

Range 5e4b167..ef669cf (19 commits), branch kaden/own-booking-system. Reviewed 19 Oct 2026.

**Verdict: Needs fixes.** 2 Important, 12 UX quirks, 9 Minor.

The ledger writes are sound. Comp, door-counter and door-card all go hold then confirm. Comp lines are $0. Door-card goes through the same book.json pricing, the R14 drift rule and the idempotency key. Replays of a POS sale add nothing. The B1 waiver link, R28, M6, M7 and M8 are all correct. Two things block approval. First, a counter sale can be booked against the wrong person's door seat, and nothing flags it. Second, on /staff the crew can't see the reason box the refund needs, so a crew refund looks broken.

Checks:
- `npx vitest run`: 276 files, 3474 passed, 0 failed.
- `npx tsc --noEmit`: 0 errors.

Hands-on setup:
- I seeded the local blob stand-in (`.netlify/blobs-serve/entries/0/site:<store>/…`). The class was "REVIEW Pumpkin Camp". It had 3 sessions: Tue 20 Oct (capacity 4), Thu 22 Oct, and Mon 2 Nov, which is after the DST change. Join partway was off. It had two ticket types (Adult and Kid), passes "All three days" and "One day", one question, and a minimum of 6.
- Ledger: an online booking with 2 seats, a comp, an unpaid door-counter seat, and a POS counter sale with no name, marked overCapacity.
- Also seeded: one signed waiver filed under the class, one plain-refund flag, and one unmatched POS sale.
- Ran `astro dev` on :4333. Screens checked at 1280, at 1024 (iPad, in a 1024 iframe because the window would not resize), and at 390 (phone).
- Writes I made, all to the local store only: one comp ("Add anyway, over capacity") and naming the counter sale with "Who is it?". Nothing charged, refunded, emailed or texted. The only Square traffic was read-only calls to list bookings and classes.
- All seeded and created files are removed, the server is stopped and the tab is closed.

## Spec / requirement table

| # | Requirement | Status | Where |
|---|---|---|---|
| 1 | Our classes are StudioEvents. The id is the class id, the days come from the sessions, and seats and capacity are counted per session from the ledger. Legacy classes are kept. | Met | `src/lib/events.ts:142-178`; `src/lib/classes/staff-view.ts:36-40` |
| 2 | A multi-day class shows on each of its days in This week, with that day's seats. Tested. | Met. Seen live: "6 of 4 booked" on Tue and "2 of 8" on Thu. | `src/pages/api/staff/week.json.ts:33-46`; `ThisWeek.tsx:46-50`; `tests/api/staff-week.test.ts` |
| 3 | Today and event lookups use that day's session. | Met | `src/pages/api/staff/events.json.ts:33` (`eventOnDay`) |
| 4 | The roster reads bookings from the ledger. A counter sale shows "Counter sale, no name yet". Names are filled from the waiver at check-in with `setNames`. | Met. Seen live, and naming worked. | `src/lib/classes/staff-roster.ts:38-77`; `src/pages/api/staff/class-names.json.ts`; `Roster.tsx:51-112` |
| 5 | comp-seat for our classes uses hold and confirm with source comp or door-counter, and no Square dashboard. | Met | `src/pages/api/staff/comp-seat.json.ts:244-345`; `src/lib/classes/staff-seats.ts` |
| 6 | Door-card: "Pay on the iPad" opens ClassBookingPanel in door mode with source door-card. It uses the same server pricing and the R14 rule. | Met | `book.json.ts:61-70,168-177,310`; `ClassBookingPanel.tsx:218-221,448`; `CompSeatSheet.tsx:246-256` |
| 7 | CompSeatSheet has pickers for pass, ticket and day. | Met. See quirks Q3–Q7. | `CompSeatSheet.tsx:68-119,259-296` |
| 8 | StaffCalendar is read-only, and Calendar is on the /staff nav. | Met | `StaffCalendar.tsx`; `nav.tsx:20`; `src/pages/api/staff/calendar.json.ts` |
| 9 | Warnings: oversold shows "41 of 40", minimum-to-run short, unmatched POS sales, refund flags and pos-needs-days. Read-only for crew. | Met. Seen live: "6 of 4 booked", unmatched POS line with no Open button, "$20 was refunded in Square". | `src/lib/warnings.ts:271-339`; `WarningsPanel.tsx:80-88` |
| 10 | B1: `/waiver?workshop=cls_…` resolves, sign.json files the signature under ('workshop', cls_id), and print day shows waiver status. | Met. The live link resolves to "REVIEW Pumpkin Camp · Tue, Oct 20, 5:00 PM CT". The print day lists the signed household. | `src/lib/waiver-event.ts`; `events.ts:180`; `tests/api/waiver-own-class.test.ts`; `admin/classes/day.json.ts:74` |
| 11 | I1: crew can refund from /staff with a reason, logged with their name, through class-refund.json and the shared RefundPanel. | Partly. The code path is right, but the reason box can't be seen. See **I2**. | `Roster.tsx:108`; `src/pages/api/staff/class-refund.json.ts` |
| 12 | I2: warnings show refund flags, unmatched POS sales and pos-needs-days. | Met | as #9 |
| 13 | I7/R28: when join partway is off, every pass closes at the first session's start minus the cutoff. | Met. Door sales count to the session's end, which is consistent. | `pricing.ts:48-54`; `checkout.ts:69-76`; `public-view.ts:36,44-48`; tests in `tests/lib/classes/pricing.test.ts` |
| 14 | M6: the invite has one VEVENT per session. | Met. The Google link holds one date, so it shows only for single-date bookings. | `confirmation.ts:83`; `party-share.ts:40-60`; `ClassBookingPanel.tsx:537-570` |
| 15 | M7: the sitemap lists open, non-link-only `/classes/<id>` pages. | Met. The sitemap is now SSR with 1 h caching. | `src/pages/sitemap.xml.ts` |
| 16 | M8: a content-only edit never re-checks clashes on sessions that have ended. | Met | `admin-actions.ts:301-305` |
| 17 | T13(a): a half-finished "It went through" is flagged overnight. | Met | `square-events.ts:672-692,740-744` |
| 18 | T13(b): when a retried "Refund again" is already finished, it shows "Refunded $X." and calls onDone. | Met | `RefundPanel.tsx:161-165` |
| 19 | T13(c): the "Refund again" id is bound to inputHash. | Met | `refunds.ts:407-411` |
| 20 | T13(d): /staff uses `again:{of, token}` and "I checked Square" with a crew reason. | Met in logic. The same invisible-input problem (I2) applies to "What you saw in Square". | `RefundPanel.tsx:150-200` |
| 21 | R27: setters for pos-needs-days and for resolving flags. | Met at library level. No route or UI yet; that is 11b-C's job. | `square-events.ts:776-830`; `seat-ledger.ts:516-534` |
| 22 | R6: money taken always means a seat is recorded. | Met. Door-card goes through book.json's confirm fallback. | unchanged `seat-ledger.ts:195-235` |
| 23 | R22/R23: refund defaults and "Free their seat". | Met. Inherited by the shared panel. | `RefundPanel.tsx:122-127,244-260` |
| 24 | Staff routes require staff sign-in and can't do owner-only things. | Met. Every new route checks `staffAuthorized`. event-meta refuses our classes. The calendar is read-only. door=1 returns 401 when not signed in. | `class.json.ts:19`, `class-names.json.ts:22`, `calendar.json.ts:20`, `event-meta.json.ts:106`, `book.json.ts:66` |
| 25 | Legacy Square classes are unchanged. | Met. Only `cls_` ids branch off. Seen live: the Square classes still list on This week and Calendar. | `events.ts:180`; `comp-seat.json.ts:73` |
| 26 | Time zones: America/Chicago and DST on Nov 1. | Met. Nov 2 shows 5:00 PM CST. Calendar windows switch from 05:00Z to 06:00Z at Nov 2. Days are worked out with `studioDate` and `studioDayUtcRange`. | `staff-view.ts:39,45`; `events.ts:254`; `StaffCalendar.tsx:46` |
| 27 | The 3 clock-dependent tests in events.test are fixed. | Met. The tests use a fixed injected clock. | `tests/lib/events.test.ts` |

## Important

**I1. A counter sale can pay the wrong person's door seat, and an unpaid door seat is never flagged.**
- Where: `recordPos` at `src/lib/classes/seat-ledger.ts:455-465`.
- What it does: it takes the oldest unpaid door-counter seat with the same pass and ticket type. It doesn't check the session, how old the seat is, or who it belongs to.
- How it goes wrong: the crew adds Dora as "pay at the counter" and she leaves without paying. Any later POS sale of that pass and ticket is then booked against Dora's seat. That sale could be a walk-in for Thursday, or come days later.
  - The walk-in ends up with **no seat on the ledger**, so seats are under-counted and the session can be oversold.
  - Because the claimed seat already has its days, no pos-needs-days flag is raised (`square-events.ts:322`).
  - Dora's unpaid seat now reads "Paid at the counter", so the missing money disappears from view.
- Rule broken: "never a charge without a seat, never a seat without a charge."
- This is the implementer's concern 1. I rate it Important because it fails silently and has no time limit.
- Fix:
  - (a) Only claim a door seat whose sessions include the sale's session(s). For a choose-N sale, only claim a seat taken on the same studio day, within a few hours.
  - (b) Add a warning: "Dora Door: seat taken to pay at the counter, not rung up" once the session has ended.

**I2. The crew refund needs a reason, but the reason box can't be seen, and a disabled "Confirm refund" looks enabled.**
- Where: `src/components/shared/RefundPanel.tsx:18,205-210,326`. Seen live at 390 and at 1024.
- The cause: the inputs use a style with no border (computed border is 0px, white on a white card). The `btn btn-primary` class doesn't dim its disabled state on /staff (opacity is 1 and the pointer cursor stays). There is no hint either.
- What the crew sees: they tap Confirm and nothing happens. They never learn that a reason of 3+ characters is needed.
- The same applies to "What you saw in Square" (It went through / It didn't go through) and to the free-seat reason.
- This defeats I1 and T13(d) in practice.
- Fix: give the inputs a visible border (reuse /staff's `field` style or a shared token). Style the disabled state. Show "Add a reason (3 or more letters) to refund." under the button while the reason is too short.

## UX quirks (hands-on)

- **Q1.** On an unpaid door-counter seat, the roster says "Refund this one in Square, where it was paid." (`RefundPanel.tsx:258`). Nothing was paid. It should say "Not paid yet: ring it up at the counter," or show nothing.
- **Q2.** On a seat the crew squeezed in on purpose, the roster says "Over capacity. An owner decides on /admin." (`Roster.tsx:90`). That reads as an error the crew caused. For comp or door seats the crew chose to add over capacity, say "Added over capacity" in muted text.
- **Q3.** The comp/sell sheet pre-ticks the roster's day even when it is full. It shows "(full)" but says nothing until submit. Only then do the red line and "Add anyway, over capacity" appear, and "Add anyway" sits *above* a primary button that just repeats the refused request. Suggestions:
  - Warn up front ("Tue is full, 6 of 4").
  - Make "Add anyway, over capacity" the primary action once the day is full.
- **Q4.** After an over-capacity comp, the success screen says only "Added, no charge. No email sent." It doesn't mention that the seat went over capacity (the API returns `overCapacity: true`; the sheet ignores it, `CompSeatSheet.tsx:350`).
- **Q5.** In Sell a seat, once "Pay on the iPad" or "Pay at the counter" is picked, there is no way back to the choice. × on the iPad checkout closes the whole sheet.
- **Q6.** "Pay on the iPad" opens the checkout without the roster's day picked. When that day is full (the usual case at the door), card payment isn't possible at all: it shows Sold out and there is no squeeze-one-more. Then only "Pay at the counter" can seat someone. At minimum, pre-select the roster's day. Also consider allowing over capacity for door-card, the same as door-counter.
- **Q7.** The per-seat picks are labelled "Seat 1 · Pumpkin color", with no ticket type. With Adult and Kid seats, the crew can't tell which seat is the kid. The sheet also asks for "Adult seats / Kid seats" counts without tying them to the waiver people picked.
- **Q8.** The counter form shows "$25.00 each before tax" per ticket type but no total before submitting. The amount to ring up appears only after "Add".
- **Q9.** The printed roster's header uses the class's next session time, not the printed day's. For example: "Tue, Oct 20, 5:00 PM · Thu Oct 22" (`print.astro:178`). Use `eventOnDay(event, day)`.
- **Q10.** The printed roster doesn't say a door seat is still unpaid (it shows "Dora Door · 1 seat"; the screen says "pay at register"). It also doesn't flag "6 seats sold" against a capacity of 4.
- **Q11.** On the Calendar tab, closed days read "12–12 AM" (`StaffCalendar.tsx:103`). They should read "All day".
- **Q12.** The roster stat "6 of 4 sold" isn't styled red. This week shows the same overbooking in red.

## Minor

- **M1.** The implementer's concerns, assessed:
  1. Counter payment pays the oldest door seat: **Important**, see I1.
  2. RefundPanel is duplicated in `shared/` and `admin/`: **Minor**. 11b-B must switch /admin to the shared panel and delete the admin copy, or the two will drift. Keep it on the 11b-B checklist.
  3. 11b-C must use `setPosDays`, `decideRefundFlag` and the new `refund-unfinished` flag kind: **Minor, a handoff**. Until 11b-C ships, nothing in any UI resolves pos-needs-days or refund flags.
  4. The daily email repeats undated flags every day: **Minor**. Task 15 should send each flag once, or once a week.
  5. A cancelled class's waiver link says "not recognized … ask the studio for a fresh link": **Minor**. Better: "This class was cancelled. You can still sign the general agreement below."
  6. The implementer did no browser walkthrough: **resolved by this review**, which found I2 and the quirks.
- **M2.** comp-seat has no idempotency key. A retry after a lost reply adds a second seat. The legacy path has the same gap, and the button is disabled while busy. Consider an `attempt` token like book.json.
- **M3.** `nameSeatsFromWaiver` gives one family's name to every unnamed seat in the booking, i.e. all units of one POS order. That's fine for a typical order, but an order bought by two families would carry one name. Acceptable; it could be noted in the UI ("names all N seats").
- **M4.** "Who is it?" lists every household signed for the class, including ones already matched to a booking.
- **M5.** POS counter-sale bookings show a "Refund" button on /staff because they have a paymentId. That refunds a register sale, possibly cash, through the Refunds API. This was already the case before Task 14 (since Task 12). Confirm this is wanted, or send POS-sourced bookings to "Refund at the register".
- **M6.** Door-mode checkout still calls `trackPaymentCompleted`, so staff door sales count as site conversions in analytics. Memory says analytics are off on staff tools.
- **M7.** `listWarnings` now fails the whole panel when the class store can't be read. That's deliberate ("never an all clear"), but it also hides the Square and party warnings during a blob outage.
- **M8.** `listEvents` and the warnings read every class key on each Today/This week poll. That's fine at today's scale; consider listing only classes with sessions in the window, by index, later.
- **M9.** The ICS UIDs still start with `party-` for class sessions. This is cosmetic.
