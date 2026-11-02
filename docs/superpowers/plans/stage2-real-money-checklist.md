# Stage 2: parties on our own records, tested with real money

For Kaden. Nothing here is run by Claude. Parts A and B use no real money.
Part C goes on the live site only when **you** decide to switch parties over
(the branch never reaches production without your go). Each step says what
to look at afterwards. If something doesn't look right, stop there and tell
me what you saw.

Part D points to Catherine's guide, which is in the app: /admin, More, Help.

## A. The sandbox run (no real money)

0. **Where to run it from, and what must be on the preview first.**

   - Run everything below from `~/source/homegrownStudio-admin` (this
     branch's folder; once the stages are merged, the folder of the final
     branch). The main folder `~/source/homegrownStudio` is on `dev` and has
     no `scripts/sandbox-e2e.ts`. Both folders are linked to the Netlify site,
     so `npx netlify env:get` works from either.
   - Push the branch to `kaden/own-booking-system` and wait for its branch
     preview to finish deploying. The run tests what the preview runs, not
     your folder.
   - The branch's settings, each set once (each line changes the branch
     preview only, never production; redeploy the preview after changing any):

     ```
     npx netlify env:set BOOKINGS_OPEN parties,workshops --context branch:kaden/own-booking-system
     npx netlify env:unset DEV_BYPASS_PAYMENT --context branch:kaden/own-booking-system
     ```

     plus `SQUARE_PARTY_CRAFT_CATEGORY_ID`: in /admin on the preview, More,
     "Set up sandbox"; it prints the exact `env:set` line for the branch.
     Without it every party scenario says SKIP with that same instruction.
     If `BOOKINGS_OPEN` leaves parties out, or `DEV_BYPASS_PAYMENT` is on,
     the scenarios say so and fail.
   - On the preview, Parties setup's "Up to (days ahead)" must be 90 or
     more (the test days are 3 to 12 weeks out). If it isn't, the run stops
     at the start and says so.

1. Run it, from that folder, in Claude Code:

   ```
   ! SQUARE_SANDBOX_ACCESS_TOKEN="$(npx netlify env:get SQUARE_ACCESS_TOKEN --context branch:kaden/own-booking-system)" ADMIN_PASSCODE="$(npx netlify env:get ADMIN_PASSCODE --context branch:kaden/own-booking-system)" STAFF_PASSCODE="$(npx netlify env:get STAFF_PASSCODE --context branch:kaden/own-booking-system)" npx tsx scripts/sandbox-e2e.ts --only 24-40
   ```

   The branch's `SQUARE_ACCESS_TOKEN` is the sandbox token (the branch runs
   `SQUARE_ENVIRONMENT=sandbox`). With it, every order, payment and refund
   is also checked on Square's side, and scenario 40 and the To decide half
   of 27 run; leave the first `SQUARE_SANDBOX_ACCESS_TOKEN=…` part out to
   skip those. Nothing is printed or saved.

   It only talks to the branch preview and the Square sandbox and refuses
   any other site. How long: 24–40 alone is a few minutes (about 16 calls
   go through a 4-a-minute gate, plus the preview's own time). The full run
   (leave out `--only 24-40`, classes 1–23 too) is about 25 minutes.

2. What to look at: the table at the end. Every line should say PASS (40
   says SKIP without the sandbox token). After the table it prints "Putting
   back what the run changed: done: take the test package, extras and days
   out of Parties setup". A FAIL line says what was expected and what came
   back; send me the table.

3. What it does to the preview while it runs: Parties setup gets a $1 "E2E
   … Test party" package (Only with the link), a $1 "E2E … extra half hour"
   (offered on the website, because scenario 29 books it on /book), a
   $1-a-guest "E2E … bags" (not offered on the website, owners only), and
   twenty dated party days at 4 AM and 6:30 AM on Mondays to Wednesdays
   three or more weeks out. Dated days apply to every package, so **while a
   run is going, the preview's /book shows those 4 AM times and the extra
   half hour to anyone. Don't walk through the preview (part B) during a
   run.** The live site never sees any of it. Every test party's host is
   "E2E …", with kaden+e2e@ourhometownstudio.com and your phone. Expect
   booking emails, payment links and texts, all to you (the preview sends
   every email and text to you anyway). Each scenario cancels its parties
   when it ends (cancelling never refunds) and taps "I told them", so no
   "Host not told yet" is left in To decide. Only scenarios 35, 36, 37 and
   40 refund, and only sandbox money.

4. **If a run stops part way**: Ctrl-C first halts the running scenario
   (it stops at its next call; a call already on its way gets up to 20
   seconds), then cancels that scenario's parties, puts Parties setup back
   and signs out. If that couldn't finish, or the run was killed outright,
   run the step 1 line with `--cleanup-only` instead of `--only 24-40`. It
   cancels every "E2E …" party in the next 120 days, taps "I told them" on
   them and on any "Host not told yet" left for an "E2E …" host, frees any
   time still held for one, takes the "E2E" package, extras and 4 AM test
   days out of Parties setup, ticks "Keep their times blocked on the
   calendar" again if a killed run had unticked it (scenario 24 turns it
   off for a moment), and clears the stage-1 leftovers. Add `--dry-run` to
   see the plan first.

## B. Look through the preview (no money)

On the branch preview, on the iPad (1024 px wide) and on your phone (about
400 px wide). Card numbers: Square's sandbox test card 4111 1111 1111 1111,
any future date, any CVV, any ZIP.

5. **Book a party by phone, card.** /admin, Home, + Book a party. Pick a
   party time, the craft, 12 guests, a host with your phone and email, Take
   card now. Square's card box shows in the middle of the sheet (on the
   iPad it is not hidden under the footer). Charge it.

   What to look at: the party opens with "Paid", the confirmation email
   arrives, the time is gone from /book.

6. **Move, then tell them.** On that party, Move, pick another free time.
   The sheet shows "Let <name> know" with Call, Text and Email the new
   details. Tap Email the new details.

   What to look at: one email with the new time and a calendar invite; the
   "Host not told yet" note goes away.

7. **Parties setup over a booked party.** More, Parties setup. Take away
   the start that party is on, Save.

   What to look at: "Saved. New bookings use these." and the party listed
   as still booked. Put the start back.

8. **Phone and iPad layouts.** On a party with two payments and an extra:
   the Payments tab, the three guest fields in Book a party (labels may wrap,
   nothing should be cut off), the "Host not told yet" row (Call, Text,
   Write to <name> wrap onto lines, not squeezed). Every button is easy to
   tap.

## C. Tests with real money (live site, only after your go)

Do these on production only after you've decided to switch parties over and
the branch is on production. Use a time at least eight weeks out so a test
party never sits on a time a customer wants this month. Better still, add a
dated party day on a Monday to Wednesday eight weeks out in Parties setup
for the tests (a start like 10:00), and take it out again in step 22.

### Before you start (check each; stop if one isn't so)

- **Square sends us its news.** Square Developer Dashboard, the production
  application, Webhooks, the subscription for
  `https://ourhometownstudio.com/api/webhooks/square.json`. Its events
  include `payment.updated`, `order.updated`, `refund.created` and
  `refund.updated` (step 19 needs the refund ones). Without them a refund
  made in Square only shows after the 3 AM check.
- **Production settings** (Netlify, the site's environment variables,
  Production context):
  - `SQUARE_WEBHOOK_SIGNATURE_KEY` is set and is that subscription's
    signature key; `SQUARE_WEBHOOK_URL` is exactly the URL above;
  - `BOOKINGS_OPEN` still includes `parties`;
  - `DEV_BYPASS_PAYMENT` is not set at all.
- **The 3 AM check runs on production.** Netlify, the site, Logs,
  Functions, `reconcile-classes`: a run at 08:00 or 09:00 UTC that says
  `"ok":true`. (The sandbox run forced it by hand, so on production it is
  unproven until you see this.)
- **Square's own messages (OWNER-2).** In the Square Dashboard, open
  Appointments settings and the customer notifications (confirmations and
  reminders). Write down whether hosts get a Square reminder before their
  party. Parties booked from now on are not Square bookings, so Square sends
  them nothing; parties already booked in Square keep getting Square's
  messages until they've run. If hosts get a Square reminder today and you
  want new parties to get one too, tell me before step 23; I'll add our own
  party reminder first.

### The tests

9. **Look at a party that was booked in Square** (before anything else).
   On /admin, open a party still to come that was booked in Square.

   What to look at:
   - it says "Booked in Square" and has no Move, Cancel or Refund
     buttons (it can only be changed in Square until it has run);
   - its time is not offered on /book that day;
   - it shows on /staff that day too.

   If no Square-booked party is still to come, write that down and skip.

10. **Make the test package and extra.** /admin, More, Parties setup:

    - + Add a package: "Test party", $1, 90 minutes, fewest 1, most 4,
      usual 1, who can book "Only with the link".
    - + Add an extra: "Test extra half hour", $1, per party, 30 extra
      minutes, and **untick "Offered on the website"** (extras aren't tied
      to a package, so an extra offered on the website would show on
      everyone's /book).
    - Save, then copy the test package's link (`/book?package=…`) from the
      package.

    What to look at: /book without the link shows only the real package and
    no test extra.

11. **Book online with Apple Pay ($1).** Open the link on your iPhone, pick a
    free time eight weeks out (your Mon–Wed test day if you added one), any
    craft, 1 guest, pay with Apple Pay.

    What to look at:
    - one $1 payment in Square, receipt line "Party — Test party";
    - **the receipt has no tax line and the total is exactly $1.00**, even
      though the live location charges 9% on other things (the sandbox
      location may have no tax set up, so this was never really proven);
    - the party on the /admin calendar, "Paid";
    - the confirmation email, and the owners' booking text;
    - **nothing new in Square Appointments** (no booking on that day).

12. **A real card that's declined.** On the iPad, /admin, + Book a party,
    package Test party, a free time eight weeks out, Take card now. Type a
    real card with a wrong expiry date (last month).

    What to look at: a plain "declined" message in the sheet, no party
    booked, no charge in Square, the time still free on /book. Then close
    the sheet without booking.

13. **Book online with Google Pay ($1),** on an Android phone if one is on
    hand: the test package link, a free time, Google Pay.

    What to look at: as in step 11 (one $1 payment, no tax line, "Paid",
    the email). No Android phone: write "Google Pay not tried" under known
    gaps below and go on.

14. **Move it.** Open the step 11 party on /admin, Move, another free time.
    Use Text in "Let <name> know" to text yourself.

    What to look at: the old time is back on /book; the new one is gone.

15. **Add the extra.** + Add an extra, Test extra half hour.

    What to look at: the next party time that day is gone from /book;
    Payments shows $1 due.

16. **Pay it by the link ($1).** Send payment link (to your phone). Open the
    text, pay $1 with a real card.

    What to look at: Paid; a receipt with no tax line; the owners' text. If
    the card asks for an extra check (a bank pop-up) and then fails, stop
    and tell me: that is the verification step we left for this moment.

17. **Book by card on the iPad ($1).** /admin on the iPad, + Book a party,
    package Test party, a free time eight weeks out, Take card now, type a
    real card into Square's card box.

    What to look at: charged $1, "Paid", the confirmation email.

18. **Refund one payment from /admin.** On the step 17 party, Payments,
    Refund $1. The confirm names the host and the amount.

    What to look at: Square shows a $1 refund on that payment; Payments
    shows it; the party stays booked; the host gets one refund email.

19. **Refund in Square.** In the Square Dashboard, refund the step 11 $1
    payment.

    What to look at: within a few minutes it shows once on that party's
    Payments tab as refunded in Square. (Only after the 3 AM check means
    the webhook subscription from "Before you start" isn't working: tell me.)

20. **Crew refund needs a reason.** On /staff, open the step 11 party's
    roster, Refund. Leave the reason empty: it won't go. Type a reason, then
    tap Cancel at the confirm (no money).

21. **Gift card**, only if one is on hand: book the test package online with
    it. Square shows the gift card paid $1.

22. **Cancel the test parties, and put the test bits away the same day.**
    Cancel on each test party, then tap "I told them" on each.

    What to look at: "Nothing was refunded" (the extra paid in step 16 is still
    paid: refund it from Payments if you want it back); the times are back
    on /book; the guest invite link says "This party was cancelled."

    Then, straight away (not at the switch-over, which may be weeks
    later): More, Parties setup, **Archive** the Test party package and
    the Test extra half hour, take out the Mon–Wed test day if you added
    one, Save. Until then a $1 party is bookable by anyone with the link
    on real party times.

23. **Switching off Square for parties**, only once Parties setup shows
    "Parties still booked in Square: None":

    - In Square, turn off online booking for the party service, so nobody
      books a party where the site can't see it.
    - In Parties setup, untick "Keep their times blocked on the calendar"
      and Save. From then on the site never asks Square's bookings again.
      (The box can't be unticked while a Square-booked party is still to
      come.)
    - Wait a day of normal bookings. Then cancel Appointments Plus.

### Known gaps (not tested anywhere; watch the first real ones)

- Google Pay, if step 13 was skipped.
- A real card's extra bank check (step 16 shows it only if your card asks).
- Who gets the host and owner messages for real: the preview sent every
  email and text to Kaden, so the first real booking is the first time a
  host's own inbox and phone get them.
- Real gift cards, if step 21 was skipped.

## D. Catherine's guide

It lives in the app now: **/admin, More, Help**. It covers every screen,
and has a "When you see this, tap this" table for every warning and every
To decide item. It is kept with the code (`src/lib/admin-help.ts`), and a
test makes sure every warning and To decide item has its line there, so it
can't fall behind the app. Nothing here needs repeating: send Catherine to
More, Help.
